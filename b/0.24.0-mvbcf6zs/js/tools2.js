// ツール(その2): 図形・グラデーション・指先・テキスト・切り抜き。
// 図形とグラデーションは、持っている間は作業用の絵(doc.workCanvas)に描いて見せ、離したときにレイヤーへ写す(ブラシと同じ見せ方)
import { state, emit, requestRender, currentBrush } from './state.js';
import { createCanvas } from './doc.js';
import { softStamp, hexRgb } from './brush.js';
import { crop, pixelEntry, paintable, paintColor } from './tools.js';
import { clipToSelection, newLayerWith } from './select.js';
import { openModal, escapeHtml } from './modal.js';
import { say } from './messages.js';

// レイヤーの絵の上に draw(ctx) で描いたものを重ねて、作業用の絵に作る(選択範囲があれば、その中だけ。アルファロックも守る)
function preview(layer, draw) {
  const doc = state.doc;
  doc.strokeClean = false; // ブラシの「前の線の所だけ消す」は、もう使えない(tools.js)
  doc.workOf = null;
  const t = doc.strokeCanvas.getContext('2d');
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalAlpha = 1;
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, doc.w, doc.h);
  t.save();
  draw(t);
  t.restore();
  clipToSelection(t);
  const w = doc.workCanvas.getContext('2d');
  w.setTransform(1, 0, 0, 1, 0, 0);
  w.globalAlpha = 1;
  w.globalCompositeOperation = 'copy';
  w.drawImage(layer.canvas, 0, 0);
  w.globalCompositeOperation = layer.lockAlpha ? 'source-atop' : 'source-over';
  w.drawImage(doc.strokeCanvas, 0, 0);
  w.globalCompositeOperation = 'source-over';
  state.stroke = { layer, canvas: doc.workCanvas };
  requestRender();
}

// 作業用の絵を、レイヤーへ写す(rect の範囲だけ。履歴に入れる)
function commit(label, layer, rect) {
  const doc = state.doc;
  const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
  const r = { x, y, w: Math.min(doc.w, Math.ceil(rect.x + rect.w)) - x, h: Math.min(doc.h, Math.ceil(rect.y + rect.h)) - y };
  state.stroke = null;
  if (r.w < 1 || r.h < 1) { requestRender(); return; }
  const before = crop(layer.canvas, r);
  layer.ctx.globalAlpha = 1;
  layer.ctx.globalCompositeOperation = 'source-over';
  layer.ctx.clearRect(r.x, r.y, r.w, r.h);
  layer.ctx.drawImage(doc.workCanvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  state.history.push(pixelEntry(label, layer, r, before, crop(layer.canvas, r)));
  if (!state.maskMode) emit('stroke'); // 色の履歴に入れる
  requestRender();
}

// 今のレイヤーの全体(選択範囲があれば、その中)を、色で塗りつぶす
export function fillWith(color) {
  const layer = paintable(), doc = state.doc, sel = state.selection;
  if (!layer) return;
  preview(layer, (ctx) => { ctx.fillStyle = state.maskMode ? paintColor() : color; ctx.fillRect(0, 0, doc.w, doc.h); });
  commit('塗りつぶし', layer, sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : { x: 0, y: 0, w: doc.w, h: doc.h });
}

// ---- 図形(四角・楕円・直線・三角。描画色で、塗りつぶすか、線だけ) ----

let H = null;

// 押した点 a から今の点 b までの図形。Shift = 正方形・正円・45° ずつの線
function shapeEnds(a, b, kind, shift) {
  let dx = b.x - a.x, dy = b.y - a.y;
  if (shift) {
    if (kind === 'line') {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
      dx = Math.cos(ang) * len;
      dy = Math.sin(ang) * len;
    } else {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = m * (Math.sign(dx) || 1);
      dy = m * (Math.sign(dy) || 1);
    }
  }
  return { x0: a.x, y0: a.y, x1: a.x + dx, y1: a.y + dy };
}

function drawShape(ctx, e, o, color) {
  const x = Math.min(e.x0, e.x1), y = Math.min(e.y0, e.y1), w = Math.abs(e.x1 - e.x0), h = Math.abs(e.y1 - e.y0);
  ctx.fillStyle = ctx.strokeStyle = color;
  ctx.lineWidth = o.width;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (o.kind === 'line') { ctx.moveTo(e.x0, e.y0); ctx.lineTo(e.x1, e.y1); ctx.stroke(); return; }
  if (o.kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (o.kind === 'triangle') { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); }
  else ctx.rect(x, y, w, h);
  if (o.fill) ctx.fill(); else ctx.stroke();
}

export const shapeTool = {
  cursor: 'crosshair',
  down(ev) {
    const layer = paintable();
    if (!layer) return false;
    H = { layer, a: { x: ev.x, y: ev.y }, e: null };
    return true;
  },
  move(ev) {
    if (!H) return;
    const o = state.shape;
    H.e = shapeEnds(H.a, ev, o.kind, ev.shift);
    preview(H.layer, (ctx) => drawShape(ctx, H.e, o, paintColor()));
  },
  up() {
    const h = H;
    H = null;
    if (!h) return;
    if (!h.e || Math.hypot(h.e.x1 - h.e.x0, h.e.y1 - h.e.y0) < 1.5) { state.stroke = null; requestRender(); return; }
    const pad = (state.shape.fill && state.shape.kind !== 'line' ? 0 : state.shape.width) + 2, e = h.e;
    commit('図形', h.layer, { x: Math.min(e.x0, e.x1) - pad, y: Math.min(e.y0, e.y1) - pad, w: Math.abs(e.x1 - e.x0) + pad * 2, h: Math.abs(e.y1 - e.y0) + pad * 2 });
  },
};

// ---- グラデーション(押した所から離した所へ。描画色 → 背景色 か、描画色 → 透明) ----

let GR = null;

function drawGradient(ctx, a, b) {
  const doc = state.doc, o = state.gradient;
  const g = o.kind === 'radial' ? ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) : ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  const c = hexRgb(paintColor());
  g.addColorStop(0, `rgba(${c.r},${c.g},${c.b},1)`);
  g.addColorStop(1, o.to === 'clear' || state.maskMode ? `rgba(${c.r},${c.g},${c.b},0)` : state.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, doc.w, doc.h);
}

export const gradientTool = {
  cursor: 'crosshair',
  down(ev) {
    const layer = paintable();
    if (!layer) return false;
    GR = { layer, a: { x: ev.x, y: ev.y }, b: null };
    return true;
  },
  move(ev) {
    if (!GR) return;
    let b = { x: ev.x, y: ev.y };
    if (ev.shift) { const e = shapeEnds(GR.a, b, 'line', true); b = { x: e.x1, y: e.y1 }; } // Shift: 45° ずつ
    GR.b = b;
    preview(GR.layer, (ctx) => drawGradient(ctx, GR.a, b));
  },
  up() {
    const g = GR;
    GR = null;
    if (!g) return;
    if (!g.b || Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) < 2) { state.stroke = null; requestRender(); return; }
    const sel = state.selection, doc = state.doc;
    commit('グラデーション', g.layer, sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : { x: 0, y: 0, w: doc.w, h: doc.h });
  },
};

// ---- 指先(なぞった向きに、絵をのばす)。大きさと硬さは、ブラシで選んでいるブラシのもの ----

let G = null;

function smear(x, y) {
  const { layer, d, carried, tmp, mask, keep } = G, r = d / 2, px = Math.round(x - r), py = Math.round(y - r);
  // 持っている色に、今いる所の絵を少し混ぜる
  const c = carried.getContext('2d');
  c.globalAlpha = 1 - keep;
  c.drawImage(layer.canvas, px, py, d, d, 0, 0, d, d);
  c.globalAlpha = 1;
  // 持っている色を、丸い形で置く
  const t = tmp.getContext('2d');
  t.globalCompositeOperation = 'copy';
  t.drawImage(carried, 0, 0);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(mask, 0, 0, d, d);
  if (state.selection) t.drawImage(state.selection.mask, px, py, d, d, 0, 0, d, d);
  layer.ctx.globalAlpha = 1;
  layer.ctx.globalCompositeOperation = layer.lockAlpha ? 'source-atop' : 'source-over';
  layer.ctx.drawImage(tmp, px, py);
  layer.ctx.globalCompositeOperation = 'source-over';
  const b = G.box;
  b.x0 = Math.min(b.x0, px); b.y0 = Math.min(b.y0, py); b.x1 = Math.max(b.x1, px + d); b.y1 = Math.max(b.y1, py + d);
}

export const smudgeTool = {
  cursor: 'none',
  down(ev) {
    const doc = state.doc, layer = paintable(), b = currentBrush();
    if (!layer || !b) return false;
    const d = Math.max(4, Math.round(b.size));
    G = {
      layer, d, x: ev.x, y: ev.y, carried: createCanvas(d, d), tmp: createCanvas(d, d), mask: softStamp('#000000', Math.min(0.85, b.hardness)),
      keep: 0.5 + 0.49 * Math.min(1, state.smudge.strength / 100), // 強いほど、持っている色が長く残る
      before: crop(layer.canvas, { x: 0, y: 0, w: doc.w, h: doc.h }), box: { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    };
    G.carried.getContext('2d').drawImage(layer.canvas, Math.round(ev.x - d / 2), Math.round(ev.y - d / 2), d, d, 0, 0, d, d);
    return true;
  },
  move(ev) {
    if (!G) return;
    const step = Math.max(1, G.d * 0.08), len = Math.hypot(ev.x - G.x, ev.y - G.y);
    if (len < step) return;
    const n = Math.floor(len / step), ux = (ev.x - G.x) / len, uy = (ev.y - G.y) / len;
    for (let i = 1; i <= n; i++) smear(G.x + ux * step * i, G.y + uy * step * i);
    G.x += ux * step * n;
    G.y += uy * step * n;
    requestRender();
  },
  up() {
    const g = G;
    G = null;
    if (!g || g.box.x1 < 0) return;
    const doc = state.doc, b = g.box;
    const x = Math.max(0, b.x0), y = Math.max(0, b.y0), r = { x, y, w: Math.min(doc.w, b.x1) - x, h: Math.min(doc.h, b.y1) - y };
    if (r.w > 0 && r.h > 0) state.history.push(pixelEntry('指先', g.layer, r, crop(g.before, r), crop(g.layer.canvas, r)));
    requestRender();
  },
};

// ---- テキスト(押した所に、文字を入れる。新しいレイヤーになる。テキストのレイヤーを選んで押すと、打ち直せる) ----

const FONTS = [['sans-serif', 'ゴシック体'], ['serif', '明朝体'], ['"Yu Gothic", "Hiragino Sans", sans-serif', '游ゴシック / ヒラギノ角ゴ'], ['"Yu Mincho", "Hiragino Mincho ProN", serif', '游明朝 / ヒラギノ明朝'],
  ['Meiryo, sans-serif', 'メイリオ'], ['"Hiragino Maru Gothic ProN", "BIZ UDPGothic", sans-serif', '丸ゴシック'], ['monospace', '等幅'], ['cursive', '手書き風'],
  ['Arial, sans-serif', 'Arial'], ['"Times New Roman", serif', 'Times New Roman'], ['Georgia, serif', 'Georgia'], ['Impact, sans-serif', 'Impact']];

function drawText(ctx, t) {
  ctx.font = `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px ${t.font}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = t.color;
  t.str.split('\n').forEach((line, i) => ctx.fillText(line, t.x, t.y + i * t.size * 1.25));
}

async function textDialog(x, y, layer) {
  const old = layer?.text, o = old || state.text;
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <textarea id="tx-str" rows="3" placeholder="ここに文字を入れます(Enter で改行)">${escapeHtml(old?.str || '')}</textarea>
    <div class="row"><label>フォント <select id="tx-font">${FONTS.map(([f, n]) => `<option value="${escapeHtml(f)}"${f === o.font ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>大きさ <input type="number" id="tx-size" min="4" max="2000" value="${o.size}"> px</label></div>
    <div class="row"><label class="check"><input type="checkbox" id="tx-bold"${o.bold ? ' checked' : ''}>太字</label><label class="check"><input type="checkbox" id="tx-italic"${o.italic ? ' checked' : ''}>斜体</label>
      ${old ? '<label class="check"><input type="checkbox" id="tx-recolor">色を、今の描画色にする</label>' : '<span class="opt-hint">色は、今の描画色です</span>'}</div>`;
  // Enter は改行(OK にしない)
  body.querySelector('#tx-str').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); }, true);
  const { value } = await openModal({ title: old ? 'テキストを打ち直す' : 'テキスト', body, width: 460, buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  const str = body.querySelector('#tx-str').value.replace(/\s+$/, '');
  if (value !== 'ok' || !str) return;
  const t = {
    str, font: body.querySelector('#tx-font').value, size: Math.min(2000, Math.max(4, Number(body.querySelector('#tx-size').value) || 80)),
    bold: body.querySelector('#tx-bold').checked, italic: body.querySelector('#tx-italic').checked, color: old && !body.querySelector('#tx-recolor').checked ? old.color : state.fg, x: old ? old.x : Math.round(x), y: old ? old.y : Math.round(y),
  };
  state.text = { font: t.font, size: t.size, bold: t.bold, italic: t.italic };
  emit('settings');
  if (!old) {
    const l = newLayerWith(str.split('\n')[0].slice(0, 16), (ctx) => drawText(ctx, t), 'テキスト');
    l.text = t;
    emit('layers');
    return;
  }
  // 打ち直す: レイヤーの絵を、新しい文字に描き直す(元に戻せる)
  const doc = state.doc, full = { x: 0, y: 0, w: doc.w, h: doc.h }, before = crop(layer.canvas, full);
  layer.ctx.clearRect(0, 0, doc.w, doc.h);
  drawText(layer.ctx, t);
  const e = pixelEntry('テキスト', layer, full, before, crop(layer.canvas, full));
  layer.text = t;
  state.history.push({ ...e, undo: () => { e.undo(); layer.text = old; }, redo: () => { e.redo(); layer.text = t; } });
  requestRender();
}

export const textTool = {
  cursor: 'text',
  down(ev) {
    if (state.maskMode) return false;
    const l = state.doc.active;
    if (l?.locked) { say('layerLocked'); return false; }
    textDialog(ev.x, ev.y, l?.text ? l : null);
    return false;
  },
  move() {},
  up() {},
};

// ---- 切り抜き(囲んだ範囲を state.crop に入れる。決めるのは layers.js の cropDoc。下に出る帯の「切り抜く」か Enter) ----

let C = null;

export const cropTool = {
  cursor: 'crosshair',
  down(ev) {
    C = { x: ev.x, y: ev.y };
    return true;
  },
  move(ev) {
    if (!C) return;
    const doc = state.doc, clampX = (v) => Math.min(doc.w, Math.max(0, Math.round(v))), clampY = (v) => Math.min(doc.h, Math.max(0, Math.round(v)));
    let dx = ev.x - C.x, dy = ev.y - C.y;
    if (ev.shift) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = m * (Math.sign(dx) || 1); dy = m * (Math.sign(dy) || 1); } // Shift: 正方形
    const x0 = clampX(Math.min(C.x, C.x + dx)), y0 = clampY(Math.min(C.y, C.y + dy)), x1 = clampX(Math.max(C.x, C.x + dx)), y1 = clampY(Math.max(C.y, C.y + dy));
    state.crop = x1 - x0 >= 2 && y1 - y0 >= 2 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    emit('crop');
    requestRender();
  },
  up() {
    C = null;
    emit('crop');
  },
};
