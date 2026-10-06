# Offline Trade Lab

Локальний офлайн-інструмент для аналізу двосвічкової торгової моделі на історичних OHLCV-даних.
Повністю статичний: HTML + CSS + JavaScript, без CDN, бібліотек, backend, API-ключів і npm.
Дані зберігаються локально у браузері (IndexedDB). Працює локально, через локальний HTTP-сервер і на GitHub Pages.

> Це лише історична статистика. Застосунок НЕ робить прогнозів ринку.

## Можливості

- **Dashboard**: лічильники (свічки, сетапи, симуляції, Win/Loss Rate, R/R, Profit Factor, Expectancy, Max Drawdown, PnL у R), останні 10 сетапів і записів журналу, summary по таймфреймах, графіки на Canvas (equity, wins/losses, місяці, таймфрейми).
- **Data Import**: CSV OHLCV, автовизначення роздільника (кома/крапка з комою/таб), preview 20 рядків, ручний mapping, Unix seconds/ms і ISO-дати, валідація (NaN, порожні рядки, дублікати, High&lt;Low, Open/Close поза High/Low), timeframe 1m/5m/15m/1h/4h/1D + custom, rename/delete/export dataset.
- **Strategy Lab**: конфігурована двосвічкова модель (Direction Long/Short/Both, range мін/макс %, тіло candle 2 %, Close threshold %, Entry/Stop/TP %, вікна очікування/життя, ATR-фільтр з періодом 14 за замовчуванням, мін. volume, напрями candle 1/2, body/range ratio). ATR реалізовано самостійно (Wilder).
- **Backtest**: результати TP first / SL first / No Entry / Timeout / Ambiguous. Web Worker з fallback на main thread.
- **Results**: таблиця (Date, Timeframe, Direction, Entry, Stop, TP, Range %, ATR, Result, R, Bars to Entry, Bars in Trade), фільтри, пошук, сортування, пагінація 25/50/100/250, експорт CSV.
- **Statistics**: Total/Entered/Wins/Losses/No Entry/Timeout/Ambiguous, Win/Loss Rate, Average/Median R, Profit Factor, Expectancy, streaks, Max Drawdown, середні бари; розрізи Long/Short, timeframe, рік, місяць, threshold, entry; equity curve.
- **Compare**: порівняння значень одного параметра на тому самому dataset (таблиця Parameter/Trades/Win Rate/PF/Expectancy/MaxDD). Без автооптимізації і без ярлика «найкращий».
- **Trade Journal**: ручні угоди (усі поля з ТЗ + Win/Loss/BE, теги, нотатки, Mistake?, Followed plan?), IndexedDB, edit/delete/search/фільтри, CSV export/import.
- **Journal Statistics**: кількість, Win Rate, PnL, R, avg win/loss, PF, expectancy, drawdown, розрізи Long/Short, timeframe, strategy, month.
- **Backup/Restore**: EXPORT BACKUP (JSON: datasets metadata + свічки + пресети + симуляції + журнал + settings), IMPORT з перевіркою, summary і підтвердженням (Replace/Merge), RESET ALL DATA з подвійним підтвердженням.
- **Presets**: Save/Load/Rename/Delete + стартові Balanced, Close 70, Close 90.
- **UX**: українська, dark trading terminal + світла тема, desktop-first + адаптив (sidebar → drawer), стримані акценти, tooltip для Profit Factor, Expectancy, Drawdown, ATR, R.

## Швидкий старт (Windows, без програмування)

Застосунок офіційно працює через **HTTP/HTTPS** (локальний сервер або GitHub Pages).
Просто відкрити `index.html` подвійним кліком (`file://`) НЕДОСТАТНЬО для повної функціональності:
браузери блокують `fetch()` локальних файлів (кнопка sample CSV не спрацює) і Web Worker.

Запуск через локальний HTTP-сервер:
1. Розпакуйте папку `offline-trade-lab`.
2. Встановіть Python з python.org (якщо ще нема).
3. У папці проєкту виконайте:
   `py -m http.server 8000`
   (якщо `py` не працює — `python -m http.server 8000`)
4. Відкрийте в браузері:
   `http://127.0.0.1:8000/`

## Як імпортувати CSV

1. Відкрийте **Data Import** → **Виберіть CSV**.
2. Вкажіть назву dataset. Delimiter — «авто» (за потреби виберіть вручну).
3. Перевірте preview перших 20 рядків. Якщо колонки не визначились — виберіть їх у **Mapping** вручну.
4. Натисніть **Імпортувати**. Проблемні рядки пропускаються (лічильники + приклади), імпорт не ламається.

Формат: заголовки `timestamp|time|date|open time|close time, open, high, low, close, volume` (регістр не важливий, volume необовʼязковий). Дата: Unix seconds, Unix ms або ISO-рядок (`2024-01-01T00:00:00Z`).

## Як працює Strategy Lab

1. Виберіть активний dataset (вгорі праворуч).
2. Налаштуйте параметри (див. підказки в інтерфейсі) → **Run Analysis**.
3. Дивіться таблицю результатів і розділ **Statistics**.

Визначення рівнів (документовано як авторське рішення):
- `range = high2 − low2` (candle 2 — свічка формування сетапу, candle 1 — попередня, завжди послідовні).
- Long: `entry = low2 + range·entry%`, `stop = low2 − range·stop%`, `target = entry + range·tp%`.
- Short — дзеркально від high2.
- R угоди: виграш `(target−entry)/risk`, програш `−1`, timeout — за ціною закриття останнього бара вікна.
- Вхід: лімітний — у вікні `maxWaitBars` барів ціна має повернутися до entry (long: `low ≤ entry`, short: `high ≥ entry`); геп — вхід за ціною відкриття.

## Ambiguous-свічки

Якщо в одному барі одночасно зачеплені TP і SL, порядок за OHLC визначити неможливо. Результат — **Ambiguous**, алгоритм нічого не вгадує. У **Settings** виберіть трактування: `exclude` (за замовчуванням — не входить у Win Rate/PF), `count as loss`, `count as win`.

## Backup / Restore

- **Export Backup** у Settings — завантажує JSON з усім (включно зі свічками).
- **Import Backup** — файл перевіряється, показується summary (кількість datasets/свічок/пресетів/симуляцій/журналу), далі діалог: OK = замінити все, Cancel = merge (додати). Існуючі дані мовчки не стираються.
- **Reset All Data** — подвійне підтвердження.

## GitHub Pages (інструкція для не-програміста)

1. Створіть акаунт на github.com → **New repository** (напр. `offline-trade-lab`), Public.
2. Натисніть **uploading an existing file** / **Add file → Upload files** і завантажте ВЕСЬ вміст папки `offline-trade-lab` (файли `index.html`, `README.md`, `.nojekyll`, папки `css/`, `js/`, `worker/`, `sample/`).
3. **Commit changes**.
4. Відкрийте **Settings** репозиторію → ліворуч **Pages**.
5. У **Build and deployment**: Source = **Deploy from a branch**, Branch = **main**, папка = **/ (root)** → **Save**.
6. Зачекайте 1–2 хв. Готова HTTPS-адреса зʼявиться вгорі сторінки Pages, формат: `https://ВАШ_НІК.github.io/offline-trade-lab/`.

Усі шляхи в проєкті відносні (`css/style.css`, `js/app.js`, `worker/backtest-worker.js`), абсолютних `C:\...` немає — деплой без змін коду.

## Обмеження backtest

- Внутрішньобарний порядок невідомий (звідси Ambiguous).
- Вхід/вихід — за спрощеною лімітною логікою, без спредів, комісій, прослизання, обсягів стакана.
- Таймаут закривається за close останнього бара вікна.
- Великі gapʼи трактуються входом за open.

## Чому статистика не є прогнозом

Ринок нестаціонарний: режими волатильності, ліквідність і поведінка учасників змінюються. Минулі частоти сетапів не гарантують майбутніх. Застосунок — дослідницький журнал і калькулятор, а не торгова рекомендація.

## Структура

```
offline-trade-lab/
  index.html  css/style.css
  js/app.js js/db.js js/csv.js js/strategy.js js/backtest.js
     js/statistics.js js/charts.js js/journal.js js/backup.js js/utils.js
  worker/backtest-worker.js
  sample/sample-btc.csv  README.md  .nojekyll
```

## Самоперевірка автора

Перевірено: відкриття, IndexedDB, імпорт/парсинг/mapping CSV, детекція Long/Short, TP/SL/No Entry/Timeout/Ambiguous (синтетичні кейси), ATR(14) проти ручного розрахунку, статистики, фільтри/сортування/пагінація, журнал CRUD + CSV round-trip, backup/restore (replace + merge з перепривʼязкою datasetId), теми, mobile drawer (390/360px без горизонтального скролу), `node --check` усіх JS-файлів, відсутність CDN/API-ключів/абсолютних шляхів. Деталі — у звіті виконавця.

## Тести

Мінімальний regression suite (потрібен лише Node.js, без встановлення залежностей):

`node tests/run-tests.js`

Перевіряє: синтаксис усіх JS (`node --check`), CSV-парсер, детекцію Long/Short, усі 5 результатів симуляції, ATR, статистики (включно з режимами Ambiguous і Profit Factor за нульових збитків), перепривʼязку `datasetId` при merge restore, а також regression baseline sample (420 свічок → 152 сетапи / 122 entered / Win Rate ≈94.3% / PF ≈12.02). Ненульовий exit code = є падіння.

## Ліцензія

Вільне локальне використання. Синтетичний sample-файл — НЕ реальна історія BTC, лише тестові дані.
