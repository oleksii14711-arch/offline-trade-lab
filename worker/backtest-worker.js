/* backtest-worker.js — Web Worker для backtest. Автономний (не імпортує інші файли),
   щоб працювати з file:// і GitHub Pages без модульних імпортів. */
'use strict';

// --- дубльована мінімальна реалізація (синхронізована з js/strategy.js + js/backtest.js) ---
function computeAtr(candles, period) {
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

function detect(candles, cfg, timeframe) {
  const atr = cfg.useAtr ? computeAtr(candles, cfg.atrPeriod) : null;
  const out = [];
  const dirs = cfg.direction === 'both' ? ['long', 'short'] : [cfg.direction];
  const rp = (c) => (c.close ? ((c.high - c.low) / Math.abs(c.close)) * 100 : 0);
  const bp = (c) => { const r = c.high - c.low; return r <= 0 ? 0 : (Math.abs(c.close - c.open) / r) * 100; };
  const cp = (c) => { const r = c.high - c.low; return r <= 0 ? 50 : ((c.close - c.low) / r) * 100; };
  const cd = (c) => (c.close > c.open ? 'bull' : (c.close < c.open ? 'bear' : 'doji'));
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
      const d1 = cd(c1), d2 = cd(c2);
      if (cfg.c1Dir === 'bull' && d1 !== 'bull') continue;
      if (cfg.c1Dir === 'bear' && d1 !== 'bear') continue;
      if (cfg.c2Dir === 'bull' && d2 !== 'bull') continue;
      if (cfg.c2Dir === 'bear' && d2 !== 'bear') continue;
      if (cfg.useAtr && atr && !Number.isNaN(atr[i]) && atr[i] > 0) {
        if ((c2.high - c2.low) < atr[i] * Number(cfg.atrMinMult)) continue;
      }
      const range = c2.high - c2.low;
      const e = Number(cfg.entryPct) / 100, s = Number(cfg.stopPct) / 100, t = Number(cfg.tpPct) / 100;
      let entry, stop, target;
      if (dir === 'long') { entry = c2.low + range * e; stop = c2.low - range * s; target = entry + range * t; }
      else { entry = c2.high - range * e; stop = c2.high + range * s; target = entry - range * t; }
      out.push({ index: i, ts: c2.ts, timeframe: timeframe || '', direction: dir, rangePct: rPct, range, entry, stop, target, atr: atr ? atr[i] : null, volume: c2.volume || 0, closePos: pos, bodyPct: body, c1: { o: c1.open, h: c1.high, l: c1.low, c: c1.close }, c2: { o: c2.open, h: c2.high, l: c2.low, c: c2.close } });
    }
  }
  return out;
}

function simulate(candles, setup, cfg) {
  const maxWait = Math.max(1, Math.floor(Number(cfg.maxWaitBars) || 3));
  const maxTrade = Math.max(1, Math.floor(Number(cfg.maxTradeBars) || 10));
  const dir = setup.direction;
  const entry = setup.entry, stop = setup.stop, target = setup.target;
  const startIndex = setup.index;
  let entryBar = -1, entryPrice = entry;
  const endWait = Math.min(candles.length - 1, startIndex + maxWait);
  for (let j = startIndex + 1; j <= endWait; j++) {
    const c = candles[j];
    let touched = false, gap = false;
    if (dir === 'long') { if (c.low <= entry) touched = true; if (c.open < entry) gap = true; }
    else { if (c.high >= entry) touched = true; if (c.open > entry) gap = true; }
    if (touched) { entryBar = j; entryPrice = gap ? c.open : entry; break; }
  }
  if (entryBar === -1) return { result: 'no_entry', r: 0, exitPrice: null, barsToEntry: null, barsInTrade: 0, entryBar: -1, exitBar: -1, entryPrice };
  const risk = dir === 'long' ? (entry - stop) : (stop - entry);
  const riskEff = dir === 'long' ? (entryPrice - stop) : (stop - entryPrice);
  const safeRisk = riskEff > 0 ? riskEff : risk;
  const lastBar = Math.min(candles.length - 1, entryBar + maxTrade - 1);
  for (let k = entryBar; k <= lastBar; k++) {
    const c = candles[k];
    let hitTP = false, hitSL = false;
    if (dir === 'long') { hitTP = c.high >= target; hitSL = c.low <= stop; }
    else { hitTP = c.low <= target; hitSL = c.high >= stop; }
    if (hitTP && hitSL) return { result: 'ambiguous', r: 0, exitPrice: null, barsToEntry: entryBar - startIndex, barsInTrade: k - entryBar + 1, entryBar, exitBar: k, entryPrice };
    if (hitTP) {
      const r = safeRisk > 0 ? ((dir === 'long' ? (target - entryPrice) : (entryPrice - target)) / safeRisk) : 0;
      return { result: 'tp', r, exitPrice: target, barsToEntry: entryBar - startIndex, barsInTrade: k - entryBar + 1, entryBar, exitBar: k, entryPrice };
    }
    if (hitSL) return { result: 'sl', r: -1, exitPrice: stop, barsToEntry: entryBar - startIndex, barsInTrade: k - entryBar + 1, entryBar, exitBar: k, entryPrice };
  }
  const exitPrice = candles[lastBar].close;
  let r = 0;
  if (safeRisk > 0) r = dir === 'long' ? ((exitPrice - entryPrice) / safeRisk) : ((entryPrice - exitPrice) / safeRisk);
  return { result: 'timeout', r, exitPrice, barsToEntry: entryBar - startIndex, barsInTrade: lastBar - entryBar + 1, entryBar, exitBar: lastBar, entryPrice };
}

self.onmessage = function (e) {
  try {
    const { candles, config, timeframe } = e.data || {};
    if (!candles || !candles.length) { self.postMessage({ ok: false, error: 'Немає свічок' }); return; }
    const setups = detect(candles, config, timeframe);
    const results = [];
    for (let s = 0; s < setups.length; s++) {
      const sim = simulate(candles, setups[s], config);
      results.push(Object.assign({}, setups[s], sim, { date: setups[s].ts, entryLevel: config.entryPct, threshold: config.closeThresholdPct }));
      if (s % 5000 === 0) self.postMessage({ ok: true, progress: s / Math.max(1, setups.length), partial: false });
    }
    self.postMessage({ ok: true, progress: 1, results });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
