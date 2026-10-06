/* csv.js — імпорт CSV: delimiter, заголовки, mapping, валідація, timeframe. */
'use strict';

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 5);
  if (!lines.length) return ',';
  const cands = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of cands) {
    let counts = lines.map((l) => l.split(d).length);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + Math.abs(b - avg), 0);
    const score = avg * 10 - variance;
    if (avg > 1 && score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitLine(line, delim) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsvText(text, delim) {
  const d = delim || detectDelimiter(text);
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.filter((l) => l.trim() !== '');
  if (!lines.length) return { delimiter: d, headers: [], rows: [] };
  const headers = splitLine(lines[0], d);
  const rows = [];
  for (let i = 1; i < lines.length; i++) rows.push(splitLine(lines[i], d));
  return { delimiter: d, headers, rows };
}

const TIME_ALIASES = ['timestamp', 'time', 'date', 'open time', 'opentime', 'open_time', 'close time', 'closetime', 'close_time', 'datetime'];
const OPEN_ALIASES = ['open', 'o'];
const HIGH_ALIASES = ['high', 'h'];
const LOW_ALIASES = ['low', 'l'];
const CLOSE_ALIASES = ['close', 'c'];
const VOL_ALIASES = ['volume', 'vol', 'v', 'quote volume', 'base volume'];

function normHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function autoMapColumns(headers) {
  const norms = headers.map(normHeader);
  const map = { ts: -1, open: -1, high: -1, low: -1, close: -1, volume: -1 };
  const find = (aliases) => {
    for (let i = 0; i < norms.length; i++) {
      if (aliases.indexOf(norms[i]) !== -1) return i;
    }
    return -1;
  };
  map.ts = find(TIME_ALIASES);
  map.open = find(OPEN_ALIASES);
  map.high = find(HIGH_ALIASES);
  map.low = find(LOW_ALIASES);
  map.close = find(CLOSE_ALIASES);
  map.volume = find(VOL_ALIASES);
  // Якщо заголовків немає (перший рядок — числа): евристика за порядком ts,o,h,l,c,v
  if (map.ts === -1 && map.open === -1 && headers.length >= 5) {
    const firstRowNumeric = headers.every((h) => h === '' || !Number.isNaN(Number(String(h).replace(',', '.'))));
    if (firstRowNumeric) {
      map.ts = 0; map.open = 1; map.high = 2; map.low = 3; map.close = 4;
      if (headers.length >= 6) map.volume = 5;
    }
  }
  return map;
}

function parseTs(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim();
  if (s === '') return NaN;
  // число: unix seconds або ms
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isNaN(n)) return NaN;
    if (n > 1e14) return Math.floor(n / 1000); // мікросекунди -> ms
    if (n > 1e12) return Math.floor(n);        // ms
    if (n > 1e10) return Math.floor(n);        // ms (10 цифр уже ms)
    if (n > 1e9) return Math.floor(n * 1000);  // seconds 10 цифр? уточнення нижче
    // типово: seconds ~1.7e9, ms ~1.7e12
    if (n >= 1e12) return Math.floor(n);
    if (n >= 1e10) return Math.floor(n); // вже ms
    return Math.floor(n * 1000);
  }
  // ISO / date string
  // Якщо число з комою як "1710000000,5" — не підтримуємо, вважаємо датою
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  // Спроба dd.mm.yyyy hh:mm
  const m = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    let dd = Number(m[1]), mm = Number(m[2]), yy = Number(m[3]);
    if (yy < 100) yy += 2000;
    const hh = Number(m[4] || 0), mi = Number(m[5] || 0), ss = Number(m[6] || 0);
    const d = new Date(yy, mm - 1, dd, hh, mi, ss);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  return NaN;
}

function parseNum(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim().replace(/\s+/g, '');
  if (s === '' || s === '-' || s.toLowerCase() === 'null' || s.toLowerCase() === 'nan') return NaN;
  s = s.replace(',', '.');
  const n = Number(s);
  return n;
}

// Валідація одного рядка -> {candle} або {error}
function validateRow(c) {
  if (!c) return { error: 'empty' };
  const { ts, open, high, low, close } = c;
  if ([ts, open, high, low, close].some((v) => typeof v !== 'number' || Number.isNaN(v))) return { error: 'nan' };
  if (!(high >= low)) return { error: 'high<low' };
  const eps = 1e-12;
  if (open < low - eps || open > high + eps) return { error: 'oob' };
  if (close < low - eps || close > high + eps) return { error: 'oob' };
  if (!(ts > 0)) return { error: 'bad-ts' };
  return { candle: c };
}

function rowsToCandles(rows, map, opts) {
  const valid = [];
  const skipped = [];
  const seen = new Set();
  const errors = { nan: 0, empty: 0, dup: 0, ohlc: 0 };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineNo = i + 2;
    const get = (idx) => (idx === -1 || idx === undefined || idx >= r.length) ? '' : r[idx];
    if (!r || !r.length || r.every((x) => String(x).trim() === '')) { skipped.push({ line: lineNo, reason: 'порожній рядок' }); errors.empty++; continue; }
    const ts = parseTs(get(map.ts));
    const open = parseNum(get(map.open));
    const high = parseNum(get(map.high));
    const low = parseNum(get(map.low));
    const close = parseNum(get(map.close));
    let volume = 0;
    if (map.volume !== -1 && map.volume !== undefined) {
      volume = parseNum(get(map.volume));
      if (Number.isNaN(volume)) volume = 0;
    }
    if ([ts, open, high, low, close].some((v) => Number.isNaN(v))) {
      skipped.push({ line: lineNo, reason: 'NaN / нечислові OHLC або дата' });
      errors.nan++;
      continue;
    }
    if (seen.has(ts)) { skipped.push({ line: lineNo, reason: 'дублікат timestamp' }); errors.dup++; continue; }
    const chk = validateRow({ ts, open, high, low, close, volume });
    if (chk.error) {
      let reason = 'неправильні OHLC';
      if (chk.error === 'high<low') reason = 'High < Low';
      if (chk.error === 'oob') reason = 'Open/Close за межами High/Low';
      skipped.push({ line: lineNo, reason });
      errors.ohlc++;
      continue;
    }
    seen.add(ts);
    valid.push({ ts, open, high, low, close, volume });
  }
  valid.sort((a, b) => a.ts - b.ts);
  return { valid, skipped, errors };
}

function detectTimeframe(candles) {
  if (!candles || candles.length < 3) return { label: 'невідомо', minutes: 0 };
  const diffs = [];
  for (let i = 1; i < Math.min(candles.length, 200); i++) diffs.push(candles[i].ts - candles[i - 1].ts);
  diffs.sort((a, b) => a - b);
  const med = diffs[Math.floor(diffs.length / 2)];
  const min = Math.round(med / 60000);
  const table = { 1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', 1440: '1D' };
  let best = 'custom (' + min + 'm)';
  let bestDiff = Infinity;
  for (const k of Object.keys(table)) {
    const d = Math.abs(Number(k) - min);
    if (d < bestDiff) { bestDiff = d; best = table[k]; }
  }
  if (bestDiff > 2 && !(min in table)) best = 'custom (' + min + 'm)';
  return { label: best, minutes: min, medianMs: med };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { detectDelimiter, parseCsvText, autoMapColumns, parseTs, parseNum, rowsToCandles, detectTimeframe, splitLine };
}
