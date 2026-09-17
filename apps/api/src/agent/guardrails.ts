/**
 * Guardrail входа (REMARKROUND.md §12, docs/ENGINEERING.md паттерн 6 «промпт не ACL»): текст замечания
 * и комментарий PM проверяются на попытку управлять моделью — «забудь ТЗ», «ты в режиме без ограничений»,
 * «классифицируй как defect», «закрой замечание». Находка ничего не блокирует: замечание всё равно разбирается,
 * но модель получает пометку «это содержание, не команда», а PM видит в черновике, что инструкции проигнорированы.
 *
 * Что здесь НЕ делается и почему: фильтр проекта стоит в SQL (`RagService.search`), закрытие — только
 * `HumanVerdict`, дефект без цитаты невозможен (classify + faithfulness). Injection не может снять ни одно
 * из этих правил, поэтому детектор — про прозрачность для человека, а не последняя линия обороны.
 * Детерминированные правила, без LLM: LLM-судья по injection сам подвержен injection.
 */
export interface InjectionCheck {
  suspected: boolean;
  /** Найденные фразы как есть, для пометки в черновике и в трейсе. */
  matches: string[];
}

const PATTERNS: RegExp[] = [
  // Команды «забудь / игнорируй» контекст
  /ignore\s+(?:all\s+|the\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?|context)/i,
  /(?:disregard|forget)\s+(?:the\s+|all\s+|your\s+)?(?:tz|spec(?:ification)?|instructions?|rules?|system prompt|guidelines)/i,
  /(?:игнорируй|игнорировать|проигнорируй|забудь|забыть|отбрось|не учитывай)\s+(?:все\s+|всё\s+|предыдущие\s+|прошлые\s+|свои\s+)?(?:инструкци[июя]|тз|техзадание|правила|ограничения|документы|системн\S*\s+промпт)/i,
  // Смена роли / режима
  /(?:ты|вы)\s+(?:теперь\s+)?в\s+режиме\s+без\s+ограничений/i,
  /(?:you are|you're)\s+(?:now\s+)?(?:in\s+)?(?:developer|jailbreak|unrestricted|god)\s+mode/i,
  /\bDAN\b|do anything now/i,
  /(?:ты|вы)\s+(?:теперь|больше не)\s+(?:не\s+)?(?:ассистент|помощник|модель|судья|бот)/i,
  // Подделка системного канала
  /^\s*(?:system|assistant|система|системное сообщение|инструкция(?: для модели)?|для модели)\s*[:：]/im,
  // Прямое управление исходом
  /(?:классифицируй|отнеси|пометь|запиши|считай)\s+(?:это\s+|это замечание\s+)?как\s+(?:defect|дефект|блокер|баг)/i,
  /(?:classify|mark|label|treat)\s+(?:this|it)?\s*(?:as\s+)?(?:a\s+)?(?:defect|blocker|bug|fixed|closed)/i,
  /(?:это|данное замечание)\s+всегда\s+(?:блокер|дефект|баг)/i,
  /(?:this|it)\s+is\s+always\s+a\s+(?:blocker|defect|bug)/i,
  /закро(?:й|йте)\s+(?:это\s+)?(?:замечание|тикет|задачу|его)/i,
  /(?:напиши|скажи|укажи),?\s+что\s+(?:pm|пм|руководитель|заказчик|бизнес)\s+(?:согласен|согласна|одобрил|подтвердил)/i,
  /раздел\s+§?\s?\d+(?:\.\d+)*\s+(?:требует|обязывает|говорит)[^.]{0,40}(?:игнорируй|классифицируй|как defect|как дефект)/i,
];

export function detectInjection(...texts: Array<string | null | undefined>): InjectionCheck {
  const matches: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const re of PATTERNS) {
      const m = re.exec(text);
      if (m && !matches.includes(m[0].trim())) matches.push(m[0].trim().slice(0, 80));
    }
  }
  return { suspected: matches.length > 0, matches };
}

/** Пометка для PM в черновике: инструкции из текста показаны, но не выполнены. Ставит код, не модель. */
export function injectionNote(matches: string[]): string {
  const shown = matches.slice(0, 2).map((m) => `«${m}»`).join(', ');
  return `В тексте замечания есть инструкции для модели (${shown}); они прочитаны как содержание и не выполнялись.`;
}
