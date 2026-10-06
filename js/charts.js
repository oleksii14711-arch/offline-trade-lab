/* charts.js — графіки на Canvas без бібліотек. */
'use strict';

function setupCanvas(canvas, height) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
  const h = height || 220;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = '100%';
  canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (v && v.trim()) || fallback;
}

function drawEquity(canvas, equity) {
  const { ctx, w, h } = setupCanvas(canvas, 220);
  ctx.clearRect(0, 0, w, h);
  const pad = 28;
  ctx.fillStyle = cssVar('--muted', '#8b93a7');
  ctx.font = '11px system-ui';
  if (!equity || !equity.length) {
    ctx.fillText('Немає даних', pad, h / 2);
    return;
  }
  let min = Math.min(0, ...equity), max = Math.max(0, ...equity);
  if (max === min) max = min + 1;
  const X = (i) => pad + (i / Math.max(1, equity.length - 1)) * (w - pad * 2);
  const Y = (v) => h - pad - ((v - min) / (max - min)) * (h - pad * 2);
  // сітка
  ctx.strokeStyle = cssVar('--border', '#263043');
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pad + (g / 4) * (h - pad * 2);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
  }
  // нульова лінія
  if (min < 0 && max > 0) {
    ctx.strokeStyle = '#555';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(w - pad, Y(0)); ctx.stroke();
    ctx.setLineDash([]);
  }
  const up = cssVar('--up', '#26a69a');
  ctx.strokeStyle = up;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(0), Y(equity[0]));
  for (let i = 1; i < equity.length; i++) ctx.lineTo(X(i), Y(equity[i]));
  ctx.stroke();
  ctx.fillStyle = cssVar('--muted', '#8b93a7');
  ctx.fillText(fmtNum(max) + ' R', 2, pad);
  ctx.fillText(fmtNum(min) + ' R', 2, h - pad + 12);
  ctx.fillText('угод: ' + equity.length, w - 90, 14);
}

function drawDonut(canvas, wins, losses) {
  const { ctx, w, h } = setupCanvas(canvas, 220);
  ctx.clearRect(0, 0, w, h);
  const total = (wins || 0) + (losses || 0);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 20, r = R * 0.55;
  if (!total) {
    ctx.fillStyle = cssVar('--muted', '#8b93a7');
    ctx.font = '12px system-ui';
    ctx.fillText('Немає даних', cx - 40, cy);
    return;
  }
  const up = cssVar('--up', '#26a69a'), down = cssVar('--down', '#ef5350');
  let a0 = -Math.PI / 2;
  const segs = [[wins, up], [losses, down]];
  for (const [v, col] of segs) {
    const a1 = a0 + (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.arc(cx, cy, r, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    a0 = a1;
  }
  ctx.fillStyle = cssVar('--text', '#e6e9f0');
  ctx.font = 'bold 14px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(wins + ' / ' + losses, cx, cy + 5);
  ctx.font = '11px system-ui';
  ctx.fillStyle = cssVar('--muted', '#8b93a7');
  ctx.fillText('wins / losses', cx, cy + 20);
  ctx.textAlign = 'left';
}

function drawBars(canvas, labels, values, opts) {
  const o = opts || {};
  const { ctx, w, h } = setupCanvas(canvas, o.height || 220);
  ctx.clearRect(0, 0, w, h);
  const pad = 30;
  ctx.font = '10px system-ui';
  if (!labels.length) {
    ctx.fillStyle = cssVar('--muted', '#8b93a7');
    ctx.fillText('Немає даних', pad, h / 2);
    return;
  }
  // показати максимум 24 підписи
  let L = labels, V = values;
  if (L.length > 24) { L = L.slice(-24); V = V.slice(-24); }
  let min = Math.min(0, ...V), max = Math.max(0, ...V);
  if (max === min) max = min + 1;
  const bw = (w - pad * 2) / L.length;
  const Y = (v) => h - pad - ((v - min) / (max - min)) * (h - pad * 2 - 10);
  const up = cssVar('--up', '#26a69a'), down = cssVar('--down', '#ef5350');
  ctx.strokeStyle = cssVar('--border', '#263043');
  ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(w - pad, Y(0)); ctx.stroke();
  for (let i = 0; i < L.length; i++) {
    const v = V[i];
    const x = pad + i * bw + bw * 0.15;
    const y0 = Y(0), y1 = Y(v);
    ctx.fillStyle = v >= 0 ? up : down;
    const top = Math.min(y0, y1);
    ctx.fillRect(x, top, bw * 0.7, Math.max(2, Math.abs(y1 - y0)));
    if (L.length <= 12) {
      ctx.fillStyle = cssVar('--muted', '#8b93a7');
      ctx.save();
      ctx.translate(pad + i * bw + bw / 2, h - 8);
      ctx.rotate(-0.35);
      ctx.fillText(String(L[i]).slice(0, 10), -20, 0);
      ctx.restore();
    }
  }
  ctx.fillStyle = cssVar('--muted', '#8b93a7');
  ctx.fillText(fmtNum(max) + ' R', 2, pad);
}

function drawTfBars(canvas, statsByTf) {
  const labels = Object.keys(statsByTf);
  const values = labels.map((k) => statsByTf[k].totalR || 0);
  drawBars(canvas, labels, values, { height: 220 });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {};
}
