// 移動ツール: 今のレイヤーの絵(選択範囲があれば、その中の絵)を、動かす・大きさを変える・回す・ゆがめる。
//   移動ツールにすると、絵のまわりに枠が出る。変形のしかた(state.moveMode)は3つ(画面の下の帯で選ぶ):
//     'scale' 拡縮・回転: 枠の角 = 縦横の比を保って拡大・縮小(帯の「縦横比を固定」を外すか、Shift で自由に)/ 辺の真ん中 = 縦か横だけ /
//                          上と下の離れた丸と四角 = 回転(Shift で 15° ずつ)/ そのほか = 移動(Shift で縦か横だけ)
//     'free'  自由変形:   4つの角を、1つずつ好きな所へ(台形・ななめ)
//     'mesh'  メッシュ:   4×4 の点を動かして、絵を曲げる
//   T = 今の変形(元の絵 src と、置き方 cx, cy, sx, sy, rot。自由変形・メッシュのときは warp = { n, pts } = n×n の点)。
//   何度変えても、元の絵から描き直すので、絵が荒れていかない。変形のしかたを切り替えたときは、今の絵から作り直す。
//   ツール・レイヤー・絵・選択範囲がほかの操作で変わったら、T は捨てて、次に要るときに今の絵から作り直す
import { state, on, emit, requestRender } from './state.js';
import { createCanvas } from './doc.js';
import { contentRect } from './adjust.js';
import { transformSelection, selectionFromMask } from './select.js';
import { say } from './messages.js';

let T = null;      // 今の変形。動かせる絵がないときは { none: 理由のメッセージ }
let D = null;      // ドラッグ中
let mute = false;  // 自分で出したイベント(T は捨てない)
let keep = false;  // 元に戻す / やり直しで T を入れ直した(次の 'history' では捨てない)
let raf = 0;       // 動かしている間の描き直しは、画面の描き直しに合わせて1回だけ(ペンの点は、1回の画面の間にいくつも届く。0.15.1)

const POSE = ['cx', 'cy', 'sx', 'sy', 'rot'];
const copyWarp = (w) => (w ? { n: w.n, pts: w.pts.map((p) => ({ x: p.x, y: p.y })) } : null);
const poseOf = (t) => ({ ...Object.fromEntries(POSE.map((k) => [k, t[k]])), warp: copyWarp(t.warp) });
const setPose = (t, pose) => Object.assign(t, pose, { warp: copyWarp(pose.warp) });
const samePose = (a, b) => POSE.every((k) => Math.abs(a[k] - b[k]) < 1e-6)
  && !a.warp === !b.warp && (!a.warp || a.warp.pts.every((p, i) => Math.abs(p.x - b.warp.pts[i].x) < 1e-6 && Math.abs(p.y - b.warp.pts[i].y) < 1e-6));

function begin() {
  const doc = state.doc, layer = doc?.active;
  if (!layer) return (T = { none: null });
  if (layer.isGroup) return (T = { none: 'paintGroup' });
  if (layer.locked) return (T = { none: 'layerLocked' });
  if (state.maskMode) return (T = { none: null });
  if (!layer.visible) return (T = { none: 'paintHidden' });
  const sel = state.selection;
  const rect = contentRect(layer, sel);
  if (!rect) return (T = { none: 'moveEmpty' });
  const src = createCanvas(rect.w, rect.h), s = src.getContext('2d');
  s.drawImage(layer.canvas, -rect.x, -rect.y);
  let base = null;
  if (sel) {
    // 選択範囲の中の絵(src)と、それを抜いた残り(base)に分ける
    s.globalCompositeOperation = 'destination-in';
    s.drawImage(sel.mask, -rect.x, -rect.y);
    base = createCanvas(doc.w, doc.h);
    const b = base.getContext('2d');
    b.drawImage(layer.canvas, 0, 0);
    b.globalCompositeOperation = 'destination-out';
    b.drawImage(sel.mask, 0, 0);
  }
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  T = { layer, sel, src, base, rx: rect.x, ry: rect.y, w: rect.w, h: rect.h, cx0: cx, cy0: cy, cx, cy, sx: 1, sy: 1, rot: 0, warp: null };
  // 自由変形・メッシュ: 枠の形に、点を並べる
  if (state.moveMode !== 'scale') T.warp = gridOf(T, state.moveMode === 'mesh' ? 4 : 2);
  return T;
}

const session = () => T || begin();

// ---- 自由変形・メッシュ(n×n の点で、絵をゆがめる) ----

function gridOf(t, n) {
  const pts = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push(point(t, (i / (n - 1)) * 2 - 1, (j / (n - 1)) * 2 - 1));
  return { n, pts };
}

// 並んだ点を通る、なめらかな線の上の点(f = 0〜1)。端の外には、折り返した点があるものとして数える(点が2つなら、まっすぐな線)
function along(get, n, f) {
  const s = Math.min(n - 2, Math.max(0, Math.floor(f * (n - 1)))), u = f * (n - 1) - s;
  const p1 = get(s), p2 = get(s + 1);
  const p0 = s > 0 ? get(s - 1) : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y };
  const p3 = s + 2 < n ? get(s + 2) : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y };
  const k = (a, b, c, d) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  return { x: k(p0.x, p1.x, p2.x, p3.x), y: k(p0.y, p1.y, p2.y, p3.y) };
}

// 絵の中の点(u, v は 0〜1)が、ゆがめたあとに行く所
function warpPoint(w, u, v) {
  const rows = [];
  for (let j = 0; j < w.n; j++) rows.push(along((i) => w.pts[j * w.n + i], w.n, u));
  return along((j) => rows[j], w.n, v);
}

// 絵 img を、点の並び w のとおりにゆがめて描く。細かい三角に分けて、1つずつ、まっすぐな変形で写す(div = 1辺を分ける数)
function warpDraw(c, img, w, div) {
  const iw = img.width, ih = img.height, P = [];
  for (let j = 0; j <= div; j++) for (let i = 0; i <= div; i++) P.push(warpPoint(w, i / div, j / div));
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  const tri = (x0, y0, x1, y1, x2, y2, a, b, d) => {
    const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
    if (Math.abs(den) < 1e-9) return;
    // 三角のすき間に線が出ないよう、ほんの少し外へ広げて切り抜く
    const mx = (a.x + b.x + d.x) / 3, my = (a.y + b.y + d.y) / 3;
    const out = (p) => { const dx = p.x - mx, dy = p.y - my, l = Math.hypot(dx, dy) || 1; return [p.x + (dx / l) * 0.7, p.y + (dy / l) * 0.7]; };
    c.save();
    c.beginPath();
    c.moveTo(...out(a)); c.lineTo(...out(b)); c.lineTo(...out(d));
    c.closePath();
    c.clip();
    c.setTransform(
      (a.x * (y1 - y2) + b.x * (y2 - y0) + d.x * (y0 - y1)) / den, (a.y * (y1 - y2) + b.y * (y2 - y0) + d.y * (y0 - y1)) / den,
      (a.x * (x2 - x1) + b.x * (x0 - x2) + d.x * (x1 - x0)) / den, (a.y * (x2 - x1) + b.y * (x0 - x2) + d.y * (x1 - x0)) / den,
      (a.x * (x1 * y2 - x2 * y1) + b.x * (x2 * y0 - x0 * y2) + d.x * (x0 * y1 - x1 * y0)) / den,
      (a.y * (x1 * y2 - x2 * y1) + b.y * (x2 * y0 - x0 * y2) + d.y * (x0 * y1 - x1 * y0)) / den,
    );
    // 写すのは、この三角のまわりだけ
    const sx = Math.max(0, Math.floor(Math.min(x0, x1, x2)) - 2), sy = Math.max(0, Math.floor(Math.min(y0, y1, y2)) - 2);
    const sw = Math.min(iw, Math.ceil(Math.max(x0, x1, x2)) + 2) - sx, sh = Math.min(ih, Math.ceil(Math.max(y0, y1, y2)) + 2) - sy;
    if (sw > 0 && sh > 0) c.drawImage(img, sx, sy, sw, sh, sx, sy, sw, sh);
    c.restore();
  };
  for (let j = 0; j < div; j++) {
    for (let i = 0; i < div; i++) {
      const x0 = (i / div) * iw, x1 = ((i + 1) / div) * iw, y0 = (j / div) * ih, y1 = ((j + 1) / div) * ih;
      const a = P[j * (div + 1) + i], b = P[j * (div + 1) + i + 1], d = P[(j + 1) * (div + 1) + i], e = P[(j + 1) * (div + 1) + i + 1];
      tri(x0, y0, x1, y0, x0, y1, a, b, d);
      tri(x1, y0, x1, y1, x0, y1, b, e, d);
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}

// 動かしている間の、速い描き方(0.15.1。三角ごとの切り抜きが、iPad でとても重かった)。
// 升目1つを、1回の drawImage で写す(升目のまん中が合うように、まっすぐな変形 1 つで近づける。切り抜きはしない)。
// 升目のつなぎ目が、ほんの少しずれることがあるが、離したときに warpDraw でていねいに描き直す
function warpFast(c, img, w, div) {
  const iw = img.width, ih = img.height, P = [], cw = iw / div, chh = ih / div;
  for (let j = 0; j <= div; j++) for (let i = 0; i <= div; i++) P.push(warpPoint(w, i / div, j / div));
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'low';
  for (let j = 0; j < div; j++) {
    for (let i = 0; i < div; i++) {
      const a = P[j * (div + 1) + i], b = P[j * (div + 1) + i + 1], d = P[(j + 1) * (div + 1) + i], e = P[(j + 1) * (div + 1) + i + 1];
      // 横の向き・縦の向き(向かい合う辺の平均)と、まん中
      const ax = (b.x - a.x + e.x - d.x) / 2 / cw, ay = (b.y - a.y + e.y - d.y) / 2 / cw;
      const bx = (d.x - a.x + e.x - b.x) / 2 / chh, by = (d.y - a.y + e.y - b.y) / 2 / chh;
      const mx = (a.x + b.x + d.x + e.x) / 4, my = (a.y + b.y + d.y + e.y) / 4;
      const sx0 = i * cw, sy0 = j * chh, scx = sx0 + cw / 2, scy = sy0 + chh / 2;
      c.setTransform(ax, ay, bx, by, mx - ax * scx - bx * scy, my - ay * scx - by * scy);
      // すき間が出ないよう、となりと少し重ねる
      const x0 = Math.max(0, sx0 - 0.75), y0 = Math.max(0, sy0 - 0.75), x1 = Math.min(iw, sx0 + cw + 0.75), y1 = Math.min(ih, sy0 + chh + 0.75);
      c.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}

// レイヤーの絵を、t の置き方で描き直す(fine = 離したあとの、ていねいな描き方。動かしている間は、荒く速く)
function draw(t, fine = true) {
  const c = t.layer.ctx, doc = state.doc;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, doc.w, doc.h);
  if (t.base) c.drawImage(t.base, 0, 0);
  if (t.warp) {
    if (fine) warpDraw(c, t.src, t.warp, t.warp.n > 2 ? 24 : 16);
    else warpFast(c, t.src, t.warp, t.warp.n > 2 ? 15 : 10);
  } else if (t.rot === 0 && t.sx === 1 && t.sy === 1) {
    c.drawImage(t.src, Math.round(t.cx - t.w / 2), Math.round(t.cy - t.h / 2)); // 動かすだけのときは、ドットをぼかさない
  } else {
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.translate(t.cx, t.cy);
    c.rotate(t.rot);
    c.scale(t.sx, t.sy);
    c.drawImage(t.src, -t.w / 2, -t.h / 2);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
}

// はじめの置き方から、今の置き方への行列(選択範囲の枠を、同じように変形する)
const matrixOf = (t) => new DOMMatrix().translate(t.cx, t.cy).rotate((t.rot * 180) / Math.PI).scale(t.sx, t.sy).translate(-t.cx0, -t.cy0);

// 変形したあとの選択範囲(自由変形・メッシュのときは、選択範囲の絵ごとゆがめる)
function selectionOf(t, fallback) {
  if (!t.sel) return null;
  if (!t.warp) return transformSelection(t.sel, matrixOf(t)) || fallback;
  const doc = state.doc, part = createCanvas(t.w, t.h);
  part.getContext('2d').drawImage(t.sel.mask, -t.rx, -t.ry);
  const c = createCanvas(doc.w, doc.h);
  warpDraw(c.getContext('2d'), part, t.warp, t.warp.n > 2 ? 24 : 16);
  return selectionFromMask(c) || fallback;
}

// 枠の中の点(u, v は -1〜1。枠の真ん中が 0)の、ドキュメントでの位置
function point(t, u, v) {
  const x = (u * t.w * t.sx) / 2, y = (v * t.h * t.sy) / 2, c = Math.cos(t.rot), s = Math.sin(t.rot);
  return { x: t.cx + x * c - y * s, y: t.cy + x * s + y * c };
}

const HANDLES = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
const ROT_GAP = 30; // 回転のハンドルを、枠からこれだけ離す(画面の px)

// 枠とハンドルの、画面での位置(view.js が描く。押した所の判定にも使う)。枠がなければ null。
//   拡縮・回転: { poly, scale, rots } / 自由変形・メッシュ: { warp: true, lines(点の間を結ぶ線), points(動かせる点) }
export function transformBox() {
  if (state.tool !== 'move' || !state.doc) return null;
  const t = session(), v = state.view;
  if (t.none !== undefined) return null;
  if (t.warp) {
    const w = t.warp, lines = [], S = 8 * (w.n - 1);
    const scr = (p) => v.docToScreen(p.x, p.y);
    for (let k = 0; k < w.n; k++) {
      const f = k / (w.n - 1), a = [], b = [];
      for (let i = 0; i <= S; i++) { a.push(scr(warpPoint(w, i / S, f))); b.push(scr(warpPoint(w, f, i / S))); }
      lines.push(a, b);
    }
    return { warp: true, lines, points: w.pts.map(scr) };
  }
  const at = (u, w) => { const p = point(t, u, w); return v.docToScreen(p.x, p.y); };
  const center = at(0, 0);
  const rots = [-1, 1].map((side) => {
    const m = at(0, side);
    let dx = m.x - center.x, dy = m.y - center.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = 0; dy = side; } else { dx /= len; dy /= len; }
    return { x: m.x + dx * ROT_GAP, y: m.y + dy * ROT_GAP, from: m, side };
  });
  return { poly: [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)], scale: HANDLES.map(([hx, hy]) => ({ ...at(hx, hy), hx, hy })), rots };
}

function hit(ev) {
  const box = transformBox();
  if (!box) return null;
  const r = ev.type === 'mouse' ? 10 : 18;
  const near = (p) => Math.hypot(p.x - ev.sx, p.y - ev.sy) <= r;
  if (box.warp) {
    // いちばん近い点
    let best = -1, bd = r;
    box.points.forEach((p, i) => { const d = Math.hypot(p.x - ev.sx, p.y - ev.sy); if (d <= bd) { bd = d; best = i; } });
    return best < 0 ? null : { kind: 'point', i: best };
  }
  if (box.rots.some(near)) return { kind: 'rotate' };
  // 角を先に(小さい枠でも、角をつかめるように)
  const h = box.scale.filter((p) => p.hx && p.hy).find(near) || box.scale.find(near);
  return h ? { kind: 'scale', hx: h.hx, hy: h.hy } : null;
}

const MIN_SCALE = 0.02;
const keepSign = (v, was) => (Math.abs(v) < MIN_SCALE ? MIN_SCALE * (Math.sign(v) || Math.sign(was) || 1) : v);
const LABELS = { move: 'レイヤー移動', rotate: '回転', scale: '拡大・縮小', point: '変形', flipH: '左右反転', flipV: '上下反転' };

// 変形を確かめて、履歴に入れる(before = 変える前の置き方)
// 選択範囲は、置き方ごとに「控え」{ sel, done } で持つ。自由変形・メッシュでゆがめた選択範囲は、作るのが重い
// (選択範囲の絵をゆがめて、キャンバス全体を読み戻す)ので、点を動かすたびには作らない(0.15.1)。
// 移動・変形の間は、選択範囲は見えないし使わないので、要るとき(ほかのツール・ほかの操作に移るとき = flushMove)に、1回だけ作る
function commit(t, kind, before, selBefore) {
  const after = poseOf(t);
  const hb = t.selRec || { sel: selBefore, done: true };
  const ha = t.sel && t.warp ? { sel: undefined, done: false } : { sel: selectionOf(t, selBefore), done: true };
  // 元に戻す / やり直し: 置き方を戻して描き直す。移動ツールのままなら、枠もその形に戻す
  const restore = (pose, h) => {
    setPose(t, pose);
    draw(t);
    useSel(t, h);
    const live = state.tool === 'move' && state.doc?.active === t.layer && (t.warp ? (t.warp.n > 2 ? 'mesh' : 'free') : 'scale') === state.moveMode;
    if (!live) flushMove();
    T = live ? t : null;
    keep = live;
  };
  useSel(t, ha);
  mute = true;
  state.history.push({
    label: kind === 'move' && t.sel ? '選択範囲を移動' : LABELS[kind], layer: t.layer,
    undo: () => restore(before, hb), redo: () => restore(after, ha),
  });
  mute = false;
  requestRender();
}

let pending = null; // まだ作っていない選択範囲 { t, h(控え), stale(今、仮に入っている前の選択範囲) }

// t の今の置き方の選択範囲を、控え h のものにする(まだ作っていなければ、あとで作る)
function useSel(t, h) {
  t.selRec = h;
  if (!t.sel) return;
  if (!h.done) { pending = { t, h, stale: state.selection }; return; }
  pending = null;
  state.selection = h.sel;
  mute = true; emit('selection'); mute = false;
}

// あとで作ることにしていた選択範囲を、今作る(ほかの操作が、選択範囲を使う前に呼ぶ)
export function flushMove() {
  if (!pending) return;
  const { t, h, stale } = pending;
  pending = null;
  if (state.selection !== stale) return; // その間に、選択範囲がほかの操作で変わった(解除など): そちらを残す
  h.sel = selectionOf(t, stale);
  h.done = true;
  state.selection = h.sel;
  mute = true; emit('selection'); mute = false;
}

const outside = (ev) => { const doc = state.doc; return ev.x < 0 || ev.y < 0 || ev.x > doc.w || ev.y > doc.h; };

export const moveTool = {
  cursor: 'move',
  down(ev) {
    const t = session();
    if (t.none !== undefined) {
      // 動かせる絵がない: キャンバスの外を押したら、移動・変形を終わる
      if (outside(ev)) emit('move-done'); else if (t.none) say(t.none);
      return false;
    }
    const h = hit(ev) || { kind: 'move' };
    D = { ...h, x: ev.x, y: ev.y, sx: ev.sx, sy: ev.sy, p0: poseOf(t), sel0: state.selection, out: h.kind === 'move' && outside(ev), far: false };
    if (h.kind === 'scale') {
      // 反対側のハンドルを動かさずに、大きさを変える
      D.anchor = point(t, -h.hx, -h.hy);
      const v = this.local(ev, D.anchor, t.rot);
      D.gx = v.x - h.hx * t.w * t.sx; // つかんだ所と、ハンドルのずれ
      D.gy = v.y - h.hy * t.h * t.sy;
    } else if (h.kind === 'rotate') {
      D.a0 = Math.atan2(ev.y - t.cy, ev.x - t.cx);
    }
    return true;
  },
  // 点 p を、anchor から見た、枠の向きでの位置にする
  local(p, anchor, rot) {
    const dx = p.x - anchor.x, dy = p.y - anchor.y, c = Math.cos(rot), s = Math.sin(rot);
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  },
  move(ev) {
    if (!D || !T || T.none !== undefined) return;
    const t = T, p0 = D.p0;
    if (Math.hypot(ev.sx - D.sx, ev.sy - D.sy) > 6) D.far = true;
    if (t.warp) {
      // 自由変形・メッシュ: つかんだ点だけ(そのほかを持ったら、ぜんぶの点)を動かす
      let dx = ev.x - D.x, dy = ev.y - D.y;
      if (D.kind !== 'point') { dx = Math.round(dx); dy = Math.round(dy); if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } }
      t.warp.pts.forEach((p, i) => {
        if (D.kind === 'point' && i !== D.i) return;
        p.x = p0.warp.pts[i].x + dx;
        p.y = p0.warp.pts[i].y + dy;
      });
    } else if (D.kind === 'move') {
      let dx = Math.round(ev.x - D.x), dy = Math.round(ev.y - D.y);
      if (ev.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; } // Shift: 縦か横だけ
      t.cx = p0.cx + dx;
      t.cy = p0.cy + dy;
    } else if (D.kind === 'rotate') {
      let rot = p0.rot + Math.atan2(ev.y - t.cy, ev.x - t.cx) - D.a0;
      if (ev.shift) { const step = Math.PI / 12; rot = Math.round(rot / step) * step; } // Shift: 15° ずつ
      t.rot = Math.abs(rot) < 1e-9 ? 0 : rot;
    } else {
      const { hx, hy, anchor } = D;
      const v = this.local(ev, anchor, p0.rot);
      let sx = hx ? (v.x - D.gx) / (hx * t.w) : p0.sx, sy = hy ? (v.y - D.gy) / (hy * t.h) : p0.sy;
      if (hx && hy && state.moveKeepRatio !== ev.shift) {
        // 角: 縦横の比を保つ(「縦横比を固定」を外しているか、Shift を押していると、自由に)
        const k = (sx / p0.sx + sy / p0.sy) / 2;
        sx = p0.sx * k;
        sy = p0.sy * k;
      }
      t.sx = keepSign(sx, p0.sx);
      t.sy = keepSign(sy, p0.sy);
      const ox = (hx * t.w * t.sx) / 2, oy = (hy * t.h * t.sy) / 2, c = Math.cos(p0.rot), s = Math.sin(p0.rot);
      t.cx = anchor.x + ox * c - oy * s;
      t.cy = anchor.y + ox * s + oy * c;
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (D && T && T.none === undefined) { draw(T, false); requestRender(); } });
  },
  up() {
    const d = D;
    D = null;
    cancelAnimationFrame(raf);
    raf = 0;
    if (!d || !T || T.none !== undefined) return;
    const t = T;
    state.selectDraft = null;
    if (samePose(d.p0, poseOf(t))) {
      // キャンバスの外を、動かさずに押した: 移動・変形を終わる(選択も解除)
      if (d.out && !d.far) emit('move-done');
      requestRender();
      return;
    }
    draw(t);
    commit(t, d.kind, d.p0, d.sel0);
  },
};

// 変形のしかたを切り替える('scale' | 'free' | 'mesh')。今の絵から、枠を作り直す
export function setMoveMode(mode) {
  if (D) return;
  flushMove();
  state.moveMode = mode;
  T = null;
  emit('move-mode');
  requestRender();
}

// 移動ツールの最中の反転(枠の中の絵を、その場で左右 'h' / 上下 'v' に反転する)。移動ツールでなければ、レイヤーの反転
export function flipMove(dir) {
  if (state.tool !== 'move') { flipLayer(dir); return; }
  const t = session();
  if (t.none !== undefined) { if (t.none) say(t.none); return; }
  const before = poseOf(t), selBefore = state.selection;
  if (t.warp) {
    // 点の並びを逆にする(形はそのまま、中の絵が反転する)
    const n = t.warp.n, old = t.warp.pts.map((p) => ({ ...p }));
    t.warp.pts.forEach((p, k) => { const i = k % n, j = Math.floor(k / n), q = old[dir === 'h' ? j * n + (n - 1 - i) : (n - 1 - j) * n + i]; p.x = q.x; p.y = q.y; });
  } else if (dir === 'h') t.sx = -t.sx; else t.sy = -t.sy;
  draw(t);
  commit(t, dir === 'h' ? 'flipH' : 'flipV', before, selBefore);
}

// 今のレイヤーの絵(選択範囲があれば、その中)を、左右('h')か上下('v')に反転する(絵そのものを変える)
export function flipLayer(dir) {
  const was = state.tool, mode = state.moveMode;
  flushMove();
  T = null;
  state.moveMode = 'scale';
  const t = begin();
  state.moveMode = mode;
  if (t.none !== undefined) { if (t.none) say(t.none); T = null; return; }
  const before = poseOf(t), selBefore = state.selection;
  if (dir === 'h') t.sx = -1; else t.sy = -1;
  draw(t);
  const after = poseOf(t), selAfter = selectionOf(t, selBefore);
  const restore = (pose, sel) => { setPose(t, pose); draw(t); if (t.sel) { state.selection = sel; mute = true; emit('selection'); mute = false; } T = null; };
  if (t.sel) { state.selection = selAfter; mute = true; emit('selection'); mute = false; }
  state.history.push({ label: dir === 'h' ? '左右反転' : '上下反転', layer: t.layer, undo: () => restore(before, selBefore), redo: () => restore(after, selAfter) });
  T = null; // 次に要るときに、反転したあとの絵から作り直す
  if (was) requestRender();
}

// 今のレイヤー(選択範囲があれば、その中)に、動かせる絵があるか
export function canMove() {
  const l = state.doc?.active;
  return !!l && !l.isGroup && !l.locked && l.visible && !state.maskMode && !!contentRect(l, state.selection);
}

// ほかの操作で、ツール・レイヤー・絵・選択範囲が変わったら、今の変形は捨てる(次に要るときに、今の絵から作り直す)
const drop = () => { if (!D) { flushMove(); T = null; } };
on('tool', drop);
on('doc', drop);
on('mask', drop);
on('selection', () => { if (!mute) drop(); });
on('layers', () => { if (T && (T.none !== undefined || T.layer !== state.doc?.active || !T.layer.visible)) drop(); });
on('history', () => {
  if (mute) return;
  if (keep) { keep = false; return; }
  drop();
});
