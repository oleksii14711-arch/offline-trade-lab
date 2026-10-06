/* tests/run-tests.js — мінімальний regression suite Offline Trade Lab.
 * Запуск: node tests/run-tests.js  (з кореня проєкту, потрібен лише Node.js)
 * Нічого не встановлює. Exit code 0 = усе зелене, 1 = є падіння.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

// ---- 0. node --check усіх JS ----
const JS_FILES = [
  'js/utils.js', 'js/db.js', 'js/csv.js', 'js/strategy.js', 'js/backtest.js',
  'js/statistics.js', 'js/charts.js', 'js/journal.js', 'js/backup.js', 'js/app.js',
  'worker/backtest-worker.js', 'tests/run-tests.js'
];
for (const f of JS_FILES) {
  try {
    execSync('node --check ' + JSON.stringify(path.join(ROOT, f)), { stdio: 'pipe' });
    ok('syntax ' + f, true);
  } catch (e) { ok('syntax ' + f, false, 'node --check failed'); }
}

// ---- browser-файли в Node: utils як globals (як у <script> послідовності) ----
const utils = require(path.join(ROOT, 'js/utils.js'));
Object.assign(global, utils);
const csv = require(path.join(ROOT, 'js/csv.js'));
const st = require(path.join(ROOT, 'js/strategy.js'));
const bt = require(path.join(ROOT, 'js/backtest.js'));
const ss = require(path.join(ROOT, 'js/statistics.js'));
const bk = require(path.join(ROOT, 'js/backup.js'));
const jr = require(path.join(ROOT, 'js/journal.js'));

// ---- 1. CSV parser ----
ok('csv delim comma', csv.detectDelimiter('a,b,c\n1,2,3') === ',');
ok('csv delim semi', csv.detectDelimiter('a;b;c\n1;2;3') === ';');
ok('csv delim tab', csv.detectDelimiter('a\tb\tc\n1\t2\t3') === '\t');
const sampleText = fs.readFileSync(path.join(ROOT, 'sample/sample-btc.csv'), 'utf8');
const p = csv.parseCsvText(sampleText);
ok('csv sample headers', p.headers.join(',') === 'timestamp,open,high,low,close,volume', p.headers.join(','));
ok('csv sample 420 rows', p.rows.length === 420, String(p.rows.length));
const map = csv.autoMapColumns(p.headers);
ok('csv automap', map.ts === 0 && map.open === 1 && map.high === 2 && map.low === 3 && map.close === 4 && map.volume === 5, JSON.stringify(map));
const conv = csv.rowsToCandles(p.rows, map);
ok('csv sample 420 valid', conv.valid.length === 420, conv.valid.length + ' skipped:' + conv.skipped.length);
ok('csv sample sorted', conv.valid.every((c, i, a) => i === 0 || a[i - 1].ts < c.ts));
ok('csv sample tf 1h', csv.detectTimeframe(conv.valid).label === '1h');
const bad = { headers: ['timestamp', 'open', 'high', 'low', 'close', 'volume'], rows: [
  ['2024-01-01T00:00:00Z', '100', '102', '99', '101', '10'],
  ['2024-01-01T00:00:00Z', '100', '102', '99', '101', '10'],
  ['2024-01-01T01:00:00Z', '100', '98', '99', '101', '10'],
  ['2024-01-01T02:00:00Z', '100', '102', '99', '200', '10'],
  ['bad-date', '100', '102', '99', '101', '10'],
  ['', '', '', '', '', '']
]};
const cBad = csv.rowsToCandles(bad.rows, csv.autoMapColumns(bad.headers));
ok('csv bad rows: 1 valid', cBad.valid.length === 1, 'valid=' + cBad.valid.length);
ok('csv bad rows: 5 skipped', cBad.skipped.length === 5, 'skipped=' + cBad.skipped.length);
ok('csv ts seconds', csv.parseTs('1704067200') === 1704067200000);
ok('csv ts millis', csv.parseTs('1704067200000') === 1704067200000);
ok('csv ts iso', csv.parseTs('2024-01-01T00:00:00Z') === 1704067200000);
const mCap = csv.autoMapColumns(['Open time', 'Open', 'High', 'Low', 'Close', 'Volume']);
ok('csv capital headers map', mCap.ts === 0 && mCap.open === 1 && mCap.close === 4, JSON.stringify(mCap));
const pSemi = csv.parseCsvText('Open time;Open;High;Low;Close;Volume\n2024-01-01T00:00:00Z;100;102;99;101;10', ';');
ok('csv semicolon parse', pSemi.headers.length === 6 && pSemi.rows.length === 1);

// ---- 2. ATR ----
const flat = [{ high: 101, low: 99, close: 100 }, { high: 101, low: 99, close: 100 }, { high: 101, low: 99, close: 100 }];
const atr = st.computeAtr(flat, 2);
ok('atr constant TR=2', Math.abs(atr[1] - 2) < 1e-9 && Math.abs(atr[2] - 2) < 1e-9, JSON.stringify(atr));

// ---- 3. Backtest: 5 результатів + short ----
const cfg = Object.assign(st.defaultStrategyConfig(), {
  direction: 'long', minRangePct: 0, maxRangePct: 100, minBodyPct: 0, closeThresholdPct: 50,
  entryPct: 50, stopPct: 25, tpPct: 50, maxWaitBars: 3, maxTradeBars: 5,
  useAtr: false, minVolume: 0, c1Dir: 'any', c2Dir: 'any', minBodyRangeRatio: 0
});
function C(ts, o, h, l, c, v) { return { ts, open: o, high: h, low: l, close: c, volume: v || 10 }; }
const T0 = 1704067200000, H = 3600000;
const cc1 = C(T0, 100, 102, 99, 101), cc2 = C(T0 + H, 101, 110, 100, 109); // entry=105 stop=97.5 target=110
let bars = [cc1, cc2, C(T0 + 2 * H, 109, 109.5, 104, 108), C(T0 + 3 * H, 108, 112, 106, 111)];
let det = st.detectSetups(bars, cfg, '1h');
ok('setup detected at idx1', det.length >= 1 && det[0].index === 1, JSON.stringify(det.map(d => d.index)));
let sim = bt.simulateSetup(bars, det[0], cfg, det[0].index);
ok('sim TP', sim.result === 'tp', sim.result);
bars = [cc1, cc2, C(T0 + 2 * H, 109, 109.5, 104, 108), C(T0 + 3 * H, 108, 109, 96, 97)];
sim = bt.simulateSetup(bars, st.detectSetups(bars, cfg, '1h')[0], cfg, 1);
ok('sim SL', sim.result === 'sl', sim.result);
bars = [cc1, cc2, C(T0 + 2 * H, 109, 112, 106, 111), C(T0 + 3 * H, 111, 113, 107, 112), C(T0 + 4 * H, 112, 114, 108, 113), C(T0 + 5 * H, 113, 115, 109, 114)];
sim = bt.simulateSetup(bars, st.detectSetups(bars, cfg, '1h')[0], cfg, 1);
ok('sim NoEntry', sim.result === 'no_entry', sim.result);
bars = [cc1, cc2, C(T0 + 2 * H, 109, 108, 104, 106), C(T0 + 3 * H, 106, 108, 104, 107), C(T0 + 4 * H, 107, 108, 104, 106), C(T0 + 5 * H, 106, 108, 104, 107), C(T0 + 6 * H, 107, 108, 104, 106), C(T0 + 7 * H, 106, 108, 104, 107)];
sim = bt.simulateSetup(bars, st.detectSetups(bars, cfg, '1h')[0], cfg, 1);
ok('sim Timeout', sim.result === 'timeout', sim.result);
bars = [cc1, cc2, C(T0 + 2 * H, 109, 111, 96, 100)];
sim = bt.simulateSetup(bars, st.detectSetups(bars, cfg, '1h')[0], cfg, 1);
ok('sim Ambiguous', sim.result === 'ambiguous', sim.result);
const cfgS = Object.assign({}, cfg, { direction: 'short' });
bars = [C(T0, 101, 102, 99, 100), C(T0 + H, 100, 101, 91, 92), C(T0 + 2 * H, 92, 97, 90, 91)];
det = st.detectSetups(bars, cfgS, '1h');
ok('short detected', det.some(d => d.index === 1 && d.direction === 'short'));
sim = bt.simulateSetup(bars, det.find(d => d.index === 1), cfgS, 1);
ok('short TP', sim.result === 'tp', sim.result);

// ---- 4. Statistics + Ambiguous modes + PF zero-loss ----
const fake = [
  { ts: T0, result: 'tp', r: 2, direction: 'long', timeframe: '1h', barsToEntry: 1, barsInTrade: 2 },
  { ts: T0 + 1, result: 'sl', r: -1, direction: 'long', timeframe: '1h', barsToEntry: 1, barsInTrade: 2 },
  { ts: T0 + 2, result: 'ambiguous', r: 0, direction: 'long', timeframe: '1h', entry: 105, stop: 97.5, target: 110, barsToEntry: 1, barsInTrade: 1 },
  { ts: T0 + 3, result: 'no_entry', r: 0, direction: 'long', timeframe: '1h', barsToEntry: null, barsInTrade: 0 },
  { ts: T0 + 4, result: 'timeout', r: 0.5, direction: 'long', timeframe: '1h', barsToEntry: 1, barsInTrade: 3 }
];
const sx = ss.summarizeResults(fake, 'exclude');
ok('stats exclude entered=3', sx.entered === 3, String(sx.entered));
ok('stats exclude ambiguous=1', sx.ambiguous === 1);
const sl2 = ss.summarizeResults(fake, 'loss');
ok('stats loss mode entered=4 losses=2', sl2.entered === 4 && sl2.losses === 2);
const sw = ss.summarizeResults(fake, 'win');
ok('stats win mode wins=2', sw.wins === 2);
const allWin = ss.summarizeResults([
  { ts: T0, result: 'tp', r: 1.5, direction: 'long', timeframe: '1h', barsToEntry: 1, barsInTrade: 1 },
  { ts: T0 + 1, result: 'tp', r: 2, direction: 'long', timeframe: '1h', barsToEntry: 1, barsInTrade: 1 }
], 'exclude');
ok('stats zero-loss internal PF is Infinity', allWin.profitFactor === Infinity, String(allWin.profitFactor));
ok('fmtPF(Infinity) is symbol', utils.fmtPF(Infinity) === '∞', utils.fmtPF(Infinity));
ok('fmtPF(12.02) numeric', utils.fmtPF(12.0194) === '12.02', utils.fmtPF(12.0194));
ok('fmtPF(null) is dash', utils.fmtPF(null) === '—');
ok('fmtNum(Infinity) hardened', utils.fmtNum(Infinity) === '∞');
// display-хелпери: internal keys незмінні, UI український
ok('resultLabel tp', utils.resultLabel('tp') === 'Виграш');
ok('resultLabel sl', utils.resultLabel('sl') === 'Збиток');
ok('resultLabel no_entry', utils.resultLabel('no_entry') === 'Без входу');
ok('resultLabel timeout', utils.resultLabel('timeout') === 'Тайм-аут');
ok('resultLabel ambiguous', utils.resultLabel('ambiguous') === 'Невизначено');
ok('directionLabel long/short', utils.directionLabel('long') === 'Лонг' && utils.directionLabel('short') === 'Шорт');
ok('journalResultLabel win/loss/be', utils.journalResultLabel('win') === 'Виграш' && utils.journalResultLabel('loss') === 'Збиток' && utils.journalResultLabel('be') === 'Беззбиток');
ok('labels fallback raw', utils.resultLabel('weird') === 'weird' && utils.directionLabel('x') === 'x');
const js2 = ss.summarizeJournal([{ date: T0, result: 'win', pnlUsdt: 100, pnlR: 2 }, { date: T0 + 1, result: 'loss', pnlUsdt: -50, pnlR: -1 }]);
ok('journal PF=2', Math.abs(js2.profitFactor - 2) < 1e-9);

// ---- 5. Backup merge remap (P1 regression) ----
// Сценарій ТЗ: у DB вже є dataset id=1; backup містить dataset old id=7 (+candles, +simulation).
// Після merge: новий id=2, усі залежні записи вказують на 2, orphans пораховані, а не мовчазні.
const dsMap = new Map([[7, 2]]); // old -> new (як після dbAdd у restoreBackup)
const rc = bk.remapDatasetRefs([
  { id: 101, datasetId: 7, ts: 1, open: 1, high: 2, low: 1, close: 2, volume: 5 },
  { id: 102, datasetId: 7, ts: 2, open: 2, high: 3, low: 2, close: 3, volume: 5 },
  { id: 103, datasetId: 999, ts: 3, open: 3, high: 4, low: 3, close: 4, volume: 5 } // stray
], dsMap);
ok('merge candles remapped to new id', rc.kept.length === 2 && rc.kept.every(c => c.datasetId === 2 && c.id === undefined), JSON.stringify(rc.kept.map(c => c.datasetId)));
ok('merge stray candle counted as orphan', rc.orphans === 1, String(rc.orphans));
const rsm = bk.remapDatasetRefs([
  { id: 201, datasetId: 7, resultsCount: 2 },
  { id: 202, datasetId: 999, resultsCount: 1 }
], dsMap);
ok('merge simulation remapped', rsm.kept.length === 1 && rsm.kept[0].datasetId === 2 && rsm.kept[0].id === undefined);
ok('merge stray simulation orphan', rsm.orphans === 1);
const rEmpty = bk.remapDatasetRefs([], dsMap);
ok('merge empty input', rEmpty.kept.length === 0 && rEmpty.orphans === 0);
const rNoDs = bk.remapDatasetRefs([{ id: 1, ts: 5 }], dsMap);
ok('merge record without datasetId is orphan', rNoDs.kept.length === 0 && rNoDs.orphans === 1);
ok('backup validate rejects garbage', bk.validateBackup({ app: 'other' }) !== null);
ok('backup validate accepts shape', bk.validateBackup({ app: 'offline-trade-lab', datasets: [], journal: [] }) === null);
ok('journal csv roundtrip header', jr.journalToCsv([{ date: 1 }]).split('\n')[0].indexOf('Date') === 0);

// ---- 6. Sample regression baseline (движок не чіпали) ----
const allRes = bt.runBacktest(conv.valid, st.defaultStrategyConfig(), '1h');
const sAll = ss.summarizeResults(allRes, 'exclude');
ok('baseline setups=152', allRes.length === 152, String(allRes.length));
ok('baseline entered=122', sAll.entered === 122, String(sAll.entered));
ok('baseline wins=115 losses=6', sAll.wins === 115 && sAll.losses === 6, sAll.wins + '/' + sAll.losses);
ok('baseline winRate≈94.26', approx(sAll.winRate, 94.2623, 0.05), String(sAll.winRate));
ok('baseline PF≈12.02', approx(sAll.profitFactor, 12.0195, 0.02), String(sAll.profitFactor));
ok('baseline expectancy≈0.576', approx(sAll.expectancy, 0.5761, 0.005), String(sAll.expectancy));
ok('baseline maxDD=2.00', approx(sAll.maxDrawdown, 2, 1e-9), String(sAll.maxDrawdown));

console.log('----');
console.log('PASS:' + pass + ' FAIL:' + fail);
process.exit(fail ? 1 : 0);
