/* backtest.js — симуляція сетапів. Працює і в main thread, і у воркері (дублюється). */
'use strict';

function simulateSetup(candles, setup, cfg, startIndex) {
  const maxWait = Math.max(1, Math.floor(Number(cfg.maxWaitBars) || 3));
  const maxTrade = Math.max(1, Math.floor(Number(cfg.maxTradeBars) || 10));
  const dir = setup.direction;
  const entry = setup.entry, stop = setup.stop, target = setup.target;
  const risk = dir === 'long' ? (entry - stop) : (stop - entry);

  let entryBar = -1;
  let entryPrice = entry;

  const endWait = Math.min(candles.length - 1, startIndex + maxWait);
  for (let j = startIndex + 1; j <= endWait; j++) {
    const c = candles[j];
    let touched = false;
    let gapOpen = false;
    if (dir === 'long') {
      if (c.low <= entry) touched = true;
      // геп униз: вхід за відкриттям (краща ціна для ліміту не гірша)
      if (c.open < entry) gapOpen = true;
    } else {
      if (c.high >= entry) touched = true;
      if (c.open > entry) gapOpen = true;
    }
    if (touched) {
      entryBar = j;
      entryPrice = gapOpen ? c.open : entry;
      break;
    }
  }

  if (entryBar === -1) {
    return { result: 'no_entry', r: 0, exitPrice: null, barsToEntry: null, barsInTrade: 0, entryBar: -1, exitBar: -1 };
  }

  const riskEff = dir === 'long' ? (entryPrice - stop) : (stop - entryPrice);
  const safeRisk = riskEff > 0 ? riskEff : risk;

  const lastBar = Math.min(candles.length - 1, entryBar + maxTrade - 1);
  for (let k = entryBar; k <= lastBar; k++) {
    const c = candles[k];
    let hitTP = false, hitSL = false;
    if (dir === 'long') {
      hitTP = c.high >= target;
      hitSL = c.low <= stop;
      // Якщо вхід стався цим баром гепом вгору вище entry — entryPrice=open, але TP/SL перевіряємо так само.
    } else {
      hitTP = c.low <= target;
      hitSL = c.high >= stop;
    }
    if (hitTP && hitSL) {
      return { result: 'ambiguous', r: 0, exitPrice: null, barsToEntry: entryBar - startIndex, barsInTrade: k - entryBar + 1, entryBar, exitBar: k, entryPrice };
    }
    if (hitTP) {
      const r = safeRisk > 0 ? ((dir === 'long' ? (target - entryPrice) : (entryPrice - target)) / safeRisk) : 0;
      return { result: 'tp', r, exitPrice: target, barsToEntry: entryBar - startIndex, barsInTrade: k - entryBar + 1, entryBar, exitBar: k, entryPrice };
    }
    if (hitSL) {
      return { result: 'sl', r: -1, exitPrice: stop, barsToEntry: entryBar - startIndex, barsInTrade: k - entryBar + 1, entryBar, exitBar: k, entryPrice };
    }
  }
  // Timeout — вихід за закриттям останнього бара вікна
  const exitPrice = candles[lastBar].close;
  let r = 0;
  if (safeRisk > 0) {
    r = dir === 'long' ? ((exitPrice - entryPrice) / safeRisk) : ((entryPrice - exitPrice) / safeRisk);
  }
  return { result: 'timeout', r, exitPrice, barsToEntry: entryBar - startIndex, barsInTrade: lastBar - entryBar + 1, entryBar, exitBar: lastBar, entryPrice };
}

function runBacktest(candles, cfg, timeframe, onProgress) {
  // detect + simulate, чанками щоб не блокувати (у main thread)
  const setups = detectSetupsRef(candles, cfg, timeframe);
  const results = [];
  for (let s = 0; s < setups.length; s++) {
    const st = setups[s];
    const sim = simulateSetup(candles, st, cfg, st.index);
    results.push(Object.assign({}, st, sim, {
      date: st.ts,
      entryLevel: cfg.entryPct,
      threshold: cfg.closeThresholdPct
    }));
    if (onProgress && (s % 2000 === 0)) onProgress(s / setups.length);
  }
  if (onProgress) onProgress(1);
  return results;
}

// Посилання на detectSetups: у браузері береться з глобального scope (strategy.js),
// у воркері — з дубльованої реалізації. Щоб файл був автономним, нижче — fallback.
function detectSetupsRef(candles, cfg, timeframe) {
  if (typeof detectSetups === 'function') {
    try { return detectSetups(candles, cfg, timeframe); } catch (e) { /* fallback нижче */ }
  }
  return detectSetupsFallback(candles, cfg, timeframe);
}

function detectSetupsFallback(candles, cfg, timeframe) {
  const atr = cfg.useAtr ? computeAtrFallback(candles, cfg.atrPeriod) : null;
  const out = [];
  const dirs = cfg.direction === 'both' ? ['long', 'short'] : [cfg.direction];
  const rp = (c) => (c.close ? ((c.high - c.low) / Math.abs(c.close)) * 100 : 0);
  const bp = (c) => { const r = c.high - c.low; return r <= 0 ? 0 : (Math.abs(c.close - c.open) / r) * 100; };
  const cp = (c) => { const r = c.high - c.low; return r <= 0 ? 50 : ((c.close - c.low) / r) * 100; };
  const cdir = (c) => (c.close > c.open ? 'bull' : (c.close < c.open ? 'bear' : 'doji'));
  const levels = (c2, dir) => {
    const range = c2.high - c2.low;
    const e = Number(cfg.entryPct) / 100, s = Number(cfg.stopPct) / 100, t = Number(cfg.tpPct) / 100;
    if (dir === 'long') return { entry: c2.low + range * e, stop: c2.low - range * s, target: c2.low + range * e + range * t, range };
    return { entry: c2.high - range * e, stop: c2.high + range * s, target: c2.high - range * e - range * t, range };
  };
  for (let i = 1; i < candles.length; i++) {
    const c1 = candles[i - 1], c2 = candles[i];
    for (const dir of dirs) {
      const rPct = rp(c2);
      if (rPct < Number(cfg.minRangePct) || rPct > Number(cfg.maxRangePct)) continue;
      const body = bp(c2);
      if (body < Number(cfg.minBodyPct)) continue;
      if (Number(cfg.minBodyRangeRatio) > 0 && body < Number(cfg.minBodyRangeRatio)) continue;
      const pos = cp(c2);
      const thr = Number(cfg.closeThresholdPct);
      if (dir === 'long' && !(pos >= thr)) continue;
      if (dir === 'short' && !(pos <= (100 - thr))) continue;
      if (Number(cfg.minVolume) > 0 && (c2.volume || 0) < Number(cfg.minVolume)) continue;
      const d1 = cdir(c1), d2 = cdir(c2);
      if (cfg.c1Dir === 'bull' && d1 !== 'bull') continue;
      if (cfg.c1Dir === 'bear' && d1 !== 'bear') continue;
      if (cfg.c2Dir === 'bull' && d2 !== 'bull') continue;
      if (cfg.c2Dir === 'bear' && d2 !== 'bear') continue;
      if (cfg.useAtr && atr && !Number.isNaN(atr[i]) && atr[i] > 0) {
        if ((c2.high - c2.low) < atr[i] * Number(cfg.atrMinMult)) continue;
      }
      const lv = levels(c2, dir);
      out.push({ index: i, ts: c2.ts, timeframe: timeframe || '', direction: dir, c1: { o: c1.open, h: c1.high, l: c1.low, c: c1.close }, c2: { o: c2.open, h: c2.high, l: c2.low, c: c2.close }, rangePct: rPct, range: lv.range, entry: lv.entry, stop: lv.stop, target: lv.target, atr: atr ? atr[i] : null, volume: c2.volume || 0, closePos: pos, bodyPct: body });
    }
  }
  return out;
}

function computeAtrFallback(candles, period) {
  const p = Math.max(1, Math.floor(period || 14));
  const atr = new Array(candles.length).fill(NaN);
  if (!candles.length) return atr;
  const tr = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = i > 0 ? candles[i - 1].close : candles[i].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  if (candles.length < p) return atr;
  let sum = 0;
  for (let i = 0; i < p; i++) sum += tr[i];
  atr[p - 1] = sum / p;
  for (let i = p; i < candles.length; i++) atr[i] = (atr[i - 1] * (p - 1) + tr[i]) / p;
  return atr;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { simulateSetup, runBacktest };
}
