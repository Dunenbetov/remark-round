/**
 * P1 (18.09): на бою включены и Sentry, и Langfuse. `Sentry.init` занимает глобальный OpenTelemetry-провайдер
 * (даже при tracesSampleRate: 0); раньше Langfuse регистрировался вторым, проигрывал молча («duplicate registration
 * of API: trace»), и в Langfuse Cloud не доезжал ни один span, а /health писал `tracing: on`.
 *
 * Здесь Sentry поднимается с настройками instrument.ts на фиктивном DSN до приложения — как в main.ts, — и те же
 * проверки формы трейса, что без Sentry (test/trace-shape.ts), должны пройти. Сети нет: транспорт Sentry — заглушка,
 * span'ы Langfuse перехватываются на входе в процессор, до экспорта. Интеграции Sentry по умолчанию выключены: они
 * процесс-глобальные (process.on, diagnostics_channel) и пережили бы этот файл в воркере jest; конфликт провайдеров
 * от них не зависит — его создаёт сам `Sentry.init`.
 */
import { Logger } from '@nestjs/common';
import { getLangfuseTracerProvider, setLangfuseTracerProvider } from '@langfuse/tracing';
import { diag, trace, type ProxyTracerProvider } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import * as Sentry from '@sentry/node';
import { attr, describeTraceShape, stubOpenAi, waitForSpan } from '../../test/trace-shape';
import { sentryOptions } from '../instrument';
import { EmbeddingsService } from '../llm/embeddings.service';
import { RagService } from '../rag/rag.service';
import { ObservabilityService } from './observability.service';

const FAKE_DSN = 'https://public@o0.ingest.de.sentry.io/0';
/** Элемент конверта Sentry: [заголовок, тело]. */
type SentItem = [{ type: string }, Record<string, any>];
const sent: SentItem[] = [];
let loggedErrors: jest.SpyInstance;

describeTraceShape('observability: Langfuse рядом с Sentry (как на бою)', {
  before: () => {
    loggedErrors = jest.spyOn(Logger.prototype, 'error');
    Sentry.init({
      ...sentryOptions(FAKE_DSN),
      defaultIntegrations: false,
      registerEsmLoaderHooks: false,
      transport: () => ({
        send: async (envelope) => {
          sent.push(...(envelope[1] as unknown as SentItem[]));
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });
  },
  after: async () => {
    await Sentry.close(1000);
  },
  extra: (ctx) => {
    it('глобальный провайдер занят Sentry, у Langfuse свой; ошибок регистрации нет, diag OpenTelemetry пишет в лог', () => {
      const global = (trace.getTracerProvider() as ProxyTracerProvider).getDelegate();
      // Условие конфликта воспроизведено: первым глобальный провайдер занял Sentry
      expect(global.constructor.name).toMatch(/Sentry/);
      expect(getLangfuseTracerProvider()).not.toBe(global);
      expect(loggedErrors.mock.calls.flat().join('\n')).not.toMatch(/duplicate registration|span'ы не доедут/);
      diag.error('проверка связи');
      expect(loggedErrors).toHaveBeenCalledWith('otel: проверка связи');
    });

    it('span без нашего родителя внутри несэмплированного span\'а Sentry (REST-поиск) доходит до Langfuse', async () => {
      const { h, capture } = ctx();
      capture.spans.length = 0;
      const rag = h.app.get(RagService);
      const embeddings = new EmbeddingsService();
      embeddings['client'] = stubOpenAi();
      // Так выглядит HTTP-запрос на бою: Sentry держит в контексте свой span, при tracesSampleRate: 0 — несэмплированный
      await Sentry.startSpan({ name: 'GET /api/v1/projects/:projectId/search' }, async (request) => {
        expect(request.isRecording()).toBe(false);
        await rag.search({ userId: h.users.pm.id, projectId: h.projectId, role: 'pm' }, 'цвет primary-кнопки');
        await embeddings.embed(['кнопка']);
      });
      const retrieve = await waitForSpan(capture, 'retrieve');
      const embed = await waitForSpan(capture, 'embed');
      expect(attr(retrieve, 'langfuse.observation.type')).toBe('retriever');
      expect(attr(embed, 'langfuse.observation.type')).toBe('embedding');
      expect(JSON.parse(String(attr(embed, 'langfuse.observation.usage_details')))).toMatchObject({ input: 5 });
      // Родитель — span Sentry, которого в Langfuse нет: SDK помечает такой span корнем приложения
      expect(attr(retrieve, 'langfuse.internal.is_app_root')).toBe(true);
    });

    it('Sentry ловит ошибку с trace_id прогона Langfuse и не шлёт performance', async () => {
      const { h, observability } = ctx();
      const runId = 'run-sentry-1';
      await observability.run(
        { mode: 'triage', runId, remarkId: 'remark-sentry', projectId: h.projectId, userId: 'u-1', role: 'pm', model: 'gpt-4.1-mini', resume: false, input: {} },
        async () => {
          Sentry.captureException(new Error('разбор упал'));
        },
      );
      await Sentry.flush(2000);
      const event = sent.find(([header, body]) => header.type === 'event' && body['exception']?.values?.[0]?.value === 'разбор упал');
      expect(event).toBeDefined();
      // Ошибка, пойманная внутри прогона, несёт trace_id его трейса Langfuse: контекст у Sentry и Langfuse общий
      expect(event![1]['contexts']?.trace?.trace_id).toBe(ObservabilityService.traceIdOf(runId));
      // tracesSampleRate: 0 — в Sentry только ошибки, хотя наши span'ы Langfuse сэмплированы
      expect(sent.filter(([header]) => header.type === 'transaction' || header.type === 'span')).toEqual([]);
    });

    it('провайдер Langfuse подменён → /health: tracing: degraded', async () => {
      const { h, observability } = ctx();
      const ours = getLangfuseTracerProvider();
      setLangfuseTracerProvider(new NodeTracerProvider());
      try {
        expect(observability.tracingStatus()).toBe('degraded');
        expect((await h.http.get('/api/v1/health').expect(200)).body.tracing).toBe('degraded');
      } finally {
        setLangfuseTracerProvider(ours);
      }
      expect(observability.tracingStatus()).toBe('on');
    });
  },
});
