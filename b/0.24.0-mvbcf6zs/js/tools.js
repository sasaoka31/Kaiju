// ツール。tool = { cursor, down(ev) → ドラッグを始めるなら true, move(ev), up(ev) }
// ev = { x, y(ドキュメント座標), sx, sy(画面座標), p(筆圧 0〜1), type('mouse' | 'pen' | 'touch'), shift, alt, ctrl, t(ms) }
import { state, on, emit, requestRender, currentBrush } from './state.js';
import { createCanvas, composite, flatten } from './doc.js';
import { Stroke, grainPattern, clampRect, hexRgb } from './brush.js';
import { fillRegion, expandRegion } from './fill.js';
import { protectMask } from './protect.js';
import { selectTool } from './select.js';
import { moveTool } from './transform.js';
import { shapeTool, gradientTool, smudgeTool, textTool, cropTool } from './tools2.js';
import { say } from './messages.js';

export function crop(canvas, r) {
  const c = createCanvas(r.w, r.h);
  c.getContext('2d').drawImage(canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return c;
}

// レイヤーの一部を描き換えた履歴(前と後の絵を、その範囲だけ持つ)
export function pixelEntry(label, layer, rect, before, after) {
  const put = (img) => {
    layer.ctx.globalAlpha = 1;
    layer.ctx.globalCompositeOperation = 'source-over';
    layer.ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    layer.ctx.drawImage(img, rect.x, rect.y);
  };
  return { label, layer, undo: () => put(before), redo: () => put(after) };
}

// マスクモードの間に塗る色(描いた所が、選択範囲になる。画面には、半透明の赤で出る)
export const MASK_COLOR = '#ff2040';
export const paintColor = () => (state.maskMode ? MASK_COLOR : state.fg);

// 描く先のレイヤー(描けないときは、メッセージを出して null)。マスクモードの間は、マスクの絵
export function paintable() {
  if (state.maskMode) return state.maskMode.layer;
  const layer = state.doc.active;
  if (!layer) return null;
  if (layer.locked) { say('layerLocked'); return null; }
  if (layer.isGroup) { say('paintGroup'); return null; }
  if (!layer.visible) { say('paintHidden'); return null; }
  return layer;
}

// ---- ブラシ・消しゴム ----

let S = null; // 描いている最中の線

// 模様ペン(state.tool === 'pattern'。設定は state.pattern): 線の色にする絵を、見えている絵(下の色)から作る。線の形に、この絵を入れる(refresh)
//   mode 'shade' = 下の色を、shade(%)だけ暗く(−)・明るく(+)した色
//   mode 'lum'   = 描画色の色み(色相・彩度)のまま、明るさだけを下の色に合わせた色
//   onlyPainted  = 何も描いていない所(用紙を除いて、透明な所)には描かない
// 1本の線の間は、描き始めの絵を使う(線はレイヤーに写す前なので、レイヤーの絵は描き始めのまま。自分の線の上を通っても、さらに暗くはならない)。
// **キャンバス全体を一度に作らない**(0.14.1。iPad で、描き始めのたびに待ちが出て重かった)。線が通った所の升目(TILE px)だけを、通ったときに作る。
// 短い線をたくさん描いても、1本ごとの仕事は升目 1〜4 個ぶん。読み戻し(getImageData)もしない
const TILE = 256;
let patternCanvas = null;
function patternStart(doc, color) {
  if (!patternCanvas || patternCanvas.width !== doc.w || patternCanvas.height !== doc.h) patternCanvas = createCanvas(doc.w, doc.h);
  return { canvas: patternCanvas, color, done: new Set(), cols: Math.ceil(doc.w / TILE) };
}

// 範囲 r にかかる升目のうち、まだ作っていないものを作る
function patternFill(doc, t, r) {
  const c0 = Math.floor(r.x / TILE), c1 = Math.floor((r.x + r.w - 1) / TILE), r0 = Math.floor(r.y / TILE), r1 = Math.floor((r.y + r.h - 1) / TILE);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      if (t.done.has(cy * t.cols + cx)) continue;
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
    }
  }
  if (x1 < 0) return;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) t.done.add(cy * t.cols + cx);
  const u = { x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE };
  const b = state.pattern, x = t.canvas.getContext('2d');
  const clipTo = (g) => { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.beginPath(); g.rect(u.x, u.y, u.w, u.h); g.clip(); };
  clipTo(x);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.fillStyle = '#ffffff'; // 何もない所は、白い紙として数える
  x.fillRect(u.x, u.y, u.w, u.h);
  composite(x, doc);
  if (b.mode === 'lum') {
    x.globalCompositeOperation = 'color';
    x.fillStyle = t.color;
  } else {
    const k = b.shade ?? -15;
    x.globalAlpha = Math.min(1, Math.abs(k) / 100);
    x.fillStyle = k < 0 ? '#000000' : '#ffffff';
  }
  x.fillRect(u.x, u.y, u.w, u.h);
  x.globalAlpha = 1;
  if (b.onlyPainted) {
    // 絵のある所だけを残す(用紙を除いた絵を、線を抜く型の絵に作って、その形で切り抜く。型の絵は、refresh が使う範囲を毎回作り直すので、残っていてよい)
    const m = doc.maskCanvas.getContext('2d');
    clipTo(m);
    m.clearRect(u.x, u.y, u.w, u.h);
    composite(m, doc, null, true);
    m.restore();
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(doc.maskCanvas, u.x, u.y, u.w, u.h, u.x, u.y, u.w, u.h);
  }
  x.restore();
}

function refresh() {
  const doc = state.doc, b = S.brush;
  const r = clampRect(S.stroke.takeFresh(), doc.w, doc.h);
  if (!r) return;
  let src = doc.strokeCanvas;
  const sel = state.selection;
  if (S.tint) patternFill(doc, S.tint, r); // 模様ペン: この範囲の「下の色」が、まだなければ作る
  if (b.grain > 0 || S.protect || sel || S.clone || S.tint) {
    const m = doc.maskCanvas.getContext('2d');
    // 描き直す範囲だけに切り抜いておく。「抜く」「形に入れる」合成(destination-in・source-in)は、切り抜かないと、絵の外まで全部を作り直すので、
    // ポインターが動くたびにキャンバス全体の仕事になる(iPad で重かった。0.14.1)
    m.save();
    m.beginPath();
    m.rect(r.x, r.y, r.w, r.h);
    m.clip();
    m.globalCompositeOperation = 'source-over';
    m.clearRect(r.x, r.y, r.w, r.h);
    m.drawImage(src, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    if (b.grain > 0) {
      // 紙のざらつき: ストロークを模様で抜く
      m.globalCompositeOperation = 'destination-in';
      m.fillStyle = S.pattern;
      m.fillRect(r.x, r.y, r.w, r.h);
    }
    if (S.protect) {
      // 線との隙間: 塗れない所を抜く(小さい絵を引きのばして使う。どの範囲を描き直しても同じ位置になるよう、全体を描く)
      m.globalCompositeOperation = 'destination-out';
      m.imageSmoothingEnabled = true;
      m.drawImage(S.protect, 0, 0, doc.w, doc.h);
    }
    if (sel) {
      // 選択範囲: その中だけに描く
      m.globalCompositeOperation = 'destination-in';
      m.drawImage(sel.mask, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    }
    if (S.clone) {
      // スタンプ: 線の形に、コピー元の絵(ずらした所)を入れる
      m.globalCompositeOperation = 'source-in';
      m.drawImage(S.clone.img, S.clone.dx, S.clone.dy);
    }
    if (S.tint) {
      // 模様ペン: 線の形に、下の色から作った絵を入れる
      m.globalCompositeOperation = 'source-in';
      m.drawImage(S.tint.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    }
    m.restore();
    src = doc.maskCanvas;
  }
  // 表示(view.js の renderFast)に、描き直す範囲を知らせる(この範囲だけ、画面を描き直す)
  const st = state.stroke;
  if (st) {
    st.partial = true;
    st.rect = st.rect ? { x: Math.min(st.rect.x, r.x), y: Math.min(st.rect.y, r.y), w: Math.max(st.rect.x + st.rect.w, r.x + r.w) - Math.min(st.rect.x, r.x), h: Math.max(st.rect.y + st.rect.h, r.y + r.h) - Math.min(st.rect.y, r.y) } : { ...r };
  }
  // レイヤー + 今の線(ブラシの不透明度で)。表示はこの絵を使い、離したときにレイヤーへ写す
  const w = doc.workCanvas.getContext('2d');
  w.globalAlpha = 1;
  w.globalCompositeOperation = 'source-over';
  w.clearRect(r.x, r.y, r.w, r.h);
  w.drawImage(S.layer.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  w.globalAlpha = b.opacity;
  w.globalCompositeOperation = b.erase ? 'destination-out' : S.layer.lockAlpha ? 'source-atop' : 'source-over';
  w.drawImage(src, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  w.globalAlpha = 1;
  w.globalCompositeOperation = 'source-over';
}

// マウスと指には筆圧がないので、速さから作る(ゆっくり = 太い、速い = 細い。描き始めは細く入る)
function pressure(ev) {
  if (ev.type === 'pen') {
    if (ev.p > 0) { S.penP = ev.p; return ev.p; }
    // 筆圧が 0 で届いた点(Apple Pencil は、描き始めの1点目や、線の途中で、0 を送ってくることがある)。
    // 前は、いつも半分の筆圧にしていたので、そこだけ急に太くなって、丸い点が押されていた(0.15.0)。
    // 筆圧が来たことがあれば、前の筆圧のまま。まだなら、細く入る(筆圧のないペンでも描けるよう、少しずつ半分まで上げる)
    if (S.penP) return S.penP;
    S.zeroP = Math.min(0.5, (S.zeroP ?? 0.02) + 0.04);
    return S.zeroP;
  }
  if (!S.brush.pSize && !S.brush.pFlow) return 1;
  const dt = Math.max(1, ev.t - S.t);
  const speed = Math.hypot(ev.sx - S.px, ev.sy - S.py) / dt; // px / ms
  const target = Math.min(1, Math.max(0.3, 1.08 - speed * 0.2));
  S.sim += (target - S.sim) * 0.2;
  S.t = ev.t;
  S.px = ev.sx;
  S.py = ev.sy;
  return S.sim;
}

const brushTool = {
  cursor: 'none',
  down(ev) {
    const doc = state.doc, layer = paintable(), b = currentBrush();
    if (!layer || !b) return false;
    // スタンプ: Alt を押しながら(か、コピー元がまだないとき)押した所が、コピー元。次に押した所とのずれを保って、絵を写す
    let clone = null;
    if (state.tool === 'stamp') {
      if (ev.alt || !state.cloneSrc) {
        state.cloneSrc = { x: ev.x, y: ev.y };
        state.cloneOff = null;
        say('stampSrc');
        requestRender();
        return false;
      }
      state.cloneOff ||= { dx: ev.x - state.cloneSrc.x, dy: ev.y - state.cloneSrc.y };
      clone = { img: crop(layer.canvas, { x: 0, y: 0, w: doc.w, h: doc.h }), dx: state.cloneOff.dx, dy: state.cloneOff.dy };
    }
    // 描き始めの用意(0.21.1。大きいキャンバスでは、キャンバスぜんぶの仕事 1 回でも待ちになる。ザザザと続けて描くと、線ごとに待っていた):
    //   ・線の絵(strokeCanvas)は、前の線の所だけ消してある(doc.strokeClean)。ほかのツールが使ったあとは、ぜんぶ消す
    //   ・型の絵(maskCanvas)は、refresh が使う所を毎回消してから使うので、消さない
    //   ・表示用の絵(workCanvas)は、前の線を写し終えたとき、レイヤーと同じになっている(doc.workOf)。ほかの操作でレイヤーの絵が変わったら、写し直す
    const sc0 = doc.strokeCanvas.getContext('2d');
    sc0.setTransform(1, 0, 0, 1, 0, 0);
    sc0.globalAlpha = 1;
    sc0.globalCompositeOperation = 'source-over';
    if (!doc.strokeClean) sc0.clearRect(0, 0, doc.w, doc.h);
    doc.strokeClean = false;
    const w = doc.workCanvas.getContext('2d');
    w.setTransform(1, 0, 0, 1, 0, 0);
    if (doc.workOf !== layer || doc.workCanvasOf !== layer.canvas) {
      w.globalAlpha = 1;
      w.globalCompositeOperation = 'copy';
      w.drawImage(layer.canvas, 0, 0);
      w.globalCompositeOperation = 'source-over';
    }
    doc.workOf = null; // 描いている間は、レイヤーと同じではない
    const sc = doc.strokeCanvas.getContext('2d');
    // 対称: キャンバスのまん中を軸に、映した所にも描く
    const sym = state.symmetry === 'off' ? null : { cx: doc.w / 2, cy: doc.h / 2, list: { x: [[true, false]], y: [[false, true]], xy: [[true, false], [false, true], [true, true]] }[state.symmetry] };
    S = { layer, brush: b, stroke: new Stroke(sc, b, paintColor(), sym), sim: 0.35, t: ev.t, px: ev.sx, py: ev.sy };
    // 手ぶれ補正の強さ(設定。全部のブラシに掛ける倍率)
    if (b.smooth > 0) {
      const k = b.smooth * (state.smoothGain ?? 1);
      S.stroke.follow = 1 / (1 + k * 0.55);
      // 速く動かしたときは、線がペンから離れすぎないように(画面で 6 + 補正の強さ × 1.5 px まで。0.21.0。「ザザザと速く描くと遅れる」)
      S.stroke.maxLag = (6 + k * 1.5) / (state.view?.zoom || 1);
    }
    if (clone) S.clone = clone;
    else if (state.tool === 'pattern' && !state.maskMode) S.tint = patternStart(doc, state.fg);
    if (b.grain > 0) S.pattern = grainPattern(doc.maskCanvas.getContext('2d'), b.grain);
    if (!b.erase && !clone && !state.maskMode && state.lineGap > 0) S.protect = protectMask(doc, state.lineGap, state.fg, state.lineGapSame);
    state.stroke = { layer, canvas: doc.workCanvas };
    const last = state.lastPoint;
    if (ev.shift && last) {
      // Shift+クリック: 前の線の終わりから、まっすぐ線を引く
      S.sim = 1;
      S.stroke.follow = 1;
      S.stroke.begin(last.x, last.y, 1);
      S.stroke.add(ev.x, ev.y, 1);
    } else {
      S.stroke.begin(ev.x, ev.y, pressure(ev), ev.st);
    }
    refresh();
    requestRender();
    return true;
  },
  move(ev) {
    if (!S) return;
    S.stroke.add(ev.x, ev.y, pressure(ev), ev.st);
    // 表示用の絵(レイヤー + 線)を作り直すのは、まとめて届いた点(Apple Pencil は 1 画面に 4 つほど)を全部足してから、1回だけ(0.21.0)。
    // 前は、点ごとに作り直していた。離したとき(up)は、その場で作り直すので、ここで残った分も入る
    if (!S.queued) {
      S.queued = true;
      const s = S;
      queueMicrotask(() => { if (S === s && s.queued) { s.queued = false; refresh(); } });
    }
    requestRender();
  },
  // 描きかけの線を捨てる(キャンバスの長押しで、スポイトに切り替わったとき)
  cancel() {
    const doc = state.doc;
    if (doc) { doc.workOf = null; doc.strokeClean = false; }
    state.stroke = null;
    S = null;
    requestRender();
  },
  up(ev) {
    if (!S) return;
    const doc = state.doc, { layer, stroke, brush } = S;
    stroke.end();
    S.queued = false;
    refresh();
    const r = clampRect(stroke.dirty, doc.w, doc.h);
    if (r) {
      const before = crop(layer.canvas, r);
      layer.ctx.globalAlpha = 1;
      layer.ctx.globalCompositeOperation = 'source-over';
      layer.ctx.clearRect(r.x, r.y, r.w, r.h);
      layer.ctx.drawImage(doc.workCanvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      state.history.push(pixelEntry(S.clone ? 'スタンプ' : S.tint ? '模様ペン' : brush.erase ? '消しゴム' : brush.name, layer, r, before, crop(layer.canvas, r)));
      // 次の線のために: 線の絵は、この線の所だけ消す。表示用の絵は、もうレイヤーと同じ(ここで写したので)
      doc.strokeCanvas.getContext('2d').clearRect(r.x, r.y, r.w, r.h);
    }
    doc.strokeClean = true;
    doc.workOf = layer;
    doc.workCanvasOf = layer.canvas;
    state.lastPoint = { x: ev.x, y: ev.y };
    const plain = !brush.erase && !S.clone && !state.maskMode && !(S.tint && state.pattern.mode === 'shade'); // 下の色を暗くする模様ペンは、描画色を使わない
    state.stroke = null;
    S = null;
    if (plain) emit('stroke'); // 「最近使った色」に入れる
    requestRender();
  },
};

// ---- スポイト(見えている色を拾う) ----

let dropper = null;
let pickFlat = null, pickReady = false; // スポイトで押している間だけ使う、1枚にまとめた絵
export function pickColor(x, y) {
  const doc = state.doc;
  const px = Math.floor(x), py = Math.floor(y);
  if (px < 0 || py < 0 || px >= doc.w || py >= doc.h) return;
  dropper ||= createCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  dropper.setTransform(1, 0, 0, 1, -px, -py);
  dropper.clearRect(px, py, 1, 1);
  // 押している間は、はじめに1枚にまとめた絵から拾う(動かすたびに、全部のレイヤーを重ね直すと重い。0.16.0)
  if (pickReady) dropper.drawImage(pickFlat, 0, 0); else composite(dropper, doc);
  const d = dropper.getImageData(0, 0, 1, 1).data;
  if (d[3] === 0) return;
  // 半透明の所は、白い紙の上に置いたときの色
  const a = d[3] / 255, mix = (c) => Math.round(c * a + 255 * (1 - a));
  state.fg = '#' + [mix(d[0]), mix(d[1]), mix(d[2])].map((v) => v.toString(16).padStart(2, '0')).join('');
  emit('color');
}

const eyedropperTool = {
  cursor: 'url("icons/cursor-eyedropper.png") 4 28, crosshair', // ポインターがスポイトの形になる(先が、拾う所)
  down(ev) {
    const doc = state.doc;
    if (!pickFlat || pickFlat.width !== doc.w || pickFlat.height !== doc.h) pickFlat = createCanvas(doc.w, doc.h);
    const x = pickFlat.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, doc.w, doc.h);
    composite(x, doc);
    pickReady = true;
    pickColor(ev.x, ev.y);
    return true;
  },
  move(ev) { pickColor(ev.x, ev.y); },
  up() { pickReady = false; },
};

// ---- 塗りつぶし(バケツ。見えている絵か今のレイヤーを境目にして、今のレイヤーに塗る。範囲の求め方は fill.js) ----

const fillTool = {
  cursor: 'crosshair',
  down(ev) {
    const doc = state.doc, layer = paintable();
    if (!layer) return false;
    const { w, h } = doc;
    const sx = Math.floor(ev.x), sy = Math.floor(ev.y);
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return false;
    // 境目にする絵: 見えている絵ぜんぶ(キャンバスを参照)か、今のレイヤーだけ(現在のレイヤーを参照)
    const ref = (state.fillRef === 'layer' ? layer.ctx : flatten(doc).getContext('2d')).getImageData(0, 0, w, h).data;
    const region = fillRegion(ref, w, h, sx, sy, state.fillTolerance, state.fillGap);
    if (!region) return false;
    // 線の下にもぐらせる(設定の「線へのはみ出し」の分だけ広げる)
    const r = expandRegion(region, w, h, state.fillExpand);
    const img = new ImageData(r.w, r.h);
    const c = hexRgb(paintColor());
    for (let i = 0; i < r.on.length; i++) {
      if (!r.on[i]) continue;
      const o = i * 4;
      img.data[o] = c.r; img.data[o + 1] = c.g; img.data[o + 2] = c.b; img.data[o + 3] = 255;
    }
    const tmp = createCanvas(r.w, r.h);
    const tx = tmp.getContext('2d');
    tx.putImageData(img, 0, 0);
    if (state.selection) {
      // 選択範囲: その中だけに塗る
      tx.globalCompositeOperation = 'destination-in';
      tx.drawImage(state.selection.mask, -r.x, -r.y);
    }
    const before = crop(layer.canvas, r);
    layer.ctx.globalAlpha = 1;
    layer.ctx.globalCompositeOperation = layer.lockAlpha ? 'source-atop' : 'source-over';
    layer.ctx.drawImage(tmp, r.x, r.y);
    layer.ctx.globalCompositeOperation = 'source-over';
    state.history.push(pixelEntry('塗りつぶし', layer, r, before, crop(layer.canvas, r)));
    if (!state.maskMode) emit('stroke'); // 色の履歴に入れる
    requestRender();
    return false;
  },
  move() {},
  up() {},
};

// ---- 手のひら・ズーム(中身は app.js。ここはカーソルだけ) ----

const handTool = { cursor: 'grab', down: () => false, move() {}, up() {} };
const zoomTool = {
  cursor: 'zoom-in',
  down(ev) { state.view.zoomStep(ev.alt ? -1 : 1, ev.sx, ev.sy); return false; },
  move() {},
  up() {},
};

// 履歴が動いた(どこかの絵が変わった)ら、表示用の絵は、次の描き始めに写し直す。
// ブラシ自身の push は、この印を付ける前に呼ばれるので、印は消されない(up の中で、push のあとに付ける)
on('history', () => { if (state.doc) state.doc.workOf = null; });
on('doc', () => { if (state.doc) { state.doc.workOf = null; state.doc.strokeClean = false; } });

export const tools = {
  brush: brushTool, eraser: brushTool, stamp: brushTool, pattern: brushTool, fill: fillTool, eyedropper: eyedropperTool, move: moveTool, select: selectTool, hand: handTool, zoom: zoomTool,
  shape: shapeTool, gradient: gradientTool, smudge: smudgeTool, text: textTool, crop: cropTool,
};
export { brushTool };

// [id, 名前, ショートカット, アイコン(24×24 の SVG の中身)]
export const TOOL_LIST = [
  ['brush', 'ブラシ', 'B', '<path d="M4 20c0-3 2-4 4-4s3 1 3 3-3 3-7 1z" fill="currentColor" stroke="none"/><path d="M10.5 15.5 19 5a1.6 1.6 0 0 1 2.4 2.1L12.8 17.3"/>'],
  ['eraser', '消しゴム', 'E', '<path d="M4 15.5 13.5 6l6 6-8 8H8z"/><path d="M9.5 10l6 6M8 20h12"/>'],
  ['fill', '塗りつぶし', 'G', '<path d="M5 12.5 12 5.5l7 7-6 6a2 2 0 0 1-2.8 0L5 13.3z"/><path d="M9 3l3 3M5 12.8h13.5"/><path d="M20 16.5c1 1.6 1.4 2.3 1.4 3a1.4 1.4 0 0 1-2.8 0c0-.7.4-1.4 1.4-3z" fill="currentColor" stroke="none"/>'],
  ['eyedropper', 'スポイト', 'I', '<path d="M4 20l1-4 9-9 3 3-9 9z"/><path d="M13 6l2-2a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3l-2 2z" fill="currentColor"/>'],
  ['move', 'レイヤー移動', 'V', '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'],
  ['hand', '手のひら', 'H', '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V12M17 12V9a1.5 1.5 0 0 1 3 0v5.5c0 4-2.5 6.5-6.5 6.5-3 0-4.6-1.2-6-3.5L5 13.6a1.5 1.5 0 0 1 2.4-1.8L8 12.6"/>'],
  ['zoom', 'ズーム', 'Z', '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M7.5 10.5h6M10.5 7.5v6"/>'],
];
