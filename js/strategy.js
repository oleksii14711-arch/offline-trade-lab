/* strategy.js — двосвічкова модель: ATR + детекція сетапів. Без бібліотек. */
'use strict';

function defaultStrategyConfig() {
  return {
    direction: 'both',       // long | short | both
    minRangePct: 0.1,
    maxRangePct: 10,
    minBodyPct: 10,          // мін. тіло candle2 як % її range
    closeThresholdPct: 70,   // позиція Close у range, %
    entryPct: 50,            // рівень входу, % від range
    stopPct: 25,             // дистанція стопа за екстремумом, % range
    tpPct: 50,               // дистанція тейка від входу, % range
    maxWaitBars: 3,
    maxTradeBars: 10,
    useAtr: false,
    atrPeriod: 14,
    atrMinMult: 0.5,         // range2 >= ATR * mult
    minVolume: 0,
    c1Dir: 'any',            // any | bull | bear
    c2Dir: 'any',            // any | bull | bear
    minBodyRangeRatio: 0     // дубль body/range фільтра (0 = вимкнено), %
  };
}

function defaultPresets() {
  const base = defaultStrategyConfig();
  return [
    { name: 'Balanced', config: Object.assign({}, base, { direction: 'both', closeThresholdPct: 70, entryPct: 50, stopPct: 25, tpPct: 50, minRangePct: 0.1, maxRangePct: 10, minBodyPct: 10, maxWaitBars: 3, maxTradeBars: 10 }) },
    { name: 'Close 70', config: Object.assign({}, base, { closeThresholdPct: 70 }) },
    { name: 'Close 90', config: Object.assign({}, base, { closeThresholdPct: 90, minBodyPct: 30 }) }
  ];
}

// ATR Wilder
function computeAtr(candles, period) {
  const p = Math.max(1, Math.floor(period || 14));
  const atr = new Array(candles.length).fill(NaN);
  if (candles.length === 0) return atr;
  const tr = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = i > 0 ? candles[i - 1].close : candles[i].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  if (candles.length < p) return atr;
  let sum = 0;
  for (let i = 0; i < p; i++) sum += tr[i];
  atr[p - 1] = sum / p;
  for (let i = p; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (p - 1) + tr[i]) / p;
  }
  return atr;
}

function candleDir(c) {
  if (c.close > c.open) return 'bull';
  if (c.close < c.open) return 'bear';
  return 'doji';
}

function rangePct(c) {
  if (!c.close) return 0;
  return ((c.high - c.low) / Math.abs(c.close)) * 100;
}

function bodyPctOfRange(c) {
  const r = c.high - c.low;
  if (r <= 0) return 0;
  return (Math.abs(c.close - c.open) / r) * 100;
}

function closePosPct(c) {
  const r = c.high - c.low;
  if (r <= 0) return 50;
  return ((c.close - c.low) / r) * 100;
}

// Рівні угоди для напрямку
function buildLevels(c2, direction, cfg) {
  const range = c2.high - c2.low;
  const entryPct = Number(cfg.entryPct) / 100;
  const stopPct = Number(cfg.stopPct) / 100;
  const tpPct = Number(cfg.tpPct) / 100;
  if (direction === 'long') {
    const entry = c2.low + range * entryPct;
    const stop = c2.low - range * stopPct;
    const target = entry + range * tpPct;
    return { entry, stop, target, range };
  }
  const entry = c2.high - range * entryPct;
  const stop = c2.high + range * stopPct;
  const target = entry - range * tpPct;
  return { entry, stop, target, range };
}

function passesFilters(c1, c2, idx, atrArr, cfg, direction) {
  const rPct = rangePct(c2);
  if (rPct < Number(cfg.minRangePct) || rPct > Number(cfg.maxRangePct)) return { ok: false, reason: 'range' };
  const body = bodyPctOfRange(c2);
  if (body < Number(cfg.minBodyPct)) return { ok: false, reason: 'body' };
  if (Number(cfg.minBodyRangeRatio) > 0 && body < Number(cfg.minBodyRangeRatio)) return { ok: false, reason: 'bodyRatio' };
  const cp = closePosPct(c2);
  const thr = Number(cfg.closeThresholdPct);
  if (direction === 'long' && !(cp >= thr)) return { ok: false, reason: 'closePos' };
  if (direction === 'short' && !(cp <= (100 - thr))) return { ok: false, reason: 'closePos' };
  if (Number(cfg.minVolume) > 0 && (c2.volume || 0) < Number(cfg.minVolume)) return { ok: false, reason: 'volume' };
  const d1 = candleDir(c1), d2 = candleDir(c2);
  if (cfg.c1Dir === 'bull' && d1 !== 'bull') return { ok: false, reason: 'c1dir' };
  if (cfg.c1Dir === 'bear' && d1 !== 'bear') return { ok: false, reason: 'c1dir' };
  if (cfg.c2Dir === 'bull' && d2 !== 'bull') return { ok: false, reason: 'c2dir' };
  if (cfg.c2Dir === 'bear' && d2 !== 'bear') return { ok: false, reason: 'c2dir' };
  if (cfg.useAtr) {
    const a = atrArr ? atrArr[idx] : NaN;
    if (!Number.isNaN(a) && a > 0) {
      const range = c2.high - c2.low;
      if (range < a * Number(cfg.atrMinMult)) return { ok: false, reason: 'atr' };
    }
  }
  return { ok: true };
}

// Детекція сетапів БЕЗ симуляції (для preview/лічильників)
function detectSetups(candles, cfg, timeframe) {
  const atr = cfg.useAtr ? computeAtr(candles, cfg.atrPeriod) : null;
  const setups = [];
  const dirs = cfg.direction === 'both' ? ['long', 'short'] : [cfg.direction];
  for (let i = 1; i < candles.length; i++) {
    const c1 = candles[i - 1], c2 = candles[i];
    for (const dir of dirs) {
      const f = passesFilters(c1, c2, i, atr, cfg, dir);
      if (!f.ok) continue;
      const lv = buildLevels(c2, dir, cfg);
      setups.push({
        index: i,
        ts: c2.ts,
        timeframe: timeframe || '',
        direction: dir,
        c1: { o: c1.open, h: c1.high, l: c1.low, c: c1.close },
        c2: { o: c2.open, h: c2.high, l: c2.low, c: c2.close },
        rangePct: rangePct(c2),
        range: lv.range,
        entry: lv.entry,
        stop: lv.stop,
        target: lv.target,
        atr: atr ? atr[i] : null,
        volume: c2.volume || 0,
        closePos: closePosPct(c2),
        bodyPct: bodyPctOfRange(c2)
      });
    }
  }
  return setups;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { defaultStrategyConfig, defaultPresets, computeAtr, detectSetups, buildLevels, closePosPct, bodyPctOfRange, rangePct };
}
