// 選択範囲: なぞって囲む(フリーハンド)か、四角で囲む。囲んだ所だけ、塗る・消す・動かす・コピー・色の調整ができる。
//   state.selection = { path(Path2D。ドキュメントの座標), mask(囲んだ所が不透明な絵), x, y, w, h(範囲) } / なければ null
//   マスクモードで作った選択範囲(と、自由変形・メッシュでゆがめた選択範囲)は、path がなく、代わりに edge(ふちの線の絵)を持つ
// コピー・ペースト・キャンバスのコピーも、ここ
import { state, emit, requestRender } from './state.js';
import { createCanvas, composite, Layer } from './doc.js';
import { say } from './messages.js';

function buildSelection(doc, path, box) {
  const mask = createCanvas(doc.w, doc.h);
  const m = mask.getContext('2d');
  m.fillStyle = '#000';
  m.fill(path);
  const x = Math.max(0, Math.floor(box.x0)), y = Math.max(0, Math.floor(box.y0));
  const w = Math.min(doc.w, Math.ceil(box.x1)) - x, h = Math.min(doc.h, Math.ceil(box.y1)) - y;
  if (w < 2 || h < 2) return null;
  return { path, mask, x, y, w, h };
}

export function clearSelection() {
  if (!state.selection && !state.selectDraft) return;
  state.selection = null;
  state.selectDraft = null;
  emit('selection');
  requestRender();
}

// すべてを選択(キャンバスぜんぶ)
export function selectAll() {
  const doc = state.doc, path = new Path2D();
  path.rect(0, 0, doc.w, doc.h);
  state.selection = buildSelection(doc, path, { x0: 0, y0: 0, x1: doc.w, y1: doc.h });
  emit('selection');
  requestRender();
}

// 選択範囲を反転(選んでいない所を選ぶ)。選択範囲がなければ、何もしない
export function invertSelection() {
  const sel = state.selection, doc = state.doc;
  if (!sel) return;
  const c = createCanvas(doc.w, doc.h), x = c.getContext('2d');
  x.fillRect(0, 0, doc.w, doc.h);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(sel.mask, 0, 0);
  state.selection = selectionFromMask(c);
  emit('selection');
  requestRender();
}

// 選択範囲を (dx, dy) だけずらす(中身を動かしたとき、枠もついていく)
export function shiftSelection(sel, dx, dy) {
  const doc = state.doc;
  const path = new Path2D();
  path.addPath(sel.path, new DOMMatrix([1, 0, 0, 1, dx, dy]));
  return buildSelection(doc, path, { x0: sel.x + dx, y0: sel.y + dy, x1: sel.x + sel.w + dx, y1: sel.y + sel.h + dy });
}

// 選択範囲を、行列 m(DOMMatrix。ドキュメントの座標)で変形する(中身を拡大・回転したとき、枠もついていく)
export function transformSelection(sel, m) {
  if (!sel.path) {
    // 形(path)のない選択範囲: 絵ごと変形する
    const c = createCanvas(state.doc.w, state.doc.h), x = c.getContext('2d');
    x.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    x.drawImage(sel.mask, 0, 0);
    return selectionFromMask(c);
  }
  const path = new Path2D();
  path.addPath(sel.path, m);
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of [[sel.x, sel.y], [sel.x + sel.w, sel.y], [sel.x, sel.y + sel.h], [sel.x + sel.w, sel.y + sel.h]]) {
    const p = m.transformPoint({ x, y });
    box.x0 = Math.min(box.x0, p.x); box.y0 = Math.min(box.y0, p.y); box.x1 = Math.max(box.x1, p.x); box.y1 = Math.max(box.y1, p.y);
  }
  return buildSelection(state.doc, path, box);
}

// 絵(不透明な所が、選ぶ所)から選択範囲を作る。何もなければ null
export function selectionFromMask(canvas) {
  const w = canvas.width, h = canvas.height;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      if (d[i] < 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const mask = createCanvas(w, h), m = mask.getContext('2d');
  m.drawImage(canvas, 0, 0);
  m.globalCompositeOperation = 'source-in';
  m.fillStyle = '#000';
  m.fillRect(0, 0, w, h);
  // ふちの線: 選ぶ所から、少し内側にちぢめた形を抜いたもの(白黒のしま模様で塗る)
  const K = 2, inner = createCanvas(w, h), n = inner.getContext('2d');
  n.drawImage(mask, 0, 0);
  n.globalCompositeOperation = 'destination-in';
  for (const [dx, dy] of [[K, 0], [-K, 0], [0, K], [0, -K]]) n.drawImage(mask, dx, dy);
  const edge = createCanvas(w, h), e = edge.getContext('2d');
  e.drawImage(mask, 0, 0);
  e.globalCompositeOperation = 'destination-out';
  e.drawImage(inner, 0, 0);
  const tile = createCanvas(8, 8), t = tile.getContext('2d');
  t.fillStyle = '#fff'; t.fillRect(0, 0, 8, 8);
  t.fillStyle = '#000'; t.fillRect(0, 0, 4, 4); t.fillRect(4, 4, 4, 4);
  e.globalCompositeOperation = 'source-in';
  e.fillStyle = e.createPattern(tile, 'repeat');
  e.fillRect(0, 0, w, h);
  return { path: null, mask, edge, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// マスクモード(クイックマスク): 入ると、ブラシ・消しゴム・バケツ・図形などが、絵ではなく「マスク」に描くようになる(半透明の赤で見える)。
// 出ると、描いた所が選択範囲になる。入るときに選択範囲があれば、その形から始まる
export function toggleMask() {
  const doc = state.doc;
  if (!state.maskMode) {
    const layer = new Layer(doc.w, doc.h, 'マスク');
    if (state.selection) {
      layer.ctx.drawImage(state.selection.mask, 0, 0);
      layer.ctx.globalCompositeOperation = 'source-in';
      layer.ctx.fillStyle = '#ff2040';
      layer.ctx.fillRect(0, 0, doc.w, doc.h);
      layer.ctx.globalCompositeOperation = 'source-over';
    }
    state.maskMode = { layer };
    state.selection = null;
    say('maskOn');
  } else {
    const { layer } = state.maskMode;
    state.maskMode = null;
    state.stroke = null;
    state.selection = selectionFromMask(layer.canvas);
    say(state.selection ? 'maskOff' : 'maskEmpty');
  }
  emit('selection');
  emit('mask');
  requestRender();
}

// canvas の絵を、選択範囲の中だけに切り抜く(選択範囲がなければ何もしない)
export function clipToSelection(ctx) {
  const sel = state.selection;
  if (!sel) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(sel.mask, 0, 0);
  ctx.restore();
}

// ---- 選択ツール ----

let D = null;
export const selectTool = {
  cursor: 'crosshair',
  down(ev) {
    const doc = state.doc;
    D = { mode: state.selectMode, x0: ev.x, y0: ev.y, pts: [[ev.x, ev.y]], sx: ev.sx, sy: ev.sy, moved: false, out: ev.x < 0 || ev.y < 0 || ev.x > doc.w || ev.y > doc.h };
    state.selectDraft = null;
    return true;
  },
  move(ev) {
    if (!D) return;
    if (Math.hypot(ev.sx - D.sx, ev.sy - D.sy) > 4) D.moved = true;
    const path = new Path2D();
    if (D.mode === 'rect') {
      path.rect(Math.min(D.x0, ev.x), Math.min(D.y0, ev.y), Math.abs(ev.x - D.x0), Math.abs(ev.y - D.y0));
      D.box = { x0: Math.min(D.x0, ev.x), y0: Math.min(D.y0, ev.y), x1: Math.max(D.x0, ev.x), y1: Math.max(D.y0, ev.y) };
    } else {
      D.pts.push([ev.x, ev.y]);
      D.pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
      path.closePath();
    }
    state.selectDraft = { path };
    requestRender();
  },
  up() {
    const d = D;
    D = null;
    const draft = state.selectDraft;
    state.selectDraft = null;
    // 動かさずに離した(タップ): 選択を解除
    // キャンバスの外をタップ: 選択を解除して、前の描くツールに戻る(移動・変形と同じ。app.js の finishMove)
    if (!d || !d.moved || !draft) { clearSelection(); if (d?.out) emit('move-done'); return; }
    let box = d.box;
    if (d.mode !== 'rect') {
      box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const [x, y] of d.pts) { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); }
    }
    const before = state.selection, after = buildSelection(state.doc, draft.path, box);
    state.selection = after;
    emit('selection');
    if (after) {
      // 元に戻す(2本指タップ)で、選択を解除できるように、履歴に入れる。囲んだあとに移動・変形へ移っていたら、選択ツールに戻る
      const put = (sel, back) => { state.selection = sel; emit('selection'); if (back && state.tool === 'move') emit('request-tool', 'select'); };
      state.history.push({ label: '選択', undo: () => put(before, true), redo: () => put(after, false) });
      emit('selection-made'); // app.js: 設定がオンなら、そのまま移動・変形にする
    }
    requestRender();
  },
};

// 選択ツールの形を切り替える(選択ツールのボタンを、もう一度押したとき)
export function toggleSelectMode() {
  state.selectMode = state.selectMode === 'rect' ? 'lasso' : 'rect';
  say(state.selectMode === 'rect' ? 'selectRect' : 'selectLasso');
  emit('selection');
}

// ---- コピー・ペースト ----

function activeLeaf() {
  const l = state.doc.active;
  if (!l || l.isGroup) { say('needLeaf'); return null; }
  return l;
}

// 今のレイヤーの絵(選択範囲があれば、その中だけ)を取っておく
export function copyLayer() {
  const doc = state.doc, l = activeLeaf();
  if (!l) return false;
  const c = createCanvas(doc.w, doc.h);
  const x = c.getContext('2d');
  x.drawImage(l.canvas, 0, 0);
  clipToSelection(x);
  state.clipboard = { canvas: c, w: doc.w, h: doc.h };
  say(state.selection ? 'copySel' : 'copyLayer');
  return true;
}

export function newLayerWith(name, draw, label, top = false) {
  const doc = state.doc;
  const before = snapshotLists(doc);
  if (top) doc.activeId = doc.layers[doc.layers.length - 1].id; // いちばん上に足す
  const l = new Layer(doc.w, doc.h, name);
  draw(l.ctx);
  // グループの中のレイヤーを選んでいても、グループの外(いちばん外の並び)には出さず、すぐ上に置く
  doc.addLayer(null, l);
  inheritClip(doc, l);
  const after = snapshotLists(doc);
  state.history.push({ label, structure: true, undo: () => restoreLists(doc, before), redo: () => restoreLists(doc, after) });
  emit('layers');
  requestRender();
  return l;
}

// 下にクリップしているレイヤーのすぐ下(土台との間)に足したレイヤーは、同じように下にクリップする
// (そうしないと、上のレイヤーのクリップ先が、足したレイヤーに変わってしまう)
export function inheritClip(doc, node) {
  const at = doc.place(node);
  if (at.list[at.index + 1]?.clip) node.clip = true;
}

function snapshotLists(doc) {
  const lists = [[doc, 'layers', [...doc.layers]]];
  doc.walk((n) => { if (n.isGroup) lists.push([n, 'children', [...n.children]]); });
  return { lists, activeId: doc.activeId };
}
function restoreLists(doc, s) {
  for (const [owner, key, list] of s.lists) owner[key] = [...list];
  doc.activeId = s.activeId;
}

// 取っておいた絵を、新しいレイヤーとして貼る(同じ位置に)
export function pasteLayer() {
  const cb = state.clipboard;
  if (!cb) { say('noClipboard'); return; }
  newLayerWith(state.doc.nextName('ペースト'), (ctx) => ctx.drawImage(cb.canvas, 0, 0), 'ペースト');
  say('paste');
}

// キャンバスのコピー: 今見えている絵(用紙は除く)を1枚にまとめて、新しいレイヤーとしていちばん上に足す
export function copyCanvas() {
  const doc = state.doc;
  const flat = createCanvas(doc.w, doc.h);
  composite(flat.getContext('2d'), doc, null, true);
  newLayerWith(doc.nextName('キャンバスのコピー'), (ctx) => ctx.drawImage(flat, 0, 0), 'キャンバスのコピー', true);
  say('canvasCopy');
}
