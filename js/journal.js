/* journal.js — CRUD ручного журналу + CSV імпорт/експорт. */
'use strict';

const JOURNAL_COLUMNS = [
  { key: 'date', label: 'Date' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'exchange', label: 'Exchange' },
  { key: 'side', label: 'Long/Short' },
  { key: 'timeframe', label: 'Timeframe' },
  { key: 'entry', label: 'Entry' },
  { key: 'stop', label: 'Stop' },
  { key: 'tp', label: 'Take Profit' },
  { key: 'exit', label: 'Exit' },
  { key: 'size', label: 'Position size' },
  { key: 'riskUsdt', label: 'Risk USDT' },
  { key: 'pnlUsdt', label: 'PnL USDT' },
  { key: 'pnlR', label: 'PnL R' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'result', label: 'Win/Loss/BE' },
  { key: 'tags', label: 'Tags' },
  { key: 'mistake', label: 'Mistake?' },
  { key: 'followedPlan', label: 'Followed plan?' },
  { key: 'comment', label: 'Comment' }
];

function journalRowToCsv(r) {
  return JOURNAL_COLUMNS.map((c) => r[c.key]);
}

function journalToCsv(rows) {
  return toCsv(rows, JOURNAL_COLUMNS);
}

function journalFromCsv(text) {
  const delim = text.indexOf(';') !== -1 && text.indexOf(',') === -1 ? ';' : (text.indexOf('\t') !== -1 ? '\t' : ',');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const head = parseCsvLine(lines[0], delim).map((h) => h.trim().toLowerCase());
  // мапимо за label або key
  const idx = JOURNAL_COLUMNS.map((c) => {
    let i = head.indexOf(c.label.toLowerCase());
    if (i === -1) i = head.indexOf(c.key.toLowerCase());
    return i;
  });
  const out = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li], delim);
    const obj = {};
    JOURNAL_COLUMNS.forEach((c, k) => {
      const ci = idx[k];
      obj[c.key] = ci === -1 ? '' : (cells[ci] || '');
    });
    if (!obj.date) continue;
    const d = Date.parse(obj.date);
    obj.date = Number.isNaN(d) ? Date.now() : d;
    ['entry', 'stop', 'tp', 'exit', 'size', 'riskUsdt', 'pnlUsdt', 'pnlR'].forEach((f) => {
      if (obj[f] !== '' && obj[f] !== null) {
        const n = Number(String(obj[f]).replace(',', '.'));
        obj[f] = Number.isNaN(n) ? 0 : n;
      } else obj[f] = 0;
    });
    out.push(obj);
  }
  return out;
}

async function journalAdd(entry) {
  return dbAdd('journal', entry);
}
async function journalUpdate(entry) {
  return dbPut('journal', entry);
}
async function journalRemove(id) {
  return dbDelete('journal', id);
}
async function journalList() {
  const all = await dbGetAll('journal');
  all.sort((a, b) => Number(b.date) - Number(a.date));
  return all;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JOURNAL_COLUMNS, journalToCsv, journalFromCsv };
}
