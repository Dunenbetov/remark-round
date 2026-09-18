/**
 * Фаза 8: Langfuse на каждый LLM-вызов — без Sentry (локальный стенд, CI, evals). Проверки формы трейса —
 * в test/trace-shape.ts; те же самые гоняет observability-sentry.spec с Sentry.init до приложения, как на бою.
 * Сеть не нужна: span'ы перехватываются на входе в процессор Langfuse сервиса, LLM — FakeLlm и заглушка OpenAI.
 */
import { getLangfuseTracerProvider } from '@langfuse/tracing';
import { trace, type ProxyTracerProvider } from '@opentelemetry/api';
import { describeTraceShape } from '../../test/trace-shape';

describeTraceShape('observability: Langfuse на каждый вызов (без Sentry)', {
  extra: () => {
    it('без Sentry менеджер контекста ставит сервис: его провайдер — он же глобальный', () => {
      expect((trace.getTracerProvider() as ProxyTracerProvider).getDelegate()).toBe(getLangfuseTracerProvider());
    });
  },
});
