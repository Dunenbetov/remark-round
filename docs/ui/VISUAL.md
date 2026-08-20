# VISUAL.md — стол с бумагами

Не Linear. Не ChatGPT. Не фиолетовая админка.  
Эталон в браузере: [`reference.html`](reference.html).

## Ощущение

Тёплый бумажный стол, скрин как фото доказательства, справа — спокойные кнопки человека. Много воздуха. Можно читать с проектора на защите.

## Токены (скопировать в `styles.css`)

```css
:root {
  --rr-bg: #f3eee6;
  --rr-bg-accent: #e7dfd2;
  --rr-surface: #fffdf8;
  --rr-surface-2: #f8f3ea;
  --rr-ink: #1f1b16;
  --rr-ink-soft: #5c564e;
  --rr-line: #e4d9c8;
  --rr-accent: #1f4a3c;      /* главная кнопка, не электро-синий «AI» */
  --rr-accent-hover: #16382d;
  --rr-wait: #b8893a;        /* ждёт человека */
  --rr-work: #2b5578;        /* в работе */
  --rr-muted: #8a847a;       /* хотелка / дыра */
  --rr-ok: #2f6b4f;          /* закрыто */
  --rr-danger: #8f3a30;      /* только «допишите строку», не весь UI */
  --rr-radius: 12px;
  --rr-shadow: 0 10px 40px rgba(31, 27, 22, 0.06);
  --rr-font: "IBM Plex Sans", "Source Sans 3", ui-sans-serif, system-ui, sans-serif;
  --rr-serif: "Source Serif 4", Georgia, serif; /* только слово RemarkRound */
}
```

Шрифты: [IBM Plex Sans](https://fonts.google.com/specimen/IBM+Plex+Sans) + [Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4) для логотипа. Не Inter «как все SaaS», не Roboto Material.

## Иерархия карточки (закон)

Ширина колонок ≈ `1.15fr 1fr 0.85fr`.

1. **Улики** — скрин на всю ширину колонки, зум по клику. На ретесте ряд: было | стало | дифф, дифф не прятать.
2. **Черновик разбора** — цитата ТЗ заметнее стрима. Стрим мельче, цвет `--rr-ink-soft`.
3. **Решение** — одна primary, остальные `background: transparent; border: 1px solid var(--rr-line)`.

Шапка: роль **18–22px**, проект мельче. Человек всегда понимает, кто он.

## Компоненты, которые можно

Кнопки, чип статуса, таблица раунда, чип-фильтр, пустое состояние, фазовая строка, цитата (слева 3px `--rr-accent`).

## Компоненты, которых нет

FAB-чат, snackbar «AI done», stepper из 7 шагов, dashboard с графиками LLM cost для бизнеса (cost — в EVALS/админ).

## Angular

- Не подключать `indigo-pink.css` / `magenta-violet`.
- Material — только если очень нужно CDK (a11y, overlay). Тема своя, токены выше.
- `strict` templates. Фокус: видимое кольцо на кнопках, не `outline: none` без замены.
- Картинка скрина: `max-width: 100%`, клик → overlay на весь экран (колесо зума — хорошо).

## Адаптив

MVP защиты — **десктоп две колонки минимум**. Узкий экран: улики наверх, черновик, кнопки липко снизу. Не прячь кнопки PM в «⋯».

## Анимация

Фаза и появление черновика — 150–200ms, без «генеративной» волны и градиентного шиммера на полкарточки.
