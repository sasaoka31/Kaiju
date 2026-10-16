// Claude 連携の道具の中身(画面側)。メインプロセス(lib/claude.js)が window.kaiju.tool(名前, 引数) を呼ぶ。
//   道具の一覧と説明は lib/claude-tools.js。ここは、絵に手を入れる所だけ(ファイルの読み書きは、メインプロセス)。
//   描くのは、ふだんのツール(tools.js のブラシ・バケツ)に、作った点を渡す形: 選択範囲・アルファロック・履歴(元に戻す)が、手で描いたときと同じに効く
import { state, emit, requestRender } from './state.js';
import { Doc, createCanvas, composite, renderNodes, flatten, BLENDS } from './doc.js';
import * as layers from './layers.js';
import { tools, paintable, pixelEntry, crop } from './tools.js';
import { fillRegion, expandRegion } from './fill.js';
import { clearSelection, selectionFromMask, transformSelection } from './select.js';
import { isAdjusting, contentRect, adjustPixels } from './adjust.js';
import { isModalOpen } from './modal.js';
import { writePsd } from './psd.js';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const isColor = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
function colorOf(c, need = true) {
  if (c === undefined || c === null) { if (need) throw new Error('color を "#rrggbb" で指定してください'); return null; }
  if (!isColor(c)) throw new Error(`色は "#rrggbb" の形で指定してください(${c})`);
  return c.toLowerCase();
}

// id か名前から、レイヤーを探す(省略 = 今のレイヤー)
function findLayer(ref) {
  const doc = state.doc;
  if (ref === undefined || ref === null || ref === '') return doc.active;
  let hit = null;
  doc.walk((n) => { if (!hit && (n.id === Number(ref) || n.name === String(ref))) hit = n; });
  if (!hit) throw new Error(`レイヤーが見つかりません: ${ref}`);
  return hit;
}
// 描く先のレイヤーを選ぶ(layer の指定があれば、そのレイヤーを今のレイヤーにする)
function target(ref) {
  const l = findLayer(ref);
  if (!l) throw new Error('レイヤーがありません');
  if (l !== state.doc.active) layers.setActive(l.id);
  if (l.isGroup) throw new Error('グループには描けません。中のレイヤーを選んでください');
  if (l.locked) throw new Error(`レイヤー「${l.name}」は、ロックされています`);
  if (!l.visible) throw new Error(`レイヤー「${l.name}」は、非表示です`);
  return l;
}

function layerList() {
  const out = [];
  const add = (nodes, depth) => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const l = nodes[i];
      out.push({ id: l.id, name: l.name, type: l.isGroup ? 'group' : l.paper ? 'paper' : 'layer', depth, visible: l.visible, opacity: Math.round(l.opacity * 100) / 100, blend: l.blend, clip: !!l.clip, lock_alpha: !!l.lockAlpha, locked: !!l.locked });
      if (l.isGroup) add(l.children, depth + 1);
    }
  };
  add(state.doc.layers, 0);
  return out;
}

// 作った点を、ツールに渡すときの形(ペンで、筆圧 p)
const ev = (x, y, p, i) => ({ x, y, sx: x, sy: y, p, type: 'pen', shift: false, alt: false, ctrl: false, t: i * 8, st: null });

// 状態を一時的に変えて fn を実行し、かならず元に戻す
function withState(patch, fn) {
  const was = {};
  for (const k of Object.keys(patch)) { was[k] = state[k]; state[k] = patch[k]; }
  try { return fn(); } finally { Object.assign(state, was); }
}

// 左右対称(mirror_x): 縦の線の x(true = キャンバスのまん中)。付いていれば、線・形・塗る点を、その線で映したものも足す。なければ null
function axisOf(a) {
  if (a.mirror_x === true) return state.doc.w / 2;
  return typeof a.mirror_x === 'number' && Number.isFinite(a.mirror_x) ? a.mirror_x : null;
}
// 形(kaiju_shape の shapes の1つ)を、x = ax の線で映した形
function mirrorShape(s, ax) {
  const f = (x) => 2 * ax - x;
  if (s.type === 'rect') return { ...s, x: f(num(s.x, 0)) - num(s.w, 0) };
  if (s.type === 'ellipse') return { ...s, cx: f(num(s.cx, 0)), rotation: -num(s.rotation, 0) };
  if (s.type === 'polygon') return { ...s, points: (s.points || []).map((q) => (Array.isArray(q) ? [f(q[0]), q[1]] : q)) };
  if (s.type === 'path') { let i = 0; return { ...s, d: String(s.d || '').replace(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (m) => (i++ % 2 === 0 ? ' ' + f(Number(m)) : m)) }; } // 数字は x, y の順に並ぶ(M L C Q Z だけなので)
  return s;
}
const withMirror = (shapes, ax) => (ax === null ? shapes : shapes.flatMap((s) => [s, mirrorShape(s, ax)]));

// 形の道(Path2D)を作る。grow(x, y, 余白) に、形のある範囲を知らせる(m = 線の太さの分の余白)
function shapePath(s, grow, m = 0) {
  const p = new Path2D();
  if (s.type === 'rect') {
    const x = num(s.x, 0), y = num(s.y, 0), w = num(s.w, 0), h = num(s.h, 0), r = Math.min(Math.abs(w), Math.abs(h)) / 2;
    if (s.round > 0 && p.roundRect) p.roundRect(x, y, w, h, Math.min(r, s.round)); else p.rect(x, y, w, h);
    grow(x, y, m); grow(x + w, y + h, m);
  } else if (s.type === 'ellipse') {
    const cx = num(s.cx, 0), cy = num(s.cy, 0), rx = Math.abs(num(s.rx, 10)), ry = Math.abs(num(s.ry, rx));
    p.ellipse(cx, cy, rx, ry, (num(s.rotation, 0) * Math.PI) / 180, 0, Math.PI * 2);
    const rr = Math.max(rx, ry);
    grow(cx - rr, cy - rr, m); grow(cx + rr, cy + rr, m);
  } else if (s.type === 'polygon') {
    const pts = (s.points || []).filter((q) => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]));
    if (pts.length < 2) throw new Error('polygon の points は、2点以上にしてください');
    const closed = s.closed !== false, n = pts.length;
    p.moveTo(pts[0][0], pts[0][1]);
    if (s.smooth && n > 2) {
      // 点を通る、なめらかな線(となりの点の向きから、曲がり方を決める)
      const at = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.min(n - 1, Math.max(0, i))]);
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        p.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
      }
    } else for (let i = 1; i < n; i++) p.lineTo(pts[i][0], pts[i][1]);
    if (closed) p.closePath();
    // なめらかな線は、点の外へ少しふくらむので、広めに取る
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]), pad = m + (s.smooth ? Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.2 : 0);
    for (const q of pts) grow(q[0], q[1], pad);
  } else if (s.type === 'path') {
    const d = String(s.d || '');
    if (/[^MLCQZz0-9eE.,\s+-]/.test(d)) throw new Error('path の d は、大文字の M L C Q Z と数字だけにしてください(小文字の命令・A・H・V などは使えません)');
    const nums = (d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number);
    if (nums.length < 4) throw new Error('path の d が、短すぎます');
    p.addPath(new Path2D(d));
    for (let i = 0; i + 1 < nums.length; i += 2) grow(nums[i], nums[i + 1], m);
  } else throw new Error('知らない形です: ' + s.type);
  return p;
}

const TOOLS = {
  get_state() {
    const doc = state.doc, sel = state.selection;
    return {
      canvas: { w: doc.w, h: doc.h }, file: state.filePath, unsaved: !!state.dirty, active_layer: doc.activeId,
      layers: layerList(), // 上から
      fg: state.fg, bg: state.bg,
      brushes: state.brushes.map((b) => ({ id: b.id, name: b.name, size: b.size, opacity: b.opacity, ...(b.erase ? { eraser: true } : {}) })),
      selection: sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : null,
      can_undo: state.history.undoStack.length,
    };
  },

  view(a) {
    const doc = state.doc;
    const r = a.region ? { x: num(a.region.x, 0), y: num(a.region.y, 0), w: Math.max(1, num(a.region.w, doc.w)), h: Math.max(1, num(a.region.h, doc.h)) } : { x: 0, y: 0, w: doc.w, h: doc.h };
    const max = Math.min(1600, Math.max(64, num(a.max_size, 1024)));
    const k = Math.min(4, max / Math.max(r.w, r.h));
    const c = createCanvas(Math.max(1, Math.round(r.w * k)), Math.max(1, Math.round(r.h * k))), x = c.getContext('2d');
    const one = a.layer !== undefined && a.layer !== null && a.layer !== '' ? findLayer(a.layer) : null;
    let src;
    if (one) {
      // 1枚だけ: 透明な所が分かるよう、市松模様の上に
      src = createCanvas(doc.w, doc.h);
      renderNodes(src.getContext('2d'), doc, [one]);
      for (let yy = 0; yy < c.height; yy += 16) for (let xx = 0; xx < c.width; xx += 16) { x.fillStyle = ((xx + yy) / 16) % 2 ? '#ffffff' : '#d9d9de'; x.fillRect(xx, yy, 16, 16); }
    } else {
      src = flatten(doc);
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, c.width, c.height);
    }
    x.imageSmoothingEnabled = k < 2;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    if (a.selection && state.selection) {
      // 選択範囲を、うすい青で重ねる
      const tint = createCanvas(doc.w, doc.h), t = tint.getContext('2d');
      t.drawImage(state.selection.mask, 0, 0);
      t.globalCompositeOperation = 'source-in';
      t.fillStyle = '#1060ff';
      t.fillRect(0, 0, doc.w, doc.h);
      x.globalAlpha = 0.45;
      x.drawImage(tint, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
      x.globalAlpha = 1;
    }
    if (a.grid) {
      // 座標の目盛り: きりのよい間隔で、線と数字
      const step = [10, 20, 50, 100, 200, 500, 1000].find((s) => (Math.max(r.w, r.h) / s) <= 12) || 1000;
      x.lineWidth = 1; x.font = '11px sans-serif'; x.textBaseline = 'top';
      const label = (t, px, py) => { x.fillStyle = 'rgba(255,255,255,.85)'; x.fillRect(px, py, x.measureText(t).width + 4, 13); x.fillStyle = '#c0162c'; x.fillText(t, px + 2, py + 1); };
      x.strokeStyle = 'rgba(200,20,45,.45)';
      for (let gx = Math.ceil(r.x / step) * step; gx <= r.x + r.w; gx += step) { const px = Math.round((gx - r.x) * k) + 0.5; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, c.height); x.stroke(); label(String(gx), px + 1, 1); }
      for (let gy = Math.ceil(r.y / step) * step; gy <= r.y + r.h; gy += step) { const py = Math.round((gy - r.y) * k) + 0.5; x.beginPath(); x.moveTo(0, py); x.lineTo(c.width, py); x.stroke(); label(String(gy), 1, py + 1); }
    }
    return { image: c.toDataURL('image/png'), info: { region: r, scale: Math.round(k * 1000) / 1000, image: { w: c.width, h: c.height }, layer: one ? one.name : 'ぜんぶ' } };
  },

  new_document(a) {
    if (state.dirty && !a.discard_unsaved) throw new Error('保存していない変更があります。ユーザーに確かめてから、discard_unsaved: true を付けてください(先に kaiju_save で保存してもよい)');
    const w = Math.min(8000, Math.max(1, Math.round(num(a.width, 2000)))), h = Math.min(8000, Math.max(1, Math.round(num(a.height, 1400))));
    emit('claude-load-doc', new Doc(w, h, { background: a.transparent ? null : '#ffffff' }));
    return { ok: true, canvas: { w, h }, layers: layerList(), active_layer: state.doc.activeId };
  },

  layer(a) {
    const doc = state.doc;
    const props = (l) => {
      if (a.name !== undefined) layers.setLayerProp(l, 'name', String(a.name).slice(0, 60));
      if (a.opacity !== undefined) layers.setLayerProp(l, 'opacity', Math.min(1, Math.max(0, num(a.opacity, 1))));
      if (a.blend !== undefined) { if (!BLENDS.some((b) => b[0] === a.blend)) throw new Error(`知らない重ね方です: ${a.blend}(使えるもの: ${BLENDS.map((b) => b[0]).join(' / ')})`); layers.setLayerProp(l, 'blend', a.blend); }
      if (a.clip !== undefined) layers.setLayerProp(l, 'clip', !!a.clip);
      if (a.visible !== undefined) layers.setLayerProp(l, 'visible', !!a.visible);
      if (a.lock_alpha !== undefined && !l.isGroup) layers.setLayerProp(l, 'lockAlpha', !!a.lock_alpha);
      if (a.locked !== undefined) layers.setLayerProp(l, 'locked', !!a.locked);
    };
    if (a.op === 'add') {
      if (a.layer !== undefined) layers.setActive(findLayer(a.layer).id); // このレイヤーのすぐ上に足す
      layers.addLayer();
      props(doc.active);
    } else {
      const l = findLayer(a.layer);
      if (!l) throw new Error('レイヤーがありません');
      if (l !== doc.active) layers.setActive(l.id);
      if (a.op === 'set') props(l);
      else if (a.op === 'delete') { if (l.paper) throw new Error('用紙は、消せません(visible: false で隠せます)'); layers.deleteLayer(); }
      else if (a.op === 'duplicate') layers.duplicateLayer();
      else if (a.op === 'merge_down') layers.mergeDown();
      else if (a.op === 'clear') layers.clearLayer();
      else if (a.op === 'move') layers.moveLayer(a.dir === 'down' ? -1 : 1);
      else if (a.op !== 'select') throw new Error('知らない op です: ' + a.op);
    }
    requestRender();
    return { ok: true, active_layer: doc.activeId, layers: layerList() };
  },

  stroke(a) {
    const erase = !!a.erase, kind = erase ? 'eraser' : 'brush';
    const want = a.brush || (erase ? 'eraser-hard' : 'pen');
    const b = state.brushes.find((x) => !!x.erase === erase && (x.id === want || x.name === want));
    if (!b) throw new Error(`ブラシが見つかりません: ${want}(使えるもの: ${state.brushes.filter((x) => !!x.erase === erase).map((x) => x.id).join(' / ')})`);
    if (!Array.isArray(a.strokes) || !a.strokes.length) throw new Error('strokes に、線(点の配列)を1本以上入れてください');
    target(a.layer);
    const color = erase ? state.fg : colorOf(a.color ?? state.fg);
    const taper = a.taper !== false, curve = a.smooth !== false;
    const tool = tools[kind];
    // ブラシの設定は、描く間だけ変えて、戻す(ユーザーのブラシを書き換えない)
    const keep = { size: b.size, opacity: b.opacity, smooth: b.smooth };
    const wasId = state.brushId[kind];
    let drawn = 0;
    // 左右対称: 線ごとに、映した線も引く
    const ax = axisOf(a), lines = ax === null ? a.strokes : a.strokes.flatMap((s) => [s, Array.isArray(s) ? s.map((p) => (Array.isArray(p) ? [2 * ax - p[0], ...p.slice(1)] : p)) : s]);
    try {
      b.smooth = 0; // 点のとおりに引く(手ぶれ補正なし)
      if (a.size !== undefined) b.size = Math.min(2000, Math.max(1, num(a.size, b.size)));
      if (a.opacity !== undefined) b.opacity = Math.min(1, Math.max(0.01, num(a.opacity, b.opacity)));
      state.brushId[kind] = b.id;
      withState({ tool: kind, fg: color, lineGap: 0, symmetry: 'off' }, () => {
        for (const raw of lines) {
          const src = (Array.isArray(raw) ? raw : []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
          if (!src.length) continue;
          // 点の間を細かくつなぐ(8px ごと)。筆圧は、点にあればそれを、なければ入り抜き(両はしを細く)
          const pts = [];
          let total = 0;
          for (let i = 1; i < src.length; i++) total += Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
          let run = 0;
          const press = (given, at) => {
            if (given !== undefined) return Math.min(1, Math.max(0.02, given));
            if (!taper || total < 1) return 1;
            const t = at / total, edge = Math.min(t, 1 - t);
            return Math.min(1, 0.12 + edge * 6);
          };
          pts.push([src[0][0], src[0][1], press(src[0][2], 0)]);
          for (let i = 1; i < src.length; i++) {
            const [x0, y0, p0] = src[i - 1], [x1, y1, p1] = src[i], d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / 8));
            // smooth(はじめからオン): 少ない点でも、点を通るなめらかな曲線にする(前後の点の向きから、曲がり方を決める)。オフなら、まっすぐな線でつなぐ
            const pa = src[i - 2] || [2 * x0 - x1, 2 * y0 - y1], pb = src[i + 1] || [2 * x1 - x0, 2 * y1 - y0];
            const cr = (a0, a1, a2, a3, f) => 0.5 * (2 * a1 + (a2 - a0) * f + (2 * a0 - 5 * a1 + 4 * a2 - a3) * f * f + (3 * a1 - a0 - 3 * a2 + a3) * f * f * f);
            for (let j = 1; j <= n; j++) {
              const f = j / n;
              pts.push([curve ? cr(pa[0], x0, x1, pb[0], f) : x0 + (x1 - x0) * f, curve ? cr(pa[1], y0, y1, pb[1], f) : y0 + (y1 - y0) * f, press(p0 !== undefined && p1 !== undefined ? p0 + (p1 - p0) * f : (j === n ? p1 : undefined), run + d * f)]);
            }
            run += d;
          }
          if (!tool.down(ev(pts[0][0], pts[0][1], pts[0][2], 0))) throw new Error('今のレイヤーには、描けません');
          for (let i = 1; i < pts.length; i++) tool.move(ev(pts[i][0], pts[i][1], pts[i][2], i));
          const last = pts[pts.length - 1];
          tool.up(ev(last[0], last[1], last[2], pts.length));
          drawn++;
        }
      });
    } finally {
      Object.assign(b, keep);
      state.brushId[kind] = wasId;
    }
    requestRender();
    return { ok: true, strokes: drawn, layer: state.doc.active.name };
  },

  fill(a) {
    const doc = state.doc;
    target(a.layer);
    // 塗る点: points [[x, y] か [x, y, "#色"], …](なければ x, y の1点)。左右対称なら、映した点も
    const ax = axisOf(a);
    let pts = Array.isArray(a.points) && a.points.length ? a.points : [[a.x, a.y]];
    if (ax !== null) pts = pts.flatMap((p) => [p, Array.isArray(p) ? [2 * ax - p[0], ...p.slice(1)] : p]);
    pts = pts.map((p) => {
      const x = num(p?.[0], -1), y = num(p?.[1], -1);
      if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) throw new Error(`塗る点 (${p?.[0]}, ${p?.[1]}) が、キャンバスの外です`);
      return [x, y, colorOf(p?.[2] ?? a.color)];
    });
    const missed = [];
    for (const [x, y, c] of pts) {
      // 塗れたかどうかは、履歴のいちばん上が変わったかで見る(履歴は 60 個までなので、数では分からない)
      const top = state.history.undoStack.at(-1);
      withState({
        fg: c,
        fillTolerance: Math.min(255, Math.max(0, num(a.tolerance, 32))), fillGap: Math.min(100, Math.max(0, num(a.gap, 10))),
        fillExpand: Math.min(20, Math.max(0, num(a.expand, 2))), fillRef: a.ref === 'layer' ? 'layer' : 'canvas',
      }, () => tools.fill.down(ev(x, y, 1, 0)));
      if (state.history.undoStack.at(-1) === top) missed.push([x, y]);
    }
    requestRender();
    return { ok: true, filled: missed.length < pts.length, count: pts.length - missed.length, ...(missed.length ? { missed } : {}), layer: doc.active.name };
  },

  // 選択範囲を作る・変える。このあとの線・塗り・形・変形・色の調整は、選んだ所だけに効く
  select(a) {
    const doc = state.doc, op = a.op, sel = state.selection;
    if (op === 'none') { clearSelection(); return { ok: true, selection: null }; }
    let c = createCanvas(doc.w, doc.h), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#000';
    if (op === 'all') x.fillRect(0, 0, doc.w, doc.h);
    else if (op === 'invert') {
      if (!sel) throw new Error('選択範囲がありません');
      x.fillRect(0, 0, doc.w, doc.h);
      x.globalCompositeOperation = 'destination-out';
      x.drawImage(sel.mask, 0, 0);
    } else if (op === 'shapes') {
      if (!Array.isArray(a.shapes) || !a.shapes.length) throw new Error('shapes に、形を1つ以上入れてください');
      for (const s of withMirror(a.shapes, axisOf(a))) x.fill(shapePath(s, () => {}), 'evenodd');
    } else if (op === 'region') {
      // バケツと同じ求め方で、つながっている同じ色の所を選ぶ(自動選択)
      const ax = axisOf(a);
      let pts = Array.isArray(a.points) && a.points.length ? a.points : [[a.x, a.y]];
      if (ax !== null) pts = pts.flatMap((p) => [p, [2 * ax - p[0], p[1]]]);
      const from = a.ref === 'layer' ? findLayer(a.layer) : null;
      if (from?.isGroup) throw new Error('ref: "layer" は、グループには使えません');
      const ref = (from ? from.ctx : flatten(doc).getContext('2d')).getImageData(0, 0, doc.w, doc.h).data;
      const img = new ImageData(doc.w, doc.h);
      for (const p of pts) {
        const px = Math.floor(num(p?.[0], -1)), py = Math.floor(num(p?.[1], -1));
        if (px < 0 || py < 0 || px >= doc.w || py >= doc.h) throw new Error(`点 (${p?.[0]}, ${p?.[1]}) が、キャンバスの外です`);
        const region = fillRegion(ref, doc.w, doc.h, px, py, Math.min(255, Math.max(0, num(a.tolerance, 32))), Math.min(100, Math.max(0, num(a.gap, 0))));
        if (!region) continue;
        const r = expandRegion(region, doc.w, doc.h, Math.min(20, Math.max(0, Math.round(num(a.expand, 0)))));
        for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) if (r.on[j * r.w + i]) img.data[((r.y + j) * doc.w + r.x + i) * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0);
    } else if (op === 'layer') {
      // レイヤーの絵のある所
      const l = findLayer(a.layer);
      if (!l) throw new Error('レイヤーがありません');
      if (l.isGroup) renderNodes(x, doc, l.children); else x.drawImage(l.canvas, 0, 0);
    } else throw new Error('知らない op です: ' + op);
    // ぼかす(feather)
    const feather = Math.min(200, Math.max(0, num(a.feather, 0)));
    if (feather > 0) {
      const b = createCanvas(doc.w, doc.h), g = b.getContext('2d', { willReadFrequently: true });
      g.filter = `blur(${feather}px)`;
      g.drawImage(c, 0, 0);
      g.filter = 'none';
      c = b; x = g;
    }
    // 今の選択範囲との合わせ方(mode): add = 足す / subtract = 引く / intersect = 重なった所だけ
    const mode = op === 'invert' ? 'new' : a.mode || 'new';
    x.setTransform(1, 0, 0, 1, 0, 0);
    if (sel && mode === 'add') { x.globalCompositeOperation = 'source-over'; x.drawImage(sel.mask, 0, 0); }
    else if (sel && mode === 'intersect') { x.globalCompositeOperation = 'destination-in'; x.drawImage(sel.mask, 0, 0); }
    else if (mode === 'subtract') {
      if (!sel) throw new Error('選択範囲がありません(引く元がない)');
      const b = createCanvas(doc.w, doc.h), g = b.getContext('2d', { willReadFrequently: true });
      g.drawImage(sel.mask, 0, 0);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(c, 0, 0);
      c = b;
    } else if (!['new', 'add', 'intersect'].includes(mode)) throw new Error('知らない mode です: ' + mode);
    state.selection = selectionFromMask(c);
    state.selectDraft = null;
    emit('selection');
    requestRender();
    const s = state.selection;
    return s ? { ok: true, selection: { x: s.x, y: s.y, w: s.w, h: s.h } } : { ok: true, selection: null, note: '何も選ばれませんでした(選択範囲は、なし)' };
  },

  // 今のレイヤーの絵(選択範囲があれば、その中の絵)を、動かす・大きさを変える・回す・反転する
  transform(a) {
    const doc = state.doc, layer = target(a.layer), sel = state.selection;
    const rect = contentRect(layer, sel);
    if (!rect) throw new Error(sel ? '選択範囲の中に、動かす絵がありません' : 'このレイヤーには、動かす絵がありません');
    const ox = num(a.origin?.[0], rect.x + rect.w / 2), oy = num(a.origin?.[1], rect.y + rect.h / 2);
    let sx = num(Array.isArray(a.scale) ? a.scale[0] : a.scale, 1), sy = num(Array.isArray(a.scale) ? a.scale[1] : a.scale, 1);
    if (!sx || !sy) throw new Error('scale は、0 にできません');
    if (a.flip === 'h') sx = -sx; else if (a.flip === 'v') sy = -sy; else if (a.flip) throw new Error('flip は "h"(左右)か "v"(上下)です');
    const m = new DOMMatrix().translate(ox + num(a.dx, 0), oy + num(a.dy, 0)).rotate(num(a.rotate, 0)).scale(sx, sy).translate(-ox, -oy);
    // 動かす絵(選択範囲があれば、その中だけ)
    const src = createCanvas(rect.w, rect.h), s = src.getContext('2d');
    s.drawImage(layer.canvas, -rect.x, -rect.y);
    if (sel) { s.globalCompositeOperation = 'destination-in'; s.drawImage(sel.mask, -rect.x, -rect.y); }
    // 描き換える範囲 = 元の所と、行き先を合わせた所
    const box = { x0: rect.x, y0: rect.y, x1: rect.x + rect.w, y1: rect.y + rect.h }, to = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const [px, py] of [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]]) {
      const q = m.transformPoint({ x: px, y: py });
      to.x0 = Math.min(to.x0, q.x); to.y0 = Math.min(to.y0, q.y); to.x1 = Math.max(to.x1, q.x); to.y1 = Math.max(to.y1, q.y);
    }
    const x0 = Math.max(0, Math.floor(Math.min(box.x0, to.x0)) - 2), y0 = Math.max(0, Math.floor(Math.min(box.y0, to.y0)) - 2);
    const x1 = Math.min(doc.w, Math.ceil(Math.max(box.x1, to.x1)) + 2), y1 = Math.min(doc.h, Math.ceil(Math.max(box.y1, to.y1)) + 2);
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const before = crop(layer.canvas, r), c = layer.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    if (sel) { c.globalCompositeOperation = 'destination-out'; c.drawImage(sel.mask, 0, 0); c.globalCompositeOperation = 'source-over'; } else c.clearRect(rect.x, rect.y, rect.w, rect.h);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    c.drawImage(src, rect.x, rect.y);
    c.setTransform(1, 0, 0, 1, 0, 0);
    state.history.push(pixelEntry('変形', layer, r, before, crop(layer.canvas, r)));
    // 選択範囲も、ついていく
    if (sel) { state.selection = transformSelection(sel, m); emit('selection'); }
    requestRender();
    const round = (v) => Math.round(v);
    return { ok: true, layer: layer.name, from: rect, to: { x: round(to.x0), y: round(to.y0), w: round(to.x1 - to.x0), h: round(to.y1 - to.y0) } };
  },

  // 色相・彩度・明るさ(今のレイヤー。選択範囲があれば、その中だけ)
  adjust(a) {
    const layer = target(a.layer), sel = state.selection;
    const rect = contentRect(layer, sel);
    if (!rect) throw new Error(sel ? '選択範囲の中に、絵がありません' : 'このレイヤーには、絵がありません');
    const clampTo = (v, lim) => Math.min(lim, Math.max(-lim, num(v, 0)));
    const src = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h), dst = new ImageData(rect.w, rect.h);
    adjustPixels(src, dst, clampTo(a.hue, 180), clampTo(a.saturation, 100), clampTo(a.lightness, 100));
    const before = crop(layer.canvas, rect), c = layer.ctx;
    if (!sel) c.putImageData(dst, rect.x, rect.y);
    else {
      // 選択範囲の中だけ、入れ替える
      const tmp = createCanvas(rect.w, rect.h), t = tmp.getContext('2d');
      t.putImageData(dst, 0, 0);
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(sel.mask, -rect.x, -rect.y);
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.beginPath(); c.rect(rect.x, rect.y, rect.w, rect.h); c.clip();
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(sel.mask, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.drawImage(tmp, rect.x, rect.y);
      c.restore();
    }
    state.history.push(pixelEntry('色相・彩度・明るさ', layer, rect, before, crop(layer.canvas, rect)));
    requestRender();
    return { ok: true, layer: layer.name, area: rect };
  },

  shape(a) {
    const doc = state.doc, layer = target(a.layer);
    if (!Array.isArray(a.shapes) || !a.shapes.length) throw new Error('shapes に、形を1つ以上入れてください');
    const blur = Math.min(200, Math.max(0, num(a.blur, 0)));
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = (x, y, m = 0) => { box.x0 = Math.min(box.x0, x - m); box.y0 = Math.min(box.y0, y - m); box.x1 = Math.max(box.x1, x + m); box.y1 = Math.max(box.y1, y + m); };
    const list = withMirror(a.shapes, axisOf(a)).map((s) => {
      const sw = Math.max(0, num(s.strokeWidth, s.stroke ? 4 : 0)), p = shapePath(s, grow, sw / 2 + 2);
      return { p, fill: s.fill === undefined ? (s.stroke ? null : state.fg) : colorOf(s.fill, false), stroke: colorOf(s.stroke, false), sw };
    });
    const pad = Math.ceil(blur * 3);
    const x0 = Math.max(0, Math.floor(box.x0 - pad)), y0 = Math.max(0, Math.floor(box.y0 - pad)), x1 = Math.min(doc.w, Math.ceil(box.x1 + pad)), y1 = Math.min(doc.h, Math.ceil(box.y1 + pad));
    if (x1 <= x0 || y1 <= y0) throw new Error('形が、キャンバスの外です');
    const r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    // いったん別の絵に描いてから、まとめて重ねる(ぼかし・不透明度・選択範囲を、形ぜんぶに同じように掛ける)
    const tmp = createCanvas(r.w, r.h), t = tmp.getContext('2d');
    t.translate(-r.x, -r.y);
    t.lineJoin = 'round'; t.lineCap = 'round';
    for (const s of list) {
      if (s.fill) { t.fillStyle = s.fill; t.fill(s.p, 'evenodd'); }
      if (s.stroke && s.sw > 0) { t.strokeStyle = s.stroke; t.lineWidth = s.sw; t.stroke(s.p); }
    }
    let img = tmp;
    if (blur > 0) {
      img = createCanvas(r.w, r.h);
      const g = img.getContext('2d');
      g.filter = `blur(${blur}px)`;
      g.drawImage(tmp, 0, 0);
    }
    if (state.selection) {
      const g = img.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.filter = 'none';
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(state.selection.mask, -r.x, -r.y);
    }
    const before = crop(layer.canvas, r), c = layer.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = Math.min(1, Math.max(0.01, num(a.opacity, 1)));
    c.globalCompositeOperation = a.erase ? 'destination-out' : layer.lockAlpha ? 'source-atop' : 'source-over';
    c.drawImage(img, r.x, r.y);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    state.history.push(pixelEntry(a.erase ? '形で消す' : '形', layer, r, before, crop(layer.canvas, r)));
    requestRender();
    return { ok: true, shapes: list.length, area: r, layer: layer.name };
  },

  undo(a) {
    const n = Math.min(60, Math.max(1, Math.round(num(a.steps, 1))));
    let done = 0;
    for (let i = 0; i < n; i++) {
      if (a.redo ? !state.history.canRedo : !state.history.canUndo) break;
      if (a.redo) state.history.redo(); else state.history.undo();
      done++;
    }
    return { ok: true, done, can_undo: state.history.undoStack.length };
  },

  async import_image(a) {
    const doc = state.doc, img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('画像を読めませんでした')); img.src = a.url; });
    layers.addLayer();
    const l = doc.active, k = Math.min(1, doc.w / img.width, doc.h / img.height), w = Math.round(img.width * k), h = Math.round(img.height * k);
    layers.setLayerProp(l, 'name', String(a.name || '画像').slice(0, 60));
    l.ctx.imageSmoothingQuality = 'high';
    l.ctx.drawImage(img, Math.round((doc.w - w) / 2), Math.round((doc.h - h) / 2), w, h);
    emit('layers');
    requestRender();
    return { ok: true, layer: { id: l.id, name: l.name }, placed: { x: Math.round((doc.w - w) / 2), y: Math.round((doc.h - h) / 2), w, h } };
  },

  // transparent = 用紙を抜く(ゲームの素材に)/ trim = 絵のある所だけに切りつめる / scale = 大きさの倍率
  export_png(a) {
    const doc = state.doc;
    let c = createCanvas(doc.w, doc.h), at = { x: 0, y: 0 };
    composite(c.getContext('2d'), doc, null, !!a.transparent);
    if (a.trim) {
      const d = c.getContext('2d').getImageData(0, 0, doc.w, doc.h).data;
      let x0 = doc.w, y0 = doc.h, x1 = -1, y1 = -1;
      for (let y = 0, i = 3; y < doc.h; y++) for (let x = 0; x < doc.w; x++, i += 4) if (d[i]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
      if (x1 < 0) throw new Error('絵が、何もありません(trim できません)');
      const pad = Math.min(200, Math.max(0, Math.round(num(a.trim_margin, 0))));
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(doc.w - 1, x1 + pad); y1 = Math.min(doc.h - 1, y1 + pad);
      at = { x: x0, y: y0 };
      c = crop(c, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
    const k = Math.min(4, Math.max(0.02, num(a.scale, 1)));
    if (k !== 1) {
      const s = createCanvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k))), g = s.getContext('2d');
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, s.width, s.height);
      c = s;
    }
    return { image: c.toDataURL('image/png'), size: { w: c.width, h: c.height }, ...(a.trim ? { trimmed_from: at } : {}) };
  },

  // ここから下は、lib/claude.js の kaiju_save が使う
  file_path: () => ({ path: /\.psd$/i.test(state.filePath || '') ? state.filePath : '' }),
  psd_bytes() {
    const u8 = writePsd(state.doc);
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(bin) };
  },
  saved(a) {
    state.filePath = a.path;
    state.dirty = false;
    emit('title');
    return { ok: true };
  },
};

// 道具を1つ実行する。うまくいかないときは、わけを書いた Error を投げる(Claude に、そのまま伝わる)
async function tool(name, args) {
  if (!TOOLS[name]) throw new Error('知らない道具です: ' + name);
  if (!state.doc) throw new Error('絵が、まだ開かれていません');
  if (isModalOpen()) throw new Error('Kaiju で、ダイアログが開いています。閉じてから、もう一度');
  if (isAdjusting()) throw new Error('Kaiju で、色の調整のウィンドウが開いています。「適用」か「やめる」で閉じてから、もう一度');
  if (state.stroke) throw new Error('Kaiju で、今、線を描いている最中です');
  return TOOLS[name](args || {});
}

window.kaiju = { tool };
