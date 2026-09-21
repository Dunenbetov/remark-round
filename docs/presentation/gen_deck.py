# -*- coding: utf-8 -*-
# Собирает файлы деки: deck/project/deck.json и deck/project/slides/<id>.html.
import json, os, datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'deck')
os.makedirs(os.path.join(ROOT, 'project', 'slides'), exist_ok=True)

BG, PAPER, INK, SOFT = '#eef0f6', '#fbfcff', '#141a33', '#5c6280'
ACC, ACC2, TEAL, LINE, TINT = '#1d2d80', '#2a3ea3', '#0f6f66', '#d9dded', '#e9ecfa'
DARKBG = 'linear-gradient(170deg, #2a3ea3, #1d2d80 58%, #16226a)'
LIGHT, SOFTL = '#f4f5fa', '#c5cbee'
FONT = "font-family:'Onest', Arial, sans-serif"
DISPLAY = "font-family:'Unbounded', 'Onest', Arial, sans-serif"
IMG = {
    'system': '/_blob/f45505e9ecae59f0af2e3897ead94e82',
    'flow': '/_blob/6e9c72afdf473ddfa60c27821994e476',
    'card': '/_blob/fe3af6e9373f474a1558f5d18981820b',
    'retest': '/_blob/f94be784dff2b8a321d6f5249e667ac2',
    'mcp': '/_blob/a4fe773778d3bec8a62b8a3fe3afaf4d',
}
CARD = f'background:{PAPER}; border:1px solid {LINE}; border-radius:24px; padding:40px; display:flex; flex-direction:column; gap:16px; box-shadow:0 16px 40px -12px rgba(20,26,51,0.14)'

slides = []  # (id, html)

def footer(n, dark=False):
    c = SOFTL if dark else SOFT
    return (f'<p style="position:absolute; left:128px; bottom:64px; width:600px; font-size:24px; color:{c}">RemarkRound</p>'
            f'<p style="position:absolute; right:128px; bottom:64px; width:200px; text-align:right; font-size:24px; color:{c}">{n}</p>')

def section(sid, body, notes, n, dark=False, pad='112px 128px 160px', gap=48, extra=''):
    bg = DARKBG if dark else BG
    color = LIGHT if dark else INK
    html = (f'<section id="{sid}" data-transition="fade" style="background:{bg}; color:{color}; {FONT}; padding:{pad}; '
            f'display:flex; flex-direction:column; gap:{gap}px{extra}">\n{body}\n{footer(n, dark)}\n<aside>{notes}</aside>\n</section>\n')
    slides.append((sid, html))

def eyebrow(t, dark=False):
    return f'<p style="font-size:24px; font-weight:600; color:{SOFTL if dark else ACC}; letter-spacing:2px; text-transform:uppercase">{t}</p>'

def title(t):
    return f'<h2 style="font-size:56px; font-weight:700; line-height:1.1">{t}</h2>'

def head(eb, t, dark=False):
    return f'<div style="display:flex; flex-direction:column; gap:16px">{eyebrow(eb, dark)}{title(t)}</div>'

def card(h, lines, flex='1', accent=None):
    top = f'<p style="{DISPLAY}; font-size:40px; font-weight:600; color:{ACC}">{accent}</p>' if accent else ''
    ps = ''.join(f'<p style="font-size:28px; line-height:1.35; color:{SOFT}">{l}</p>' for l in lines)
    return f'<div style="{CARD}; flex:{flex}">{top}<h3 style="font-size:40px; font-weight:700; line-height:1.15">{h}</h3>{ps}</div>'

# 1. Обложка
slides.append(('cover', f'''<section id="cover" data-transition="fade" style="background:{DARKBG}; color:{LIGHT}; {FONT}; padding:128px; display:flex; flex-direction:column; justify-content:space-between">
<p style="font-size:24px; font-weight:600; color:{SOFTL}; letter-spacing:2px; text-transform:uppercase">Финальный проект, nFactorial LLM Engineering</p>
<div style="display:flex; flex-direction:column; gap:40px">
<h1 style="{DISPLAY}; font-size:120px; font-weight:600; line-height:1.05">RemarkRound</h1>
<p style="font-size:40px; line-height:1.3; color:{LIGHT}; width:1300px">Слой приёмки веб-проекта: замечание заказчика, цитата из ТЗ, решение человека</p>
</div>
<div style="display:flex; justify-content:space-between; align-items:end">
<p style="font-size:28px; color:{SOFTL}">remark-round.up.railway.app</p>
<p style="font-size:28px; color:{SOFTL}">Алмас Доненбетов, сентябрь 2026</p>
</div>
<aside>RemarkRound помогает решить, является ли замечание заказчика работой по ТЗ. Система находит место в ТЗ и готовит разбор, решение принимает человек. Дальше: проблема, решение, демо, архитектура, замеры, выводы.</aside>
</section>
'''))

# 2. Проблема
cards = ''.join([
    card('Поломка', ['«Кнопка „Сохранить“ серая»', 'В ТЗ §2.1 основная кнопка синяя. Это работа по договору.'], accent='1'),
    card('Новое желание', ['«Хотим тёмную тему»', 'В ТЗ этого нет. Это отдельная работа и отдельные деньги.'], accent='2'),
    card('Пробел в ТЗ', ['«Нет выгрузки в Excel»', 'Документы молчат. Решить может только человек.'], accent='3'),
])
section('problem', head('Проблема', 'В журнале приёмки поломки, желания и пробелы ТЗ лежат в одной колонке') +
        f'<div style="display:flex; gap:32px">{cards}</div>'
        f'<p style="font-size:40px; font-weight:600; line-height:1.25; width:1500px">Сегодня всё это уходит разработчикам как баги. Спор с заказчиком идёт по памяти и в почте.</p>',
        'Заказчик принимает сайт и присылает Excel с замечаниями. В одной колонке три разных вещи: поломка относительно ТЗ, новое желание и вопрос, на который ТЗ не отвечает. В спешке всё уходит в спринт как баги. Пользователь продукта: руководитель приёмки в студии заказной разработки.', 2)

# 3. Решение
steps = ''.join([
    card('Замечание', ['Строка журнала и скриншот от заказчика'], accent='1'),
    card('Опора', ['Поиск по ТЗ и протоколам, цитата с номером раздела'], accent='2'),
    card('Разбор', ['Факты кадра, предложенный класс, черновик для PM'], accent='3'),
    card('Решение', ['Одна из пяти кнопок PM. Только после неё замечание становится работой'], accent='4'),
])
section('solution', head('Решение', 'Система готовит разбор. Решает человек') +
        f'<div style="display:flex; gap:24px">{steps}</div>'
        f'<div style="display:flex; gap:48px; align-items:center"><p style="font-size:28px; line-height:1.35; flex:1">На ретесте пиксели сравнивает алгоритм, модель поясняет изменение, закрывает замечание только заказчик.</p>'
        f'<p style="font-size:28px; line-height:1.35; color:{ACC}; font-weight:600; flex:1">Jira stores work. We decide whether it is work.</p></div>',
        'Четыре шага. Замечание со скриншотом. Поиск опоры в пакете документов проекта. Разбор: цитата, факты кадра и предложение класса. Решение принимает PM одной кнопкой, без кнопки замечание не становится работой. Модель умеет отвечать «недостаточно данных» и «в документах нет ответа».', 3)

# 4. Демо
bul = ''.join(f'<li>{t}</li>' for t in [
    'Заказчик добавляет замечание',
    'PM видит цитату из ТЗ и решает кнопкой',
    'Разработчик получает только принятые поломки',
    'Заказчик прикладывает кадр «стало» и закрывает',
    'Трейс разбора в Langfuse',
])
section('demo', head('Демо', 'Один цикл под тремя ролями') +
        f'<div style="display:flex; gap:64px; align-items:center"><ul style="font-size:28px; line-height:1.7; width:620px">{bul}</ul>'
        f'<img src="{IMG["card"]}" alt="Карточка замечания: текст заказчика, скриншот, цитата из ТЗ, кнопки решения PM" style="width:980px; height:600px; object-fit:contain; border-radius:24px; background:{PAPER}; border:1px solid {LINE}"></div>',
        'Демо идёт на локальном стенде, 4 минуты, сценарий в docs/DEMO.md. Новое замечание «нет входа через Google» разбирается за 6–7 секунд: новое желание с цитатой §3. Затем №12 «кнопка серая»: в работу, разработчик, ретест за 2–3 секунды, закрытие. В конце трейс и прод.', 4)

# 5. Архитектура
slides.append(('arch', f'''<section id="arch" data-transition="fade" style="background:{BG}; color:{INK}; {FONT}; padding:56px 128px 110px; display:flex; flex-direction:column; gap:20px">
<div style="display:flex; flex-direction:column; gap:8px">{eyebrow('Архитектура')}<h2 style="font-size:56px; font-weight:700; line-height:1.1">Один процесс API, одна база, внешние сервисы по API</h2></div>
<div style="display:flex; justify-content:center"><img src="{IMG['system']}" alt="Архитектура продакшена: браузер и IDE, сервисы web, api и PostgreSQL на Railway, OpenAI, Langfuse Cloud, Sentry, деплой из GitHub после CI" style="width:1440px; height:780px; object-fit:contain; border-radius:24px"></div>
{footer(5)}
<aside>Прод на Railway: web, api, PostgreSQL с pgvector. Вся логика в одном процессе NestJS: REST, WebSocket, два графа LangGraph и воркер очереди. Очередь задач, чекпоинты графа и векторы лежат в одной базе: один бэкап, фильтр проекта в том же SQL. Цена решения: один инстанс API. MCP-сервер запускает IDE локально, он ходит в те же REST-маршруты. Деплой из main только после зелёного CI с evals.</aside>
</section>
'''))

# 6. Путь замечания
slides.append(('flow', f'''<section id="flow" data-transition="fade" style="background:{BG}; color:{INK}; {FONT}; padding:56px 128px 110px; display:flex; flex-direction:column; gap:24px">
<div style="display:flex; flex-direction:column; gap:8px">{eyebrow('Архитектура')}<h2 style="font-size:56px; font-weight:700; line-height:1.1">Путь замечания через граф триажа</h2></div>
<div style="display:flex; justify-content:center"><img src="{IMG['flow']}" alt="Путь замечания: запрос заказчика, транзакция и очередь задач в PostgreSQL, воркер, граф LangGraph с двумя циклами и паузой до решения PM, запись решения и продолжение графа" style="width:1664px; height:756px; object-fit:contain; border-radius:24px"></div>
{footer(6)}
<aside>Заказчик отправляет замечание. API одной транзакцией заводит прогон и кладёт задачу в очередь в Postgres, REST сразу отвечает. Воркер берёт задачу и вызывает граф. Синие ноды зовут модель, белые выполняет код. Цикл 1: опора слабее 0,45, переписать запрос, до двух раз. Цикл 2: черновик не прошёл проверку кодом, повторить, до двух раз. Нода hitl ставит граф на паузу. Решение PM пишется в базу до пробуждения графа, затем resume.</aside>
</section>
'''))

# 7. Почему LangGraph
cards = ''.join([
    card('Циклы с лимитом', ['Переписать запрос: до 2 раз.', 'Переделать черновик: до 2 раз.', 'Третий провал: «недостаточно данных» ставит код.']),
    card('Пауза на человека', ['interrupt: граф спит в Postgres часы и дни и переживает деплой.', '«Не та цитата из ТЗ» продолжает тот же прогон.']),
    card('Одно хранилище', ['Чекпоинты, очередь и векторы в одной Postgres.', 'Свой чекпоинтер на Prisma, 123 строки.']),
])
nums = ''.join(f'<div style="display:flex; flex-direction:column; gap:4px; flex:1"><p style="{DISPLAY}; font-size:56px; font-weight:600; color:{ACC}">{a}</p><p style="font-size:24px; color:{SOFT}">{b}</p></div>' for a, b in [
    ('10', 'нод в графе триажа'), ('2 + 1', 'цикла: два с лимитом, один от человека'), ('9', 'вызовов модели максимум за проход'), ('1 = 1', 'один прогон, один трейс')])
section('langgraph', head('Оркестрация', 'Почему LangGraph') +
        f'<div style="display:flex; gap:32px">{cards}</div><div style="display:flex; gap:32px">{nums}</div>'
        f'<p style="font-size:24px; color:{SOFT}">CrewAI и Parlant: Python и второй сервис. Сравнение по документации, прототипов не делали (ADR 014).</p>',
        'Нужны были три вещи: циклы с жёстким лимитом, пауза на решение человека, которая живёт дни, и состояние в той же Postgres. LangGraph.js даёт это в том же процессе и на том же TypeScript. CrewAI и Parlant на Python и про другое: команда агентов и диалог. Прототипов альтернатив не делал, сравнивал по документации.', 7, gap=40)

# 8. RAG
rows = ''.join(f'<li>{t}</li>' for t in [
    'Чанк: раздел по заголовкам, длинные разделы окнами 220 слов с перекрытием 40',
    'Эмбеддинги: text-embedding-3-small, 1536 измерений',
    'Хранилище: pgvector, индекс HNSW, фильтр проекта в SQL',
    'Порог опоры 0,45. Ниже порога запрос переписывается, до 2 раз',
    'Reranker не ставили: корпус мал, опоры выбирает шаг classify',
])
hits = ''.join(f'<div style="display:flex; align-items:baseline; gap:24px"><p style="{DISPLAY}; font-size:56px; font-weight:600; color:{ACC}; width:260px">{a}</p><p style="font-size:28px; color:{SOFT}">{b}</p></div>' for a, b in [
    ('16/25', 'hit@1'), ('20/25', 'hit@3'), ('23/25', 'hit@6')])
section('rag', head('RAG', 'Цитата равна разделу ТЗ') +
        f'<div style="display:flex; gap:64px"><ul style="font-size:28px; line-height:1.5; flex:1">{rows}</ul>'
        f'<div style="{CARD}; width:560px">{hits}<p style="font-size:24px; color:{SOFT}">Живой поиск на golden, 20.09</p></div></div>'
        f'<p style="font-size:24px; color:{SOFT}">Корпус golden: 11 фрагментов. На ТЗ в 38 разделов поиск не мерили. Сравнение четырёх стратегий чанкинга: по заголовкам 6–7 из 8, слепые окна 4–5 из 8.</p>',
        'Единица цитаты: раздел ТЗ, PM видит «§2.1 Primary». Фильтр проекта стоит в SQL, не в промпте. Reranker не ставили: classify получает до 8 фрагментов целиком и сам указывает опоры, код отбрасывает id не из выдачи. Слабое место: точные токены вроде hex-цвета. Корпус маленький, это ограничение замера.', 8)

# 9. Evals
def table(headers, body, widths, size=28):
    ths = ''.join(f'<th style="width:{w}%; text-align:left; font-weight:600">{h}</th>' for h, w in zip(headers, widths))
    trs = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in body)
    return f'<table style="font-size:{size}px; {FONT}; color:{INK}; background:{PAPER}; border-radius:16px"><tr style="background:{TINT}">{ths}</tr>{trs}</table>'

t = table(['Конфигурация', 'Опора', 'Честность'],
          [['Константа «всегда не знаю»', '20/33', '33/33'], ['Правила без модели', '17/33', '33/33'],
           ['<b>gpt-4.1-mini + gpt-4.1</b>', '<b>28–29/33</b>', '<b>33/33</b>']], [56, 22, 22])
blind = ''.join(f'<li>{x}</li>' for x in [
    'Честность структурная: та же проверка стоит в графе',
    'Качество текста черновика не измеряется',
    'Golden синтетический, писали сами',
    'Разброс двух одинаковых прогонов: 1 кейс',
])
section('evals', head('Evals', 'Golden 49 кейсов, две метрики, три базовых уровня') +
        f'<div style="display:flex; gap:48px; align-items:start"><div style="display:flex; flex-direction:column; gap:24px; flex:1">{t}'
        f'<p style="font-size:24px; color:{SOFT}">33 разбора, 15 ретестов, 1 утечка между проектами. 12 типов трудных ситуаций. CI гоняет evals на каждый push, порог опоры 0,65.</p></div>'
        f'<div style="{CARD}; width:640px"><h3 style="font-size:40px; font-weight:700; line-height:1.15">Чего метрики не видят</h3><ul style="font-size:28px; line-height:1.45; color:{SOFT}">{blind}</ul></div></div>',
        'Опора: класс совпал с golden или это законный отказ, у дефекта нужный раздел среди цитат. Честность: в черновике нет ссылки на раздел без цитаты, нет «на кадре» без кадра. Базовые уровни показывают, что набор перекошен в сложные случаи: константа набирает 20 из 33. Поэтому порог CI подняли с 0,6 до 0,65. Что метрики не видят, говорю сам.', 9)

# 10. Гиперпараметры и модели
t1 = table(['Параметр', 'Опора из 33'],
           [['По умолчанию, два прогона', '28 и 29'], ['classify, T 0,3 и 0,7', '30 и 30'], ['черновик, T 0 и 0,7', '28 и 29'],
            ['top_p 0,8', '29'], ['max_tokens 120 и 400', '30 и 29']], [64, 36], size=26)
t2 = table(['Модели', 'Опора', '$', 'p95'],
           [['<b>mini + 4.1</b>', '<b>28–29</b>', '<b>0,0033</b>', '<b>5,7–5,9 с</b>'], ['4.1 + 4.1', '27', '0,0072', '8,2 с'],
            ['nano + 4.1', '22', '0,0024', '4,9 с'], ['mini + mini', '29', '0,0017', '5,2 с']], [36, 20, 20, 24], size=26)
section('params', head('Эксперимент 20.09', 'Гиперпараметры и модели: 20 прогонов, $1,86') +
        f'<div style="display:flex; gap:48px; align-items:start"><div style="flex:1">{t1}</div><div style="flex:1">{t2}</div></div>'
        f'<div style="display:flex; gap:48px"><p style="font-size:28px; line-height:1.35; flex:1">Параметры в пределах шума. Дефолты оставлены по эксперименту: classify T 0, черновик T 0,3, top_p не передаём.</p>'
        f'<p style="font-size:28px; line-height:1.35; flex:1">Черновик на mini вдвое дешевле, метрики те же. В 4 текстах из 33 фактические ошибки. Остались на gpt-4.1.</p></div>',
        'Все цифры сняты за одну сессию на коммите, который стоит на проде. Меняли по одному параметру. Два одинаковых прогона дают 28 и 29, значит отличия в 1–2 кейса это шум. max_tokens работает как предохранитель: средний черновик 77 токенов. Модели: nano отвергнута, всё на 4.1 вдвое дороже и не лучше. Черновик на mini: по метрикам не хуже, но мы прочитали тексты и нашли 4 фактические ошибки. Это пример того, чего golden не видит.', 10, gap=40)

# 11. A/B ретеста
ab = ''.join([
    card('H0: два кадра в модель', ['11–12 из 15', '3 ложных «исправлено»', '$0,0010 за ретест']),
    card('H1: pixel-diff и пояснение', ['14 из 15', '1 ложное «исправлено»', '$0,0007 за ретест']),
    card('H0 с предпроверкой, расчёт', ['14 из 15', '1 ложное «исправлено»', '$0,0005 за ретест']),
])
section('ab', head('A/B', 'Ретест: выигрывает предпроверка кадров') +
        f'<div style="display:flex; gap:32px">{ab}</div>'
        f'<p style="font-size:40px; font-weight:600; line-height:1.25; width:1560px">Качество даёт проверка размера и идентичности кадров алгоритмом. Картинка диффа нужна человеку. H1 остался в продукте за предпроверку и объяснимость.</p>',
        '15 кейсов, 6 прогонов на одном коде, переключение флагом. Гипотеза была: модель по двум кадрам выдумывает исправление. Не подтвердилось: три ложных у H0 на кадрах, которые нельзя сравнивать, и на оттенке синего, который путает и H1. Если к H0 приложить только предпроверку, выходит те же 14 из 15 и дешевле. Ещё один провал H1 оказался текстом интерфейса со словом «исправлено», evals это поймали.', 11)

# 12. Гипотезы
hyp = [
    ('Картинка диффа улучшает ретест', 'Выигрыш даёт предпроверка кадров'),
    ('Temperature и top_p что-то решают', 'Все варианты в пределах шума'),
    ('Команда на скриншоте пробивает защиту', 'По трейсам это путаница «желание или дефект». Три правки промпта по 70 прогонов сделали хуже, откат'),
    ('mini на черновике не хуже', 'Метрики те же, в текстах 4 ошибки из 33'),
]
rows = ''.join(f'<div style="display:flex; gap:48px; align-items:baseline; padding:20px 0; border-top:1px solid #4a58cf"><p style="font-size:28px; font-weight:600; width:640px; color:{LIGHT}">{a}</p><p style="font-size:28px; line-height:1.35; flex:1; color:{SOFTL}">{b}</p></div>' for a, b in hyp)
section('hypotheses', head('Выводы', 'Гипотезы, которые не подтвердились', dark=True) +
        f'<div style="display:flex; flex-direction:column">{rows}</div>'
        f'<p style="font-size:40px; font-weight:600; line-height:1.25">Правило после 21.09: промпт без замера не правим.</p>',
        'Четыре гипотезы. Главный урок: три очевидные починки промпта, каждая на 70 прогонах, ухудшали соседние кейсы. Все откатили, код равен коммиту замеров. Граница «желание или дефект» осталась известным ограничением, его прикрывает кнопка PM.', 12, dark=True, gap=40)

# 13. Пользователи и что дальше
left = (f'<div style="{CARD}; flex:1"><h3 style="font-size:40px; font-weight:700; line-height:1.15">Команда на проде с 21.09</h3>'
        f'<p style="font-size:28px; line-height:1.35; color:{SOFT}">1 человек от бизнеса, 1 PM, 3 разработчика. Рабочие проекты.</p>'
        f'<p style="font-size:28px; line-height:1.35; color:{SOFT}">Первое наблюдение: активность низкая, интерфейс для новых людей сложный.</p>'
        f'<p style="font-size:28px; line-height:1.35; color:{TEAL}; font-weight:600">[цитата PM после созвона 24.09]</p>'
        f'<p style="font-size:28px; line-height:1.35; color:{TEAL}; font-weight:600">[сколько замечаний прошло через систему]</p></div>')
nxt = ''.join(f'<li>{x}</li>' for x in [
    'Пилот: один раунд от 30 строк без параллельного Excel',
    'Упростить первый экран по отзывам команды',
    'OCR сканов ТЗ через vision',
    'Поиск на корпусе от 100 фрагментов',
])
right = (f'<div style="{CARD}; flex:1"><h3 style="font-size:40px; font-weight:700; line-height:1.15">Что дальше</h3>'
         f'<ul style="font-size:28px; line-height:1.45; color:{SOFT}">{nxt}</ul>'
         f'<p style="font-size:28px; line-height:1.35">$0,0033 за замечание, около $1,10 в месяц на команду.</p></div>')
section('users', head('Бизнес', 'Пользователи и следующий шаг') +
        f'<div style="display:flex; gap:32px">{left}{right}</div>'
        f'<div style="display:flex; justify-content:space-between"><p style="font-size:28px; font-weight:600; color:{ACC}">remark-round.up.railway.app</p><p style="font-size:28px; color:{SOFT}">github.com/Dunenbetov/remark-round</p></div>',
        'Пользователь: руководитель приёмки в студии. Сейчас он решает это Excel, почтой и памятью. С 21 сентября на проде работает моя команда на своих проектах. Честно: стартовали вяло, интерфейс для новичков сложный, собираю ответы до 24.09. Сигнал продолжать: PM сам просит завести второй раунд.', 13)

# 14. Приложение: MCP и Skill
tools = ''.join(f'<li>{x}</li>' for x in ['search_spec', 'get_round_remarks', 'apply_human_verdict', 'submit_retest_evidence'])
section('app-mcp', head('Приложение', 'MCP-сервер и Skill') +
        f'<div style="display:flex; gap:48px; align-items:start"><div style="display:flex; flex-direction:column; gap:24px; width:700px">'
        f'<ul style="font-size:28px; line-height:1.5; font-weight:600">{tools}</ul>'
        f'<p style="font-size:28px; line-height:1.35; color:{SOFT}">Инструмента «закрыть» нет. Проект зашит в токен, фильтр в SQL.</p>'
        f'<p style="font-size:28px; line-height:1.35; color:{SOFT}">Skill uat-triage: один файл для графа, MCP-prompt и Claude Code. Без Skill 6 ответов из 33 меняют класс.</p></div>'
        f'<img src="{IMG["mcp"]}" alt="Claude Code: Skill uat-triage подгрузился сам, search_spec ответил «Опоры нет», get_round_remarks отдал очередь" style="width:916px; height:600px; object-fit:contain; border-radius:24px; background:{PAPER}; border:1px solid {LINE}"></div>',
        'Почему MCP, а не REST: REST рассчитан на код, написанный заранее, MCP на ИИ-агента в редакторе, который сам узнаёт инструменты при подключении. Это тонкий фасад тех же REST-маршрутов: один путь записи и одна авторизация. Skill читают три потребителя: граф, MCP-prompt и Claude Code.', 14)

# 15. Приложение: трейсинг, защита, ограничения
cards = ''.join([
    card('Трейсинг', ['Langfuse Cloud. Один прогон, один трейс: traceId = sha256(runId).', 'Счёт Langfuse на 17 % ниже нашего прайса: кэш промпта.']),
    card('Защита', ['Детектор инъекций по тексту, 15 правил.', 'Черновик проверяет код. Фильтр проекта в SQL. Закрывает только заказчик.']),
    card('Ограничения', ['Один инстанс API.', 'Кадры разного размера не сравниваются.', 'Детектор не читает кадр. Golden синтетический.']),
])
section('app-ops', head('Приложение', 'Трейсинг, защита, ограничения') + f'<div style="display:flex; gap:32px">{cards}</div>'
        f'<p style="font-size:24px; color:{SOFT}">Полный список ограничений с доказательствами: docs/defense/HONEST-NOTES.md. Соответствие требованиям курса: таблица в README.</p>',
        'На бою трейсинг сначала молчал: Sentry занимал глобальный провайдер OpenTelemetry, Langfuse получал ноль спанов. Починили изолированным провайдером, /health теперь показывает on, degraded или off. Ограничения называю сам, у каждого есть замер и следующий шаг.', 15)

order = [sid for sid, _ in slides]
for sid, html in slides:
    open(os.path.join(ROOT, 'project', 'slides', f'{sid}.html'), 'w', encoding='utf-8').write(html)

deck = {
    'v': 4,
    'createdOnFiles': {'v': 1, 'at': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')},
    'title': 'RemarkRound: защита проекта',
    'order': order,
    'cover': 'cover',
    'sections': {
        's1': {'description': 'Проблема приёмки и что делает RemarkRound', 'start': 'cover'},
        's2': {'description': 'Живое демо одного цикла под тремя ролями', 'start': 'demo'},
        's3': {'description': 'Архитектура продакшена, путь замечания и выбор LangGraph', 'start': 'arch'},
        's4': {'description': 'RAG, evals, гиперпараметры, модели и A/B ретеста', 'start': 'rag'},
        's5': {'description': 'Неподтвердившиеся гипотезы, пользователи и следующий шаг', 'start': 'hypotheses'},
        's6': {'description': 'Приложение: MCP и Skill, трейсинг, защита, ограничения', 'start': 'app-mcp'},
    },
    'faces': {
        'onest': {'family': 'Onest', 'href': 'https://fonts.googleapis.com/css2?family=Onest:wght@400..800&display=swap'},
        'unbounded': {'family': 'Unbounded', 'href': 'https://fonts.googleapis.com/css2?family=Unbounded:wght@400..800&display=swap'},
    },
    'designSystems': [],
}
json.dump(deck, open(os.path.join(ROOT, 'project', 'deck.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(ROOT)
print(json.dumps({f'project/slides/{s}.html': f'project/slides/{s}.html' for s in order}, ensure_ascii=False))
