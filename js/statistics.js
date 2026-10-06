/* statistics.js — розрахунок метрик backtest і журналу. */
'use strict';

function summarizeResults(results, ambiguousMode) {
  const mode = ambiguousMode || 'exclude'; // exclude | win | loss
  const r = results || [];
  let total = r.length;
  let noEntry = 0, timeout = 0, ambiguous = 0, tp = 0, sl = 0;
  let wins = 0, losses = 0;
  let entered = 0;
  const effR = []; // ефективні R для equity/PF/expectancy
  const perTrade = [];

  for (const t of r) {
    if (t.result === 'no_entry') { noEntry++; continue; }
    if (t.result === 'timeout') {
      timeout++; entered++;
      effR.push(Number(t.r) || 0);
      perTrade.push(t);
      continue;
    }
    if (t.result === 'ambiguous') {
      ambiguous++;
      if (mode === 'exclude') { continue; }
      entered++;
      if (mode === 'win') {
        wins++;
        // R тейка
        const risk = t.direction === 'long' ? (t.entry - t.stop) : (t.stop - t.entry);
        const rew = t.direction === 'long' ? (t.target - t.entry) : (t.entry - t.target);
        const rv = risk > 0 ? rew / risk : 0;
        effR.push(rv);
        perTrade.push(Object.assign({}, t, { r: rv, effResult: 'win' }));
      } else {
        losses++;
        effR.push(-1);
        perTrade.push(Object.assign({}, t, { r: -1, effResult: 'loss' }));
      }
      continue;
    }
    if (t.result === 'tp') { tp++; wins++; entered++; effR.push(Number(t.r) || 0); perTrade.push(t); continue; }
    if (t.result === 'sl') { sl++; losses++; entered++; effR.push(-1); perTrade.push(t); continue; }
    // невідоме — ігноруємо
  }

  const winRate = entered > 0 ? (wins / entered) * 100 : 0;
  const lossRate = entered > 0 ? (losses / entered) * 100 : 0;
  const avgR = effR.length ? effR.reduce((a, b) => a + b, 0) / effR.length : 0;
  let medR = 0;
  if (effR.length) {
    const s = effR.slice().sort((a, b) => a - b);
    medR = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  }
  let grossWin = 0, grossLoss = 0;
  for (const v of effR) { if (v > 0) grossWin += v; else grossLoss += Math.abs(v); }
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  const expectancy = avgR;

  // consecutive
  let maxW = 0, maxL = 0, cw = 0, cl = 0;
  // порядок — за ts
  const ordered = perTrade.slice().sort((a, b) => a.ts - b.ts);
  for (const t of ordered) {
    const isWin = (t.effResult === 'win') || (t.result === 'tp') || (t.result === 'timeout' && Number(t.r) > 0);
    const isLoss = !isWin && (t.result === 'sl' || t.effResult === 'loss' || (t.result === 'timeout' && Number(t.r) <= 0) || (mode !== 'exclude' && t.result === 'ambiguous'));
    // timeout з R<=0 вважаємо збитком для streak; з R>0 — виграшем
    if (t.result === 'timeout') {
      if (Number(t.r) > 0) { cw++; cl = 0; maxW = Math.max(maxW, cw); }
      else { cl++; cw = 0; maxL = Math.max(maxL, cl); }
    } else if (isWin && t.result !== 'timeout') { cw++; cl = 0; maxW = Math.max(maxW, cw); }
    else { cl++; cw = 0; maxL = Math.max(maxL, cl); }
  }

  // drawdown + equity
  let cum = 0;
  const equity = [];
  let peak = 0, maxDD = 0;
  for (const t of ordered) {
    let v = 0;
    if (t.result === 'tp') v = Number(t.r) || 0;
    else if (t.result === 'sl') v = -1;
    else if (t.result === 'timeout') v = Number(t.r) || 0;
    else if (t.result === 'ambiguous') {
      if (mode === 'win') v = Number(t.r) || 0;
      else if (mode === 'loss') v = -1;
      else v = 0;
    }
    cum += v;
    equity.push(cum);
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
  }

  let avgEntry = 0, avgTrade = 0, nEntry = 0, nTrade = 0;
  for (const t of r) {
    if (t.barsToEntry !== null && t.barsToEntry !== undefined && t.result !== 'no_entry') { avgEntry += t.barsToEntry; nEntry++; }
    if (t.barsInTrade) { avgTrade += t.barsInTrade; nTrade++; }
  }
  if (nEntry) avgEntry /= nEntry;
  if (nTrade) avgTrade /= nTrade;

  return {
    total, entered, wins, losses, noEntry, timeout, ambiguous, tp, sl,
    winRate, lossRate, avgR, medR, profitFactor, expectancy,
    maxWinStreak: maxW, maxLossStreak: maxL, maxDrawdown: maxDD,
    totalR: cum, equity,
    avgBarsToEntry: avgEntry, avgBarsInTrade: avgTrade
  };
}

function groupBy(results, keyFn) {
  const m = new Map();
  for (const t of results) {
    const k = keyFn(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return m;
}

function monthKey(ts) {
  const d = new Date(Number(ts));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function yearKey(ts) {
  return String(new Date(Number(ts)).getFullYear());
}

function summarizeJournal(trades) {
  const list = (trades || []).slice().sort((a, b) => Number(a.date) - Number(b.date));
  const n = list.length;
  let wins = 0, losses = 0, be = 0;
  let pnl = 0, rTot = 0;
  let grossW = 0, grossL = 0;
  const rVals = [];
  let cum = 0, peak = 0, maxDD = 0;
  const equity = [];
  for (const t of list) {
    const res = String(t.result || '').toLowerCase();
    if (res === 'win') wins++;
    else if (res === 'loss') losses++;
    else be++;
    const p = Number(t.pnlUsdt) || 0;
    const rv = Number(t.pnlR) || 0;
    pnl += p; rTot += rv; rVals.push(rv);
    if (p > 0) grossW += p; else if (p < 0) grossL += Math.abs(p);
    cum += rv;
    equity.push(cum);
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
  }
  const decided = wins + losses;
  const winRate = decided > 0 ? (wins / decided) * 100 : (n > 0 ? (wins / n) * 100 : 0);
  const avgWin = wins > 0 ? list.filter((t) => String(t.result).toLowerCase() === 'win').reduce((a, t) => a + (Number(t.pnlUsdt) || 0), 0) / wins : 0;
  const avgLoss = losses > 0 ? list.filter((t) => String(t.result).toLowerCase() === 'loss').reduce((a, t) => a + (Number(t.pnlUsdt) || 0), 0) / losses : 0;
  const pf = grossL > 0 ? grossW / grossL : (grossW > 0 ? Infinity : 0);
  const expectancy = rVals.length ? rVals.reduce((a, b) => a + b, 0) / rVals.length : 0;
  return { count: n, wins, losses, be, winRate, pnl, rTot, avgWin, avgLoss, profitFactor: pf, expectancy, maxDrawdown: maxDD, equity };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { summarizeResults, summarizeJournal, groupBy, monthKey, yearKey };
}
