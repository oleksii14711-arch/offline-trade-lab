/* app.js — головна логіка: навігація, dashboard, import, lab, stats, journal, settings. */
'use strict';

const S = {
  datasets: [],
  activeDatasetId: null,
  candlesCache: [],       // свічки активного dataset
  candlesTf: '',
  lastResults: [],        // результати останнього run
  lastSimId: null,
  simulations: [],
  presets: [],
  ambiguousMode: 'exclude',
  resView: [],            // відфільтровані
  resSort: { key: 'date', dir: -1 },
  resPage: 0,
  resPerPage: 50,
  journal: [],
  editingJournalId: null
};

function $(id) { return document.getElementById(id); }

function toast(msg) {
  // простий статус: тимчасово показати в run-status або alert для критичного
  console.log('[OTL]', msg);
}

/* ---------- INIT ---------- */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  applyTheme(UIStore.get('theme', 'dark'));
  bindNav();
  bindTheme();
  bindImport();
  bindLab();
  bindStats();
  bindJournal();
  bindSettings();
  bindDashboard();
  try {
    await openDb();
  } catch (e) {
    alert('IndexedDB недоступний: ' + e.message + '\nДані не будуть зберігатися.');
    return;
  }
  S.ambiguousMode = await kvGet('ambiguousMode', 'exclude');
  syncAmbRadios();
  await ensureDefaultPresets();
  await refreshDatasets();
  await refreshPresets();
  await refreshSimulations();
  await refreshJournal();
  renderAll();
  window.OTL_READY = true; // прапорець для smoke-тестів
}

function bindNav() {
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      $('view-' + b.dataset.view).classList.add('active');
      $('sidebar').classList.remove('open');
      $('backdrop').hidden = true;
      if (b.dataset.view === 'dashboard') renderDashboard();
      if (b.dataset.view === 'stats') renderStatsView();
      if (b.dataset.view === 'journal') renderJournalView();
      if (b.dataset.view === 'lab') renderResultsTable();
    });
  });
  $('btn-menu').addEventListener('click', () => {
    const sb = $('sidebar');
    sb.classList.toggle('open');
    $('backdrop').hidden = !sb.classList.contains('open');
  });
  $('backdrop').addEventListener('click', () => {
    $('sidebar').classList.remove('open');
    $('backdrop').hidden = true;
  });
}

/* ---------- THEME ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  UIStore.set('theme', t);
  const b = $('btn-theme');
  if (b) b.textContent = t === 'light' ? '☀️' : '🌙';
}
function bindTheme() {
  $('btn-theme').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    applyTheme(cur === 'light' ? 'dark' : 'light');
    renderAll();
  });
  const b2 = $('btn-theme2');
  if (b2) b2.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    applyTheme(cur === 'light' ? 'dark' : 'light');
    renderAll();
  });
}

/* ---------- DATASETS ---------- */
async function refreshDatasets() {
  S.datasets = await dbGetAll('datasets');
  S.datasets.sort((a, b) => b.createdAt - a.createdAt);
  const sel = $('dataset-select');
  sel.innerHTML = '';
  if (!S.datasets.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = '— немає наборів —';
    sel.appendChild(o);
    S.activeDatasetId = null;
    S.candlesCache = [];
    return;
  }
  for (const d of S.datasets) {
    const o = document.createElement('option');
    o.value = d.id;
    o.textContent = d.name + ' (' + (d.candleCount || 0) + ', ' + (d.timeframe || '?') + ')';
    sel.appendChild(o);
  }
  const saved = Number(UIStore.get('activeDs', ''));
  const exists = S.datasets.some((d) => d.id === saved);
  S.activeDatasetId = exists ? saved : S.datasets[0].id;
  sel.value = String(S.activeDatasetId);
  sel.onchange = async () => {
    S.activeDatasetId = Number(sel.value);
    UIStore.set('activeDs', String(S.activeDatasetId));
    await loadActiveCandles();
    renderAll();
  };
  await loadActiveCandles();
}

async function loadActiveCandles() {
  if (!S.activeDatasetId) { S.candlesCache = []; return; }
  S.candlesCache = await dbGetCandles(S.activeDatasetId);
  const ds = S.datasets.find((d) => d.id === S.activeDatasetId);
  S.candlesTf = ds ? (ds.timeframe || '') : '';
}

function activeDataset() {
  return S.datasets.find((d) => d.id === S.activeDatasetId) || null;
}

function renderAll() {
  renderDashboard();
  renderDatasetsTable();
}

/* ---------- DASHBOARD ---------- */
function bindDashboard() {
  const b = $('btn-load-sample');
  if (b) b.addEventListener('click', loadSample);
}

async function loadSample() {
  try {
    const resp = await fetch('sample/sample-btc.csv');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    const parsed = parseCsvText(text);
    const map = autoMapColumns(parsed.headers);
    const conv = rowsToCandles(parsed.rows, map);
    if (!conv.valid.length) { alert('Тестовий файл не розпізнано.'); return; }
    const tf = detectTimeframe(conv.valid);
    const id = await dbAdd('datasets', {
      name: 'SAMPLE 1h (синтетика)',
      timeframe: tf.label,
      createdAt: Date.now(),
      candleCount: conv.valid.length,
      dateFrom: conv.valid[0].ts,
      dateTo: conv.valid[conv.valid.length - 1].ts
    });
    await dbAddCandlesBatch(id, conv.valid);
    await refreshDatasets();
    S.activeDatasetId = id;
    UIStore.set('activeDs', String(id));
    $('dataset-select').value = String(id);
    await loadActiveCandles();
    renderAll();
  } catch (e) {
    alert('Не вдалося завантажити тестовий файл: ' + e.message);
  }
}

function metricCard(k, v, cls, hint) {
  return '<div class="metric"><div class="k">' + esc(k) + (hint ? tip(hint) : '') + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';
}

async function renderDashboard() {
  const hasData = S.datasets.length > 0;
  $('dash-empty').hidden = hasData;
  const sims = await dbGetAll('simulations');
  sims.sort((a, b) => b.createdAt - a.createdAt);
  const last = sims[0] || null;
  const journal = await dbGetAll('journal');

  let cards = '';
  cards += metricCard('Свічок (активний набір даних)', S.candlesCache.length ? fmtInt(S.candlesCache.length) : '0');
  cards += metricCard('Сетапів (остання симуляція)', last ? fmtInt(last.resultsCount) : '—');
  cards += metricCard('Симуляцій', fmtInt(sims.length));
  if (last && last.stats) {
    const st = last.stats;
    cards += metricCard('Частка виграшів', fmtPct(st.winRate), st.winRate >= 50 ? 'up' : '');
    cards += metricCard('Частка збитків', fmtPct(st.lossRate), st.lossRate > 50 ? 'down' : '');
    cards += metricCard('Середній R', fmtNum(st.avgR), st.avgR >= 0 ? 'up' : 'down', 'Середній R на угоду серед врахованих угод.');
    cards += metricCard('Профіт-фактор', fmtPF(st.profitFactor), '', 'Сума виграшів / сума програшів (в R). >1 — прибутково.');
    cards += metricCard('Очікування', fmtNum(st.expectancy) + ' R', st.expectancy >= 0 ? 'up' : 'down', 'Математичне сподівання угоди в R.');
    cards += metricCard('Макс. просадка', fmtNum(st.maxDrawdown) + ' R', '', 'Максимальна просадка кривої капіталу в R.');
    cards += metricCard('PnL (R)', fmtNum(st.totalR) + ' R', st.totalR >= 0 ? 'up' : 'down');
  } else {
    cards += metricCard('Частка виграшів', '—') + metricCard('Профіт-фактор', '—', '', 'Сума виграшів / сума програшів (в R).') +
      metricCard('Очікування', '—', '', 'Математичне сподівання угоди в R.') + metricCard('Макс. просадка', '—', '', 'Максимальна просадка кривої капіталу в R.');
  }
  $('dash-cards').innerHTML = cards;

  // Останні 10 сетапів
  if (last && last.results && last.results.length) {
    const rows = last.results.slice().sort((a, b) => b.ts - a.ts).slice(0, 10);
    $('dash-setups').innerHTML = '<tr><th>Дата</th><th>Напрям</th><th>Результат</th><th>R</th></tr>' +
      rows.map((t) => '<tr><td>' + esc(fmtDate(t.ts)) + '</td><td>' + esc(directionLabel(t.direction)) + '</td><td class="r-' + esc(String(t.result)) + '">' + esc(resultLabel(t.result)) + '</td><td>' + esc(fmtNum(t.r)) + '</td></tr>').join('');
    // charts
    try {
      drawEquity($('ch-equity'), last.stats.equity || []);
      drawDonut($('ch-donut'), last.stats.wins, last.stats.losses);
      const byM = {};
      for (const t of last.results) {
        if (t.result === 'no_entry') continue;
        const k = monthKey(t.ts);
        byM[k] = (byM[k] || 0) + (t.result === 'sl' ? -1 : (Number(t.r) || 0));
      }
      const mk = Object.keys(byM).sort();
      drawBars($('ch-monthly'), mk, mk.map((k) => byM[k]));
      const byTf = {};
      for (const t of last.results) {
        if (t.result === 'no_entry') continue;
        const k = t.timeframe || '?';
        byTf[k] = (byTf[k] || 0) + (t.result === 'sl' ? -1 : (Number(t.r) || 0));
      }
      drawBars($('ch-tf'), Object.keys(byTf), Object.keys(byTf).map((k) => byTf[k]));
    } catch (e) { console.warn(e); }
    // summary по TF
    const tfGroups = groupBy(last.results.filter((t) => t.result !== 'no_entry'), (t) => t.timeframe || '?');
    let html = '<tr><th>ТФ</th><th>Угоди</th><th>Вигр., %</th><th>R</th></tr>';
    tfGroups.forEach((arr, k) => {
      const s = summarizeResults(arr, S.ambiguousMode);
      html += '<tr><td>' + esc(k) + '</td><td>' + arr.length + '</td><td>' + esc(fmtPct(s.winRate)) + '</td><td>' + esc(fmtNum(s.totalR)) + '</td></tr>';
    });
    $('dash-tf').innerHTML = html;
  } else {
    $('dash-setups').innerHTML = '<tr><td class="muted">Немає симуляцій. Натисніть «Запустити аналіз» у «Лабораторії стратегії».</td></tr>';
    $('dash-tf').innerHTML = '<tr><td class="muted">Немає даних.</td></tr>';
    try {
      drawEquity($('ch-equity'), []); drawDonut($('ch-donut'), 0, 0);
      drawBars($('ch-monthly'), [], []); drawBars($('ch-tf'), [], []);
    } catch (e) {}
  }

  // Останні 10 журналу
  journal.sort((a, b) => Number(b.date) - Number(a.date));
  if (journal.length) {
    $('dash-journal').innerHTML = '<tr><th>Дата</th><th>Символ</th><th>Напрям</th><th>PnL R</th></tr>' +
      journal.slice(0, 10).map((t) => '<tr><td>' + esc(fmtDateShort(t.date)) + '</td><td>' + esc(t.symbol || '') + '</td><td>' + esc(directionLabel(t.side)) + '</td><td>' + esc(fmtNum(Number(t.pnlR) || 0)) + '</td></tr>').join('');
  } else {
    $('dash-journal').innerHTML = '<tr><td class="muted">Журнал порожній.</td></tr>';
  }
}

/* ---------- IMPORT ---------- */
let IMP = { text: '', delim: ',', headers: [], rows: [], map: null, hasHeader: true };

function bindImport() {
  $('file-csv').addEventListener('change', onCsvFile);
  $('sel-delim').addEventListener('change', reparsePreview);
  $('chk-header').addEventListener('change', reparsePreview);
  $('btn-do-import').addEventListener('click', doImport);
}

function onCsvFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    IMP.text = String(rd.result || '');
    const autoName = f.name.replace(/\.[^.]+$/, '');
    if (!$('inp-dsname').value) $('inp-dsname').value = autoName;
    reparsePreview();
  };
  rd.readAsText(f);
}

function currentDelim() {
  const v = $('sel-delim').value;
  if (v === 'auto') return detectDelimiter(IMP.text);
  return v;
}

function reparsePreview() {
  if (!IMP.text) return;
  IMP.hasHeader = $('chk-header').checked;
  const d = currentDelim();
  const rawLines = IMP.text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!rawLines.length) return;
  let headers, rows;
  if (IMP.hasHeader) {
    headers = splitLine(rawLines[0], d);
    rows = rawLines.slice(1).map((l) => splitLine(l, d));
  } else {
    const n = splitLine(rawLines[0], d).length;
    headers = Array.from({ length: n }, (_, i) => 'col' + i);
    rows = rawLines.map((l) => splitLine(l, d));
  }
  IMP.delim = d; IMP.headers = headers; IMP.rows = rows;
  IMP.map = autoMapColumns(headers);
  // preview
  let html = '<tr>' + headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr>';
  rows.slice(0, 20).forEach((r) => {
    html += '<tr>' + headers.map((_, i) => '<td>' + esc(r[i] || '') + '</td>').join('') + '</tr>';
  });
  $('tbl-preview').innerHTML = html;
  $('card-preview').hidden = false;
  const dname = d === ',' ? 'кома' : (d === ';' ? 'крапка з комою' : (d === '\t' ? 'таб' : d));
  $('import-info').textContent = 'Роздільник: ' + dname + ' | Колонок: ' + headers.length + ' | Рядків: ' + rows.length;
  buildMapUI();
}

function buildMapUI() {
  const fields = [['ts', 'Час (timestamp/time/date)'], ['open', 'Open'], ['high', 'High'], ['low', 'Low'], ['close', 'Close'], ['volume', 'Volume (необовʼязково)']];
  const box = $('map-row');
  box.innerHTML = '';
  for (const [key, label] of fields) {
    const lab = document.createElement('label');
    lab.textContent = label;
    const sel = document.createElement('select');
    sel.className = 'select';
    sel.dataset.mapkey = key;
    const none = document.createElement('option');
    none.value = '-1'; none.textContent = '—';
    sel.appendChild(none);
    IMP.headers.forEach((h, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = i + ': ' + h;
      sel.appendChild(o);
    });
    sel.value = String(IMP.map[key] === undefined ? -1 : IMP.map[key]);
    sel.addEventListener('change', () => { IMP.map[sel.dataset.mapkey] = Number(sel.value); checkMap(); });
    lab.appendChild(sel);
    box.appendChild(lab);
  }
  checkMap();
}

function checkMap() {
  const m = IMP.map;
  const missing = ['ts', 'open', 'high', 'low', 'close'].filter((k) => m[k] === -1 || m[k] === undefined);
  $('map-warn').textContent = missing.length ? 'Не визначено колонки: ' + missing.join(', ') + '. Виберіть вручну.' : '';
  return missing.length === 0;
}

async function doImport() {
  if (!IMP.rows.length) { alert('Спочатку виберіть CSV.'); return; }
  if (!checkMap()) { alert('Вкажіть відповідність для всіх обовʼязкових колонок.'); return; }
  const t0 = performance.now();
  const conv = rowsToCandles(IMP.rows, IMP.map);
  const ms = Math.round(performance.now() - t0);
  if (!conv.valid.length) {
    $('import-result').textContent = 'Немає валідних рядків. Пропущено: ' + conv.skipped.length;
    return;
  }
  const tf = detectTimeframe(conv.valid);
  const name = $('inp-dsname').value.trim() || ('dataset-' + new Date().toISOString().slice(0, 10));
  const id = await dbAdd('datasets', {
    name, timeframe: tf.label, createdAt: Date.now(),
    candleCount: conv.valid.length,
    dateFrom: conv.valid[0].ts, dateTo: conv.valid[conv.valid.length - 1].ts
  });
  $('import-result').textContent = 'Збереження ' + conv.valid.length + ' свічок…';
  await dbAddCandlesBatch(id, conv.valid);
  await refreshDatasets();
  S.activeDatasetId = id;
  UIStore.set('activeDs', String(id));
  $('dataset-select').value = String(id);
  await loadActiveCandles();
  const sk = conv.skipped.slice(0, 10).map((s) => 'рядок ' + s.line + ': ' + s.reason).join('; ');
  $('import-result').innerHTML =
    'Валідних: <b>' + conv.valid.length + '</b> | Пропущено: <b>' + conv.skipped.length + '</b> ' +
    '(NaN: ' + conv.errors.nan + ', дублікати: ' + conv.errors.dup + ', OHLC: ' + conv.errors.ohlc + ', порожні: ' + conv.errors.empty + ')<br>' +
    'Діапазон: ' + esc(fmtDate(conv.valid[0].ts)) + ' … ' + esc(fmtDate(conv.valid[conv.valid.length - 1].ts)) +
    ' | ТФ ≈ <b>' + esc(tf.label) + '</b> | ' + ms + ' мс' +
    (sk ? '<br>Приклади пропусків: ' + esc(sk) : '');
  renderAll();
}

function renderDatasetsTable() {
  const t = $('tbl-datasets');
  if (!S.datasets.length) { t.innerHTML = '<tr><td class="muted">Поки немає наборів даних.</td></tr>'; return; }
  t.innerHTML = '<tr><th>ID</th><th>Назва</th><th>ТФ</th><th>Свічок</th><th>Діапазон</th><th>Дії</th></tr>' +
    S.datasets.map((d) =>
      '<tr><td>' + d.id + '</td><td>' + esc(d.name) + '</td><td>' + esc(d.timeframe || '') + '</td><td>' + fmtInt(d.candleCount || 0) +
      '</td><td>' + esc(fmtDateShort(d.dateFrom)) + ' … ' + esc(fmtDateShort(d.dateTo)) + '</td>' +
      '<td><button class="btn" data-act="use" data-id="' + d.id + '">Активний</button> ' +
      '<button class="btn" data-act="ren" data-id="' + d.id + '">Перейменувати</button> ' +
      '<button class="btn" data-act="csv" data-id="' + d.id + '">CSV</button> ' +
      '<button class="btn danger" data-act="del" data-id="' + d.id + '">Видалити</button></td></tr>'
    ).join('');
  t.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    const id = Number(b.dataset.id);
    if (b.dataset.act === 'use') {
      S.activeDatasetId = id; UIStore.set('activeDs', String(id));
      $('dataset-select').value = String(id);
      await loadActiveCandles(); renderAll();
    } else if (b.dataset.act === 'ren') {
      const d = S.datasets.find((x) => x.id === id);
      const nn = prompt('Нова назва набору даних:', d.name);
      if (nn && nn.trim()) { d.name = nn.trim(); await dbPut('datasets', d); await refreshDatasets(); renderDatasetsTable(); }
    } else if (b.dataset.act === 'del') {
      if (!confirm('Видалити набір даних №' + id + ' і всі його свічки?')) return;
      await dbDelete('datasets', id);
      await dbDeleteCandlesOfDataset(id);
      await refreshDatasets(); renderAll();
    } else if (b.dataset.act === 'csv') {
      const candles = await dbGetCandles(id);
      const csv = toCsv(candles.map((c) => ({ ts: new Date(c.ts).toISOString(), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        [{ key: 'ts', label: 'timestamp' }, { key: 'open', label: 'open' }, { key: 'high', label: 'high' }, { key: 'low', label: 'low' }, { key: 'close', label: 'close' }, { key: 'volume', label: 'volume' }]);
      downloadFile('dataset-' + id + '.csv', csv, 'text/csv;charset=utf-8');
    }
  }));
}

/* ---------- STRATEGY LAB ---------- */
function readConfig() {
  return {
    direction: $('cfg-direction').value,
    minRangePct: Number($('cfg-minrange').value),
    maxRangePct: Number($('cfg-maxrange').value),
    minBodyPct: Number($('cfg-minbody').value),
    closeThresholdPct: Number($('cfg-threshold').value),
    entryPct: Number($('cfg-entry').value),
    stopPct: Number($('cfg-stop').value),
    tpPct: Number($('cfg-tp').value),
    maxWaitBars: Number($('cfg-wait').value),
    maxTradeBars: Number($('cfg-life').value),
    useAtr: $('cfg-useatr').checked,
    atrPeriod: Number($('cfg-atrp').value),
    atrMinMult: Number($('cfg-atrm').value),
    minVolume: Number($('cfg-minvol').value),
    c1Dir: $('cfg-c1').value,
    c2Dir: $('cfg-c2').value,
    minBodyRangeRatio: Number($('cfg-bodyratio').value)
  };
}

function writeConfig(cfg) {
  $('cfg-direction').value = cfg.direction;
  $('cfg-minrange').value = cfg.minRangePct;
  $('cfg-maxrange').value = cfg.maxRangePct;
  $('cfg-minbody').value = cfg.minBodyPct;
  $('cfg-threshold').value = cfg.closeThresholdPct;
  $('cfg-entry').value = cfg.entryPct;
  $('cfg-stop').value = cfg.stopPct;
  $('cfg-tp').value = cfg.tpPct;
  $('cfg-wait').value = cfg.maxWaitBars;
  $('cfg-life').value = cfg.maxTradeBars;
  $('cfg-useatr').checked = !!cfg.useAtr;
  $('cfg-atrp').value = cfg.atrPeriod;
  $('cfg-atrm').value = cfg.atrMinMult;
  $('cfg-minvol').value = cfg.minVolume;
  $('cfg-c1').value = cfg.c1Dir || 'any';
  $('cfg-c2').value = cfg.c2Dir || 'any';
  $('cfg-bodyratio').value = cfg.minBodyRangeRatio || 0;
}

function bindLab() {
  $('btn-run').addEventListener('click', runAnalysis);
  ['flt-result', 'flt-dir', 'flt-from', 'flt-to', 'flt-search', 'flt-page'].forEach((id) => {
    $(id).addEventListener('input', () => { S.resPage = 0; S.resPerPage = Number($('flt-page').value); applyResFilters(); });
  });
  $('pg-prev').addEventListener('click', () => { if (S.resPage > 0) { S.resPage--; renderResultsTable(); } });
  $('pg-next').addEventListener('click', () => { S.resPage++; renderResultsTable(); });
  $('btn-export-res').addEventListener('click', exportResultsCsv);
  $('btn-compare').addEventListener('click', runCompare);
  $('btn-preset-load').addEventListener('click', presetLoad);
  $('btn-preset-save').addEventListener('click', presetSave);
  $('btn-preset-rename').addEventListener('click', presetRename);
  $('btn-preset-del').addEventListener('click', presetDelete);
  S.resPerPage = Number($('flt-page').value);
}

async function runAnalysis() {
  if (!S.activeDatasetId) { alert('Спочатку імпортуйте набір даних.'); return; }
  if (!S.candlesCache.length) await loadActiveCandles();
  if (!S.candlesCache.length) { alert('Набір даних порожній.'); return; }
  const cfg = readConfig();
  $('run-status').textContent = 'Аналіз…';
  $('btn-run').disabled = true;
  try {
    const results = await runWithWorkerFallback(S.candlesCache, cfg, S.candlesTf, (p) => {
      $('run-status').textContent = 'Аналіз… ' + Math.round(p * 100) + '%';
    });
    S.lastResults = results;
    const stats = summarizeResults(results, S.ambiguousMode);
    const ds = activeDataset();
    const simId = await dbAdd('simulations', {
      datasetId: S.activeDatasetId,
      datasetName: ds ? ds.name : '',
      timeframe: S.candlesTf,
      config: cfg,
      createdAt: Date.now(),
      resultsCount: results.length,
      stats,
      results
    });
    S.lastSimId = simId;
    await refreshSimulations();
    S.resPage = 0;
    applyResFilters();
    $('run-status').textContent = 'Готово: ' + results.length + ' сетапів, із входом ' + stats.entered + ', виграшів ' + fmtPct(stats.winRate);
    renderDashboard();
  } catch (e) {
    $('run-status').textContent = 'Помилка: ' + e.message;
  } finally {
    $('btn-run').disabled = false;
  }
}

function runWithWorkerFallback(candles, cfg, timeframe, onProgress) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const fail = (e) => { if (!settled) { settled = true; reject(e); } };
    // Спроба через Worker; якщо file:// або помилка — fallback на main thread
    try {
      const w = new Worker('worker/backtest-worker.js');
      const timer = setTimeout(() => { try { w.terminate(); } catch (e) {} fallbackMain(); }, 30000);
      w.onmessage = (e) => {
        const m = e.data || {};
        if (m.ok && m.results) { clearTimeout(timer); w.terminate(); window.OTL_ENGINE = 'worker'; done(m.results); }
        else if (m.ok && m.progress !== undefined) { if (onProgress) onProgress(m.progress * 0.99); }
        else if (m.ok === false) { clearTimeout(timer); w.terminate(); fallbackMain(); }
      };
      w.onerror = () => { clearTimeout(timer); try { w.terminate(); } catch (e) {} fallbackMain(); };
      w.postMessage({ candles, config: cfg, timeframe });
    } catch (e) {
      fallbackMain();
    }
    function fallbackMain() {
      try {
        window.OTL_ENGINE = 'main';
        // чанками, щоб не блокувати UI надовго
        const setups = detectSetups(S.candlesCache, cfg, timeframe);
        const out = [];
        let i = 0;
        const CH = 8000;
        (function step() {
          const end = Math.min(setups.length, i + CH);
          for (; i < end; i++) {
            const sim = simulateSetup(S.candlesCache, setups[i], cfg, setups[i].index);
            out.push(Object.assign({}, setups[i], sim, { date: setups[i].ts, entryLevel: cfg.entryPct, threshold: cfg.closeThresholdPct }));
          }
          if (onProgress) onProgress(setups.length ? i / setups.length : 1);
          if (i < setups.length) setTimeout(step, 0);
          else done(out);
        })();
      } catch (e2) { fail(e2); }
    }
  });
}

/* --- results table --- */
const RES_COLS = [
  { key: 'date', label: 'Дата' },
  { key: 'timeframe', label: 'Таймфрейм' },
  { key: 'direction', label: 'Напрям' },
  { key: 'entry', label: 'Вхід' },
  { key: 'stop', label: 'Стоп' },
  { key: 'target', label: 'TP' },
  { key: 'rangePct', label: 'Діапазон, %' },
  { key: 'atr', label: 'ATR' },
  { key: 'result', label: 'Результат' },
  { key: 'r', label: 'R' },
  { key: 'barsToEntry', label: 'Барів до входу' },
  { key: 'barsInTrade', label: 'Барів в угоді' }
];

function applyResFilters() {
  let arr = S.lastResults.slice();
  const fr = $('flt-result').value, fd = $('flt-dir').value;
  const from = parseDateInput($('flt-from').value), to = parseDateInput($('flt-to').value);
  const q = $('flt-search').value.trim().toLowerCase();
  if (fr) arr = arr.filter((t) => t.result === fr);
  if (fd) arr = arr.filter((t) => t.direction === fd);
  if (from) arr = arr.filter((t) => t.ts >= from);
  if (to) arr = arr.filter((t) => t.ts <= to + 86400000);
  if (q) arr = arr.filter((t) => JSON.stringify(t).toLowerCase().indexOf(q) !== -1);
  const { key, dir } = S.resSort;
  arr.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return ((av > bv) ? 1 : (av < bv ? -1 : 0)) * dir;
  });
  S.resView = arr;
  renderResultsTable();
}

function renderResultsTable() {
  const t = $('tbl-results');
  if (!t) return;
  $('res-count').textContent = S.lastResults.length ? '(' + S.resView.length + ' / ' + S.lastResults.length + ')' : '(немає результатів — натисніть «Запустити аналіз»)';
  const per = S.resPerPage || 50;
  const pages = Math.max(1, Math.ceil(S.resView.length / per));
  if (S.resPage >= pages) S.resPage = pages - 1;
  const start = S.resPage * per;
  const page = S.resView.slice(start, start + per);
  let html = '<tr>' + RES_COLS.map((c) => '<th data-k="' + c.key + '">' + esc(c.label) + (S.resSort.key === c.key ? (S.resSort.dir === 1 ? ' ▲' : ' ▼') : '') + '</th>').join('') + '</tr>';
  for (const r of page) {
    html += '<tr><td>' + esc(fmtDate(r.date || r.ts)) + '</td><td>' + esc(r.timeframe || '') + '</td><td>' + esc(directionLabel(r.direction)) +
      '</td><td>' + esc(fmtNum(r.entry, 4)) + '</td><td>' + esc(fmtNum(r.stop, 4)) + '</td><td>' + esc(fmtNum(r.target, 4)) +
      '</td><td>' + esc(fmtNum(r.rangePct)) + '</td><td>' + (r.atr === null || r.atr === undefined || Number.isNaN(r.atr) ? '—' : esc(fmtNum(r.atr, 4))) +
      '</td><td class="r-' + esc(String(r.result)) + '">' + esc(resultLabel(r.result)) + '</td><td>' + esc(fmtNum(r.r)) +
      '</td><td>' + (r.barsToEntry === null || r.barsToEntry === undefined ? '—' : r.barsToEntry) +
      '</td><td>' + (r.barsInTrade || 0) + '</td></tr>';
  }
  if (!page.length) html += '<tr><td colspan="12" class="muted">Немає рядків.</td></tr>';
  t.innerHTML = html;
  t.querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (S.resSort.key === k) S.resSort.dir *= -1;
    else S.resSort = { key: k, dir: 1 };
    applyResFilters();
  }));
  $('pg-info').textContent = 'Сторінка ' + (S.resPage + 1) + ' / ' + pages;
}

function exportResultsCsv() {
  if (!S.resView.length) { alert('Немає результатів для експорту.'); return; }
  const cols = [
    { key: 'date', label: 'Date' }, { key: 'timeframe', label: 'Timeframe' }, { key: 'direction', label: 'Direction' },
    { key: 'entry', label: 'Entry' }, { key: 'stop', label: 'Stop' }, { key: 'target', label: 'TP' },
    { key: 'rangePct', label: 'Range %' }, { key: 'atr', label: 'ATR' }, { key: 'result', label: 'Result' },
    { key: 'r', label: 'R' }, { key: 'barsToEntry', label: 'Bars to Entry' }, { key: 'barsInTrade', label: 'Bars in Trade' }
  ];
  const rows = S.resView.map((r) => Object.assign({}, r, { date: fmtDate(r.date || r.ts) }));
  downloadFile('backtest-results.csv', toCsv(rows, cols), 'text/csv;charset=utf-8');
}

const CMP_PARAM_LABELS = {
  closeThresholdPct: 'Поріг закриття', entryPct: 'Рівень входу', stopPct: 'Рівень стопа',
  tpPct: 'Тейк-профіт', minBodyPct: 'Мін. тіло свічки 2'
};

/* --- compare --- */
async function runCompare() {
  if (!S.activeDatasetId) { alert('Спочатку імпортуйте набір даних.'); return; }
  if (!S.candlesCache.length) await loadActiveCandles();
  const param = $('cmp-param').value;
  const vals = $('cmp-values').value.split(',').map((s) => Number(s.trim())).filter((v) => !Number.isNaN(v));
  if (!vals.length) { alert('Вкажіть числові значення через кому.'); return; }
  const base = readConfig();
  const rows = [];
  for (const v of vals) {
    const cfg = Object.assign({}, base);
    cfg[param] = v;
    const results = runBacktest(S.candlesCache, cfg, S.candlesTf);
    const st = summarizeResults(results, S.ambiguousMode);
    rows.push({ param: (CMP_PARAM_LABELS[param] || param) + ' = ' + v, trades: st.entered, winRate: st.winRate, pf: st.profitFactor, exp: st.expectancy, dd: st.maxDrawdown });
  }
  $('tbl-compare').innerHTML = '<tr><th>Параметр</th><th>Угоди</th><th>Частка виграшів</th><th>Профіт-фактор</th><th>Очікування</th><th>Макс. просадка</th></tr>' +
    rows.map((r) => '<tr><td>' + esc(r.param) + '</td><td>' + r.trades + '</td><td>' + esc(fmtPct(r.winRate)) + '</td><td>' +
      esc(fmtPF(r.pf)) + '</td><td>' + esc(fmtNum(r.exp)) + ' R</td><td>' + esc(fmtNum(r.dd)) + ' R</td></tr>').join('') +
    '<tr><td colspan="6" class="muted">Таблиця — лише статистичне порівняння. Жоден параметр не позначено «найкращим».</td></tr>';
}

/* --- presets --- */
async function ensureDefaultPresets() {
  const all = await dbGetAll('presets');
  if (all.length) { S.presets = all; return; }
  for (const p of defaultPresets()) {
    await dbAdd('presets', { name: p.name, config: p.config, createdAt: Date.now() });
  }
  S.presets = await dbGetAll('presets');
}

async function refreshPresets() {
  S.presets = await dbGetAll('presets');
  const sel = $('sel-preset');
  sel.innerHTML = S.presets.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('');
}

function selectedPreset() {
  const id = Number($('sel-preset').value);
  return S.presets.find((p) => p.id === id) || null;
}

async function presetLoad() {
  const p = selectedPreset();
  if (!p) { alert('Немає пресетів.'); return; }
  writeConfig(p.config);
  toast('Preset завантажено: ' + p.name);
}

async function presetSave() {
  const name = prompt('Назва пресету:', 'My preset');
  if (!name || !name.trim()) return;
  await dbAdd('presets', { name: name.trim(), config: readConfig(), createdAt: Date.now() });
  await refreshPresets();
}

async function presetRename() {
  const p = selectedPreset();
  if (!p) return;
  const nn = prompt('Нова назва:', p.name);
  if (!nn || !nn.trim()) return;
  p.name = nn.trim();
  await dbPut('presets', p);
  await refreshPresets();
}

async function presetDelete() {
  const p = selectedPreset();
  if (!p) return;
  if (!confirm('Видалити пресет «' + p.name + '»?')) return;
  await dbDelete('presets', p.id);
  await refreshPresets();
}

/* ---------- STATISTICS VIEW ---------- */
function bindStats() {
  $('sel-sim').addEventListener('change', renderStatsView);
  $('btn-sim-del').addEventListener('click', async () => {
    const id = Number($('sel-sim').value);
    if (!id) return;
    if (!confirm('Видалити симуляцію №' + id + '?')) return;
    await dbDelete('simulations', id);
    await refreshSimulations();
    renderStatsView();
    renderDashboard();
  });
}

async function refreshSimulations() {
  S.simulations = await dbGetAll('simulations');
  S.simulations.sort((a, b) => b.createdAt - a.createdAt);
  const sel = $('sel-sim');
  sel.innerHTML = S.simulations.length
    ? S.simulations.map((s) => '<option value="' + s.id + '">#' + s.id + ' · ' + esc(s.datasetName || '') + ' · ' + esc(fmtDate(s.createdAt)) + ' · ' + s.resultsCount + ' сетапів</option>').join('')
    : '<option value="">— немає симуляцій —</option>';
  if (S.simulations.length && !S.simulations.some((s) => s.id === S.lastSimId)) {
    S.lastSimId = S.simulations[0].id;
    S.lastResults = S.simulations[0].results || [];
    S.resView = S.lastResults.slice();
  }
  if (S.lastSimId) sel.value = String(S.lastSimId);
}

function currentSim() {
  const id = Number($('sel-sim').value) || S.lastSimId;
  return S.simulations.find((s) => s.id === id) || S.simulations[0] || null;
}

function renderStatsView() {
  const sim = currentSim();
  if (!sim) {
    $('stats-cards').innerHTML = '<div class="muted">Немає симуляцій. Запустіть Run Analysis у Strategy Lab.</div>';
    return;
  }
  S.lastSimId = sim.id;
  const st = sim.stats || summarizeResults(sim.results || [], S.ambiguousMode);
  const res = sim.results || [];
  let h = '';
  h += metricCard('Усього сетапів', fmtInt(st.total));
  h += metricCard('Угод із входом', fmtInt(st.entered));
  h += metricCard('Виграші', fmtInt(st.wins), 'up');
  h += metricCard('Збитки', fmtInt(st.losses), 'down');
  h += metricCard('Без входу', fmtInt(st.noEntry));
  h += metricCard('Тайм-аут', fmtInt(st.timeout));
  h += metricCard('Невизначені', fmtInt(st.ambiguous), '', 'Подвійний дотик TP+SL в одному барі. Трактування — у «Налаштуваннях».');
  h += metricCard('Частка виграшів', fmtPct(st.winRate));
  h += metricCard('Частка збитків', fmtPct(st.lossRate));
  h += metricCard('Середній R', fmtNum(st.avgR) + ' R', st.avgR >= 0 ? 'up' : 'down');
  h += metricCard('Медіанний R', fmtNum(st.medR) + ' R');
  h += metricCard('Профіт-фактор', fmtPF(st.profitFactor), '', 'Сума виграшів / сума програшів (в R). >1 — прибутково.');
  h += metricCard('Очікування', fmtNum(st.expectancy) + ' R', '', 'Математичне сподівання угоди в R.');
  h += metricCard('Макс. серія виграшів', fmtInt(st.maxWinStreak));
  h += metricCard('Макс. серія збитків', fmtInt(st.maxLossStreak));
  h += metricCard('Макс. просадка', fmtNum(st.maxDrawdown) + ' R', '', 'Максимальна просадка кривої капіталу в R.');
  h += metricCard('Середньо барів до входу', fmtNum(st.avgBarsToEntry, 1));
  h += metricCard('Середньо барів в угоді', fmtNum(st.avgBarsInTrade, 1));
  h += metricCard('Сумарний R', fmtNum(st.totalR) + ' R', st.totalR >= 0 ? 'up' : 'down');
  $('stats-cards').innerHTML = h;

  try {
    drawEquity($('ch2-equity'), st.equity || []);
    drawDonut($('ch2-donut'), st.wins, st.losses);
    const byM = {};
    for (const t of res) {
      if (t.result === 'no_entry') continue;
      const k = monthKey(t.ts);
      byM[k] = (byM[k] || 0) + (t.result === 'sl' ? -1 : (Number(t.r) || 0));
    }
    const mk = Object.keys(byM).sort();
    drawBars($('ch2-monthly'), mk, mk.map((k) => byM[k]));
    const byThr = {};
    for (const t of res) {
      if (t.result === 'no_entry') continue;
      const k = String(t.threshold !== undefined ? t.threshold : (sim.config ? sim.config.closeThresholdPct : '?'));
      (byThr[k] = byThr[k] || []).push(t);
    }
    const tk = Object.keys(byThr).sort((a, b) => Number(a) - Number(b));
    drawBars($('ch2-thr'), tk.map((k) => 'поріг ' + k), tk.map((k) => summarizeResults(byThr[k], S.ambiguousMode).winRate));
  } catch (e) { console.warn(e); }

  // розрізи
  const dirG = groupBy(res, (t) => t.direction || '?');
  $('tbl-s-dir').innerHTML = '<tr><th>Напрям</th><th>Усього</th><th>Із входом</th><th>Вигр., %</th><th>Сер. R</th><th>PF</th><th>R</th></tr>' +
    Array.from(dirG.entries()).map(([k, arr]) => {
      const s = summarizeResults(arr, S.ambiguousMode);
      return '<tr><td>' + esc(directionLabel(k)) + '</td><td>' + arr.length + '</td><td>' + s.entered + '</td><td>' + esc(fmtPct(s.winRate)) + '</td><td>' + esc(fmtNum(s.avgR)) + '</td><td>' + esc(fmtPF(s.profitFactor)) + '</td><td>' + esc(fmtNum(s.totalR)) + '</td></tr>';
    }).join('');

  const tfG = groupBy(res, (t) => t.timeframe || '?');
  $('tbl-s-tf').innerHTML = '<tr><th>ТФ</th><th>Усього</th><th>Вигр., %</th><th>R</th></tr>' +
    Array.from(tfG.entries()).map(([k, arr]) => {
      const s = summarizeResults(arr, S.ambiguousMode);
      return '<tr><td>' + esc(k) + '</td><td>' + arr.length + '</td><td>' + esc(fmtPct(s.winRate)) + '</td><td>' + esc(fmtNum(s.totalR)) + '</td></tr>';
    }).join('');

  const yG = groupBy(res, (t) => yearKey(t.ts));
  $('tbl-s-year').innerHTML = '<tr><th>Рік</th><th>Усього</th><th>Вигр., %</th><th>R</th></tr>' +
    Array.from(yG.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, arr]) => {
      const s = summarizeResults(arr, S.ambiguousMode);
      return '<tr><td>' + esc(k) + '</td><td>' + arr.length + '</td><td>' + esc(fmtPct(s.winRate)) + '</td><td>' + esc(fmtNum(s.totalR)) + '</td></tr>';
    }).join('');

  const mG = groupBy(res, (t) => monthKey(t.ts));
  $('tbl-s-month').innerHTML = '<tr><th>Місяць</th><th>Усього</th><th>Вигр., %</th><th>R</th></tr>' +
    Array.from(mG.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, arr]) => {
      const s = summarizeResults(arr, S.ambiguousMode);
      return '<tr><td>' + esc(k) + '</td><td>' + arr.length + '</td><td>' + esc(fmtPct(s.winRate)) + '</td><td>' + esc(fmtNum(s.totalR)) + '</td></tr>';
    }).join('');

  const thrG = groupBy(res, (t) => String(t.threshold !== undefined ? t.threshold : '?'));
  $('tbl-s-thr').innerHTML = '<tr><th>Поріг</th><th>Усього</th><th>Вигр., %</th><th>PF</th><th>Очік.</th></tr>' +
    Array.from(thrG.entries()).map(([k, arr]) => {
      const s = summarizeResults(arr, S.ambiguousMode);
      return '<tr><td>' + esc(k) + '</td><td>' + arr.length + '</td><td>' + esc(fmtPct(s.winRate)) + '</td><td>' + esc(fmtPF(s.profitFactor)) + '</td><td>' + esc(fmtNum(s.expectancy)) + '</td></tr>';
    }).join('');

  const eG = groupBy(res, (t) => String(t.entryLevel !== undefined ? t.entryLevel : '?'));
  $('tbl-s-entry').innerHTML = '<tr><th>Вхід, %</th><th>Усього</th><th>Вигр., %</th><th>PF</th><th>Очік.</th></tr>' +
    Array.from(eG.entries()).map(([k, arr]) => {
      const s = summarizeResults(arr, S.ambiguousMode);
      return '<tr><td>' + esc(k) + '</td><td>' + arr.length + '</td><td>' + esc(fmtPct(s.winRate)) + '</td><td>' + esc(fmtPF(s.profitFactor)) + '</td><td>' + esc(fmtNum(s.expectancy)) + '</td></tr>';
    }).join('');
}

/* ---------- JOURNAL ---------- */
const J_FIELDS = [
  ['date', 'Дата', 'date'], ['symbol', 'Символ', 'text'], ['exchange', 'Біржа', 'text'],
  ['side', 'Лонг/Шорт', 'side'], ['timeframe', 'Таймфрейм', 'text'],
  ['entry', 'Вхід', 'number'], ['stop', 'Стоп', 'number'], ['tp', 'Тейк-профіт', 'number'], ['exit', 'Вихід', 'number'],
  ['size', 'Розмір позиції', 'number'], ['riskUsdt', 'Ризик, USDT', 'number'],
  ['pnlUsdt', 'PnL, USDT', 'number'], ['pnlR', 'PnL, R', 'number'],
  ['strategy', 'Стратегія', 'text'], ['result', 'Виграш/Збиток/Беззбиток', 'result'],
  ['tags', 'Теги (через кому)', 'text'], ['mistake', 'Помилка?', 'text'], ['followedPlan', 'За планом?', 'yn'],
  ['comment', 'Коментар', 'textarea']
];

function bindJournal() {
  $('btn-j-add').addEventListener('click', () => openJournalModal(null));
  $('btn-j-save').addEventListener('click', saveJournalModal);
  $('btn-j-cancel').addEventListener('click', closeJournalModal);
  // A11y: Escape закриває modal, Tab утримується всередині (focus trap).
  document.addEventListener('keydown', (e) => {
    const m = $('jmodal');
    if (!m || m.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); closeJournalModal(); return; }
    if (e.key === 'Tab') {
      const f = Array.from(m.querySelectorAll('.modal-box button, .modal-box input, .modal-box select, .modal-box textarea'))
        .filter((el) => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  ['j-search', 'j-side', 'j-result', 'j-tf'].forEach((id) => $(id).addEventListener('input', renderJournalView));
  $('btn-j-exp').addEventListener('click', () => {
    if (!S.journal.length) { alert('Журнал порожній.'); return; }
    downloadFile('trade-journal.csv', journalToCsv(S.journal), 'text/csv;charset=utf-8');
  });
  $('file-jimp').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const rows = journalFromCsv(text);
    if (!rows.length) { alert('Не знайдено валідних рядків.'); return; }
    if (!confirm('Імпортувати ' + rows.length + ' записів у журнал? Існуючі дані збережуться.')) return;
    for (const r of rows) await dbAdd('journal', r);
    await refreshJournal();
    renderJournalView();
    renderDashboard();
    e.target.value = '';
  });
}

async function refreshJournal() {
  S.journal = await journalList();
}

function closeJournalModal() {
  const m = $('jmodal');
  if (!m || m.hidden) return;
  m.hidden = true;
  if (S.modalOpener && document.contains(S.modalOpener)) {
    try { S.modalOpener.focus(); } catch (e) {}
  }
  S.modalOpener = null;
}

function openJournalModal(rec) {
  S.editingJournalId = rec ? rec.id : null;
  if (!S.modalOpener) S.modalOpener = document.activeElement;
  $('jmodal-title').textContent = rec ? 'Редагувати угоду №' + rec.id : 'Нова угода';
  const box = $('jform');
  box.innerHTML = '';
  for (const [key, label, type] of J_FIELDS) {
    const lab = document.createElement('label');
    lab.textContent = label;
    let inp;
    if (type === 'side') {
      inp = document.createElement('select'); inp.className = 'select';
      inp.innerHTML = '<option value="long">Лонг</option><option value="short">Шорт</option>';
    } else if (type === 'result') {
      inp = document.createElement('select'); inp.className = 'select';
      inp.innerHTML = '<option value="win">Виграш</option><option value="loss">Збиток</option><option value="be">Беззбиток</option>';
    } else if (type === 'yn') {
      inp = document.createElement('select'); inp.className = 'select';
      inp.innerHTML = '<option value="Yes">Так</option><option value="No">Ні</option>';
    } else if (type === 'textarea') {
      inp = document.createElement('textarea'); inp.className = 'input'; inp.rows = 2;
    } else {
      inp = document.createElement('input'); inp.className = 'input';
      inp.type = type === 'date' ? 'date' : (type === 'number' ? 'number' : 'text');
      if (type === 'number') inp.step = 'any';
    }
    inp.dataset.fkey = key;
    let val = rec ? rec[key] : '';
    if (key === 'date' && val) {
      const d = new Date(Number(val));
      val = d.toISOString().slice(0, 10);
    }
    if (key === 'side' && !val) val = 'long';
    if (key === 'result' && !val) val = 'win';
    inp.value = val === undefined || val === null ? '' : val;
    lab.appendChild(inp);
    box.appendChild(lab);
  }
  $('jmodal').hidden = false;
  const firstField = box.querySelector('input, select, textarea');
  if (firstField) { try { firstField.focus(); } catch (e) {} }
}

async function saveJournalModal() {
  const obj = {};
  document.querySelectorAll('#jform [data-fkey]').forEach((inp) => {
    const k = inp.dataset.fkey;
    obj[k] = inp.value;
  });
  obj.date = obj.date ? Date.parse(obj.date) : Date.now();
  if (Number.isNaN(obj.date)) obj.date = Date.now();
  ['entry', 'stop', 'tp', 'exit', 'size', 'riskUsdt', 'pnlUsdt', 'pnlR'].forEach((f) => { obj[f] = Number(obj[f]) || 0; });
  if (S.editingJournalId) {
    obj.id = S.editingJournalId;
    await journalUpdate(obj);
  } else {
    await journalAdd(obj);
  }
  closeJournalModal();
  await refreshJournal();
  renderJournalView();
  renderDashboard();
}

function renderJournalView() {
  const q = $('j-search').value.trim().toLowerCase();
  const side = $('j-side').value, res = $('j-result').value, tf = $('j-tf').value.trim().toLowerCase();
  let arr = S.journal.slice();
  if (side) arr = arr.filter((t) => String(t.side).toLowerCase() === side);
  if (res) arr = arr.filter((t) => String(t.result).toLowerCase() === res);
  if (tf) arr = arr.filter((t) => String(t.timeframe || '').toLowerCase().indexOf(tf) !== -1);
  if (q) arr = arr.filter((t) => ((t.symbol || '') + ' ' + (t.strategy || '') + ' ' + (t.comment || '') + ' ' + (t.tags || '')).toLowerCase().indexOf(q) !== -1);

  $('tbl-journal').innerHTML = '<tr><th>Дата</th><th>Символ</th><th>Напрям</th><th>ТФ</th><th>Вхід</th><th>Вихід</th><th>PnL USDT</th><th>PnL R</th><th>Результат</th><th>Стратегія</th><th>За планом?</th><th>Дії</th></tr>' +
    (arr.map((t) =>
      '<tr><td>' + esc(fmtDateShort(t.date)) + '</td><td>' + esc(t.symbol || '') + '</td><td>' + esc(directionLabel(t.side)) + '</td><td>' + esc(t.timeframe || '') +
      '</td><td>' + esc(fmtNum(Number(t.entry) || 0, 4)) + '</td><td>' + esc(fmtNum(Number(t.exit) || 0, 4)) + '</td><td>' + esc(fmtNum(Number(t.pnlUsdt) || 0)) +
      '</td><td>' + esc(fmtNum(Number(t.pnlR) || 0)) + '</td><td class="r-' + esc(String(t.result).toLowerCase()) + '">' + esc(journalResultLabel(String(t.result || '').toLowerCase())) + '</td><td>' + esc(t.strategy || '') +
      '</td><td>' + esc(t.followedPlan === 'Yes' ? 'Так' : (t.followedPlan === 'No' ? 'Ні' : (t.followedPlan || ''))) + '</td><td><button class="btn" data-jedit="' + t.id + '">Редагувати</button> <button class="btn danger" data-jdel="' + t.id + '">Видалити</button></td></tr>'
    ).join('') || '<tr><td colspan="12" class="muted">Немає записів.</td></tr>');

  $('tbl-journal').querySelectorAll('[data-jedit]').forEach((b) => b.addEventListener('click', async () => {
    const rec = await dbGet('journal', Number(b.getAttribute('data-jedit')));
    if (rec) openJournalModal(rec);
  }));
  $('tbl-journal').querySelectorAll('[data-jdel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Видалити запис №' + b.getAttribute('data-jdel') + '?')) return;
    await journalRemove(Number(b.getAttribute('data-jdel')));
    await refreshJournal();
    renderJournalView();
    renderDashboard();
  }));

  // статистика (за фільтром)
  const s = summarizeJournal(arr);
  let h = '';
  h += metricCard('Угод', fmtInt(s.count));
  h += metricCard('Частка виграшів', fmtPct(s.winRate), s.winRate >= 50 ? 'up' : '');
  h += metricCard('Сумарний PnL', fmtNum(s.pnl) + ' USDT', s.pnl >= 0 ? 'up' : 'down');
  h += metricCard('Сумарний R', fmtNum(s.rTot) + ' R', s.rTot >= 0 ? 'up' : 'down');
  h += metricCard('Середній виграш', fmtNum(s.avgWin) + ' USDT', 'up');
  h += metricCard('Середній збиток', fmtNum(s.avgLoss) + ' USDT', 'down');
  h += metricCard('Профіт-фактор', fmtPF(s.profitFactor), '', 'Сума виграшів / сума програшів.');
  h += metricCard('Очікування', fmtNum(s.expectancy) + ' R', '', 'Середній R на угоду.');
  h += metricCard('Макс. просадка', fmtNum(s.maxDrawdown) + ' R', '', 'Максимальна просадка кривої капіталу в R.');
  $('jstats-cards').innerHTML = h;

  const g = (fn) => groupBy(arr, fn);
  const tbl = (el, mp, valFn) => {
    $(el).innerHTML = '<tr><th>Група</th><th>N</th><th>Вигр., %</th><th>PnL</th><th>R</th></tr>' +
      (Array.from(mp.entries()).map(([k, list]) => {
        const ss = summarizeJournal(list);
        return '<tr><td>' + esc(k || '?') + '</td><td>' + list.length + '</td><td>' + esc(fmtPct(ss.winRate)) + '</td><td>' + esc(fmtNum(ss.pnl)) + '</td><td>' + esc(fmtNum(ss.rTot)) + '</td></tr>';
      }).join('') || '<tr><td colspan="5" class="muted">—</td></tr>');
  };
  tbl('tbl-j-dir', g((t) => directionLabel(t.side) || '?'));
  tbl('tbl-j-tf', g((t) => t.timeframe || '?'));
  tbl('tbl-j-strat', g((t) => t.strategy || '?'));
  tbl('tbl-j-month', g((t) => monthKey(t.date)));
}

/* ---------- SETTINGS / BACKUP ---------- */
function formatRestoreReport(rep) {
  if (!rep) return 'Резервну копію відновлено.';
  if (rep.mode === 'replace') return 'Резервну копію відновлено (замінити): дані замінено повністю.';
  let msg = 'Резервну копію відновлено (обʼєднати): наборів даних додано ' + rep.datasetsAdded +
    ', свічок ' + rep.candlesAdded + ', симуляцій ' + rep.simulationsAdded + '.';
  if (rep.remapped && rep.remapped.length) {
    msg += ' Перепривʼязка наборів даних: ' + rep.remapped.map((m) => m.from + '→' + m.to).join(', ') + '.';
  }
  const orph = (rep.orphanCandles || 0) + (rep.orphanSimulations || 0);
  if (orph > 0) {
    msg += ' УВАГА: пропущено записів без відповідного набору даних у копії: ' + orph +
      ' (свічок: ' + rep.orphanCandles + ', симуляцій: ' + rep.orphanSimulations + ').';
  }
  return msg;
}

function syncAmbRadios() {
  document.querySelectorAll('input[name="amb"]').forEach((r) => {
    r.checked = r.value === S.ambiguousMode;
    r.addEventListener('change', async () => {
      S.ambiguousMode = document.querySelector('input[name="amb"]:checked').value;
      await kvSet('ambiguousMode', S.ambiguousMode);
      // перерахувати stats останньої симуляції
      if (S.lastResults.length) {
        const st = summarizeResults(S.lastResults, S.ambiguousMode);
        if (S.lastSimId) {
          const sim = await dbGet('simulations', S.lastSimId);
          if (sim) { sim.stats = st; await dbPut('simulations', sim); }
        }
        await refreshSimulations();
        renderDashboard();
        renderStatsView();
      }
    });
  });
}

function bindSettings() {
  $('btn-backup').addEventListener('click', async () => {
    const b = await buildBackup();
    downloadFile('offline-trade-lab-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(b), 'application/json');
    const s = backupSummary(b);
    $('backup-info').textContent = 'Резервну копію створено: наборів даних ' + s.datasets + ', свічок ' + s.candles + ', пресетів ' + s.presets + ', симуляцій ' + s.simulations + ', журналу ' + s.journal + '.';
  });
  $('file-backup').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const b = JSON.parse(await f.text());
      const err = validateBackup(b);
      if (err) { alert('Резервну копію відхилено: ' + err); return; }
      const s = backupSummary(b);
      const msg = 'Резервна копія від ' + (b.exportedAt || '?') + ':\n- наборів даних: ' + s.datasets + '\n- свічок: ' + s.candles + '\n- пресетів: ' + s.presets + '\n- симуляцій: ' + s.simulations + '\n- журналу: ' + s.journal +
        '\n\nOK — ЗАМІНИТИ всі поточні дані.\nСкасувати (Cancel) — ОБʼЄДНАТИ з існуючими (merge).';
      let mode = 'merge';
      if (confirm(msg + '\n\nНатисніть OK для ЗАМІНИ, Cancel для ОБʼЄДНАННЯ.')) mode = 'replace';
      else if (!confirm('Підтвердити ОБʼЄДНАННЯ (додати копію до існуючих даних)?')) return;
      const rep = await restoreBackup(b, mode);
      S.ambiguousMode = await kvGet('ambiguousMode', 'exclude');
      syncAmbRadios();
      await refreshDatasets(); await refreshPresets(); await refreshSimulations(); await refreshJournal();
      S.lastResults = []; S.resView = [];
      renderAll(); renderStatsView(); renderJournalView();
      $('backup-info').textContent = formatRestoreReport(rep);
    } catch (err) {
      alert('Помилка імпорту: ' + err.message);
    }
    e.target.value = '';
  });
  $('btn-reset').addEventListener('click', async () => {
    if (!confirm('УВАГА: видалити ВСІ дані (набори даних, симуляції, журнал, пресети)?')) return;
    if (!confirm('Підтвердіть вдруге: це незворотньо. Видалити все?')) return;
    await resetAllData();
    S.datasets = []; S.candlesCache = []; S.lastResults = []; S.resView = []; S.journal = [];
    S.activeDatasetId = null; S.lastSimId = null;
    await ensureDefaultPresets();
    await refreshDatasets(); await refreshPresets(); await refreshSimulations(); await refreshJournal();
    renderAll(); renderStatsView(); renderJournalView();
  });
}
