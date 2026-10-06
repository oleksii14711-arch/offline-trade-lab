/* utils.js — дрібні допоміжні функції. Без зовнішніх залежностей. */
'use strict';

function fmtNum(v, digits) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '-∞';
  const d = (digits === undefined) ? 2 : digits;
  return Number(v).toFixed(d);
}

// Display-хелпери: внутрішні ключі лишаються англійськими,
// користувач бачить українські назви.
function resultLabel(v) {
  const m = { tp: 'Виграш', sl: 'Збиток', no_entry: 'Без входу', timeout: 'Тайм-аут', ambiguous: 'Невизначено' };
  return Object.prototype.hasOwnProperty.call(m, v) ? m[v] : String(v === null || v === undefined ? '' : v);
}

function directionLabel(v) {
  const m = { long: 'Лонг', short: 'Шорт' };
  return Object.prototype.hasOwnProperty.call(m, v) ? m[v] : String(v === null || v === undefined ? '' : v);
}

function journalResultLabel(v) {
  const m = { win: 'Виграш', loss: 'Збиток', be: 'Беззбиток' };
  return Object.prototype.hasOwnProperty.call(m, v) ? m[v] : String(v === null || v === undefined ? '' : v);
}
// Presentation-шар для Profit Factor. Внутрішня математика (statistics.js)
// лишається без змін: grossWin>0 за нульових збитків = Infinity.
// Семантика: збитків нема → знаменник нуль → '∞', а не 'N/A'.
function fmtPF(v) {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '—';
  if (v === Infinity) return '∞';
  if (v === -Infinity) return '-∞';
  return fmtNum(v);
}

function fmtInt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return String(Math.round(v));
}

function fmtPct(v, digits) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return fmtNum(v, digits === undefined ? 1 : digits) + '%';
}

function fmtDate(ts) {
  if (!ts && ts !== 0) return '—';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function fmtDateShort(ts) {
  if (!ts && ts !== 0) return '—';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function parseDateInput(s) {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return t;
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);
}

function toCsv(rows, columns) {
  const q = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const head = columns.map((c) => q(c.label)).join(',');
  const lines = rows.map((r) => columns.map((c) => q(r[c.key])).join(','));
  return head + '\n' + lines.join('\n') + '\n';
}

// Простий парсер CSV-рядка імпорту журналу (з лапками)
function parseCsvLine(line, delim) {
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
  return out;
}

function uid(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
}

function debounce(fn, ms) {
  let t = null;
  return function () {
    const args = arguments;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms || 250);
  };
}

// Tooltip-хелпер: span.tip з data-tip
function tip(text) {
  return ' <span class="tip" tabindex="0" data-tip="' + esc(text) + '">?</span>';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fmtNum, fmtPF, fmtInt, fmtPct, fmtDate, fmtDateShort, esc, toCsv, parseCsvLine, uid, resultLabel, directionLabel, journalResultLabel };
}
