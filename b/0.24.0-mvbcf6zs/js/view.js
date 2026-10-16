// キャンバス表示: 拡大・縮小、移動、回転、左右反転、レイヤーの合成、ブラシの丸、選択範囲の枠、移動ツールの枠
// 座標: ドキュメント(px)→ 画面(CSS px)は  screen = o + R(rot) · F · (doc × zoom)。F は左右反転(flip のとき x を逆に)
import { state, on, emit, currentBrush } from './state.js';
import { composite, compositeNodes, createCanvas } from './doc.js';
import { transformBox } from './transform.js';

const ZOOM_LEVELS = [0.05, 0.1, 0.167, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const MIN_ZOOM = 0.03, MAX_ZOOM = 32;
export const RULER = 20; // 定規の太さ(画面の px)

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.zoom = 1;
    this.rot = 0; // 画面の回転(ラジアン。時計回りが +)
    this.flip = false; // 左右反転して見せる(表示だけ。絵そのものは変えない)
    this.ox = 0; // ドキュメントの左上が来る画面の位置
    this.oy = 0;
    this.w = 1;
    this.h = 1;
    this.dpr = 1;
    this.pending = false;
    this.dash = 0;
    this.checker = this.makeChecker();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  makeChecker() {
    const c = createCanvas(16, 16);
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 16, 16);
    x.fillStyle = '#d9d9de';
    x.fillRect(0, 0, 8, 8);
    x.fillRect(8, 8, 8, 8);
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    const first = this.w <= 1;
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    if (first && state.doc) this.fit();
    this.render();
  }

  // 全体を表示(回転も元に戻す)
  fit() {
    const doc = state.doc;
    if (!doc) return;
    const pad = 32, left = 0;
    const z = Math.min((this.w - pad * 2 - left) / doc.w, (this.h - pad * 2) / doc.h);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    this.rot = 0;
    const f = this.flip ? -1 : 1;
    this.ox = Math.round(left + (this.w - left - f * doc.w * this.zoom) / 2);
    this.oy = Math.round((this.h - doc.h * this.zoom) / 2);
    emit('zoom');
    this.requestRender();
  }

  docToScreen(x, y) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot), z = this.zoom;
    if (this.flip) x = -x;
    return { x: this.ox + (x * c - y * s) * z, y: this.oy + (x * s + y * c) * z };
  }

  screenToDoc(sx, sy) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot), z = this.zoom;
    const dx = sx - this.ox, dy = sy - this.oy;
    const x = (dx * c + dy * s) / z;
    return { x: this.flip ? -x : x, y: (-dx * s + dy * c) / z };
  }

  // 左右反転して見せる / 元に戻す(画面の真ん中の縦の線で、鏡に映した形にする)
  setFlip(on) {
    if (on === this.flip) return;
    this.flip = on;
    this.rot = -this.rot;
    this.ox = this.w - this.ox;
    emit('zoom');
    this.requestRender();
  }

  // 拡大率と回転を変える。ドキュメントの点 (wx, wy) が、画面の (sx, sy) に来るようにする
  place(zoom, rot, wx, wy, sx, sy) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.rot = rot;
    const c = Math.cos(rot), s = Math.sin(rot), z = this.zoom;
    if (this.flip) wx = -wx;
    this.ox = sx - (wx * c - wy * s) * z;
    this.oy = sy - (wx * s + wy * c) * z;
    emit('zoom');
    this.requestRender();
  }

  setZoom(z, sx = this.w / 2, sy = this.h / 2) {
    const w = this.screenToDoc(sx, sy);
    this.place(z, this.rot, w.x, w.y, sx, sy);
  }

  setRotation(rot, sx = this.w / 2, sy = this.h / 2) {
    const w = this.screenToDoc(sx, sy);
    this.place(this.zoom, rot, w.x, w.y, sx, sy);
  }

  zoomStep(dir, sx, sy) {
    const z = this.zoom;
    const next = dir > 0
      ? ZOOM_LEVELS.find((l) => l > z * 1.001) ?? MAX_ZOOM
      : [...ZOOM_LEVELS].reverse().find((l) => l < z * 0.999) ?? MIN_ZOOM;
    this.setZoom(next, sx, sy);
  }

  pan(ox, oy) {
    this.ox = ox;
    this.oy = oy;
    this.requestRender();
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render();
    });
  }

  // ドキュメントの座標で描けるようにする
  setWorld(ctx) {
    const k = this.zoom * this.dpr, c = Math.cos(this.rot), s = Math.sin(this.rot), f = this.flip ? -1 : 1;
    ctx.setTransform(f * k * c, f * k * s, -k * s, k * c, this.ox * this.dpr, this.oy * this.dpr);
  }

  render() {
    const { ctx } = this;
    const doc = state.doc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (!doc) { this.paintBack(ctx); return; }
    this.noteBusy();
    // 描いている間と、作っておいた絵が使える間は、速い描き方(renderFast)。clipped = 描いた所だけを描き直している(あとで restore する)
    let clipped = false;
    const plan = !state.maskMode ? this.strokePlan(doc) : null;
    if (plan && (state.stroke || this.scValid(doc, plan))) clipped = this.renderFast(doc, plan);
    else {
      this.paintBack(ctx);
      this.paintNodes(ctx, doc, doc.layers, state.stroke);
      // マスクモード: マスクに描いた所(選択範囲になる所)を、半透明の赤で重ねる
      const mm = state.maskMode;
      if (mm) {
        this.setWorld(ctx);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, doc.w, doc.h);
        ctx.clip();
        ctx.globalAlpha = 0.5;
        ctx.drawImage(state.stroke?.layer === mm.layer ? state.stroke.canvas : mm.layer.canvas, 0, 0);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      if (plan && !this.panning) this.prepareSoon(); // 動かし終わったら、次に描き始めるときのための絵を、先に作っておく
    }
    this.drawGuides();
    this.drawSelection();
    this.drawTransform();
    this.drawRulers();
    this.drawCursor();
    if (clipped) ctx.restore();
    this.calmLater();
  }

  // ---- 縮めて見せるときの、なめらかさ(0.21.1) ----
  // 50% より小さく見せるときは、なめらかな縮小(high)を使うが、大きいキャンバスでは、1回ごとにとても重い(A4 で、1コマの半分ほど)。
  // 描いている間・描き終わってすぐ・画面を動かしている間は、軽い縮小(low)にして、止まって 0.35 秒たったら、なめらかに描き直す
  noteBusy() {
    const sig = [this.zoom, this.ox, this.oy, this.rot, this.flip].join();
    if (state.stroke || sig !== this.lastSig) this.lowUntil = performance.now() + 350;
    this.lastSig = sig;
  }

  busy() { return performance.now() < (this.lowUntil || 0); }

  // 止まったら、なめらかに描き直す
  calmLater() {
    if (!this.busy() || this.calmTimer) return;
    this.calmTimer = setTimeout(() => { this.calmTimer = 0; this.requestRender(); }, this.lowUntil - performance.now() + 20);
  }

  // ふだんの縮小のなめらかさ
  quality() { return this.zoom < 0.5 && !this.busy() ? 'high' : 'low'; }

  // キャンバスのまわりの色と、紙(影つきの白と、市松模様)
  paintBack(ctx) {
    const { canvas, dpr } = this, doc = state.doc;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = state.canvasBg || '#2a2b2f'; // キャンバスのまわりの色(画面の色合いで変わる。ui.js の applyLook)
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!doc) return;
    this.setWorld(ctx);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14 * dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, doc.w, doc.h);
    ctx.restore();
    // 市松模様(マスの大きさは、拡大しても画面で同じ)
    const k = 1 / (this.zoom * dpr) * dpr;
    this.checker.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    ctx.fillStyle = this.checker;
    ctx.fillRect(0, 0, doc.w, doc.h);
  }

  // レイヤーの並び list を、画面に重ねる(キャンバスの外にはみ出さないように切り抜く)。
  // 大きく拡大したときは、ドットをぼかさない(回転中はぼかす)。quality で、縮めるときのなめらかさを決められる
  paintNodes(ctx, doc, list, sub, quality = null, area = null) {
    this.setWorld(ctx);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, doc.w, doc.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = this.zoom < 3 || this.rot !== 0;
    ctx.imageSmoothingQuality = quality || this.quality();
    compositeNodes(ctx, doc, list, sub, area);
    ctx.restore();
  }

  // ---- 描いている間の表示(0.21.0・0.21.1。大きいキャンバスで、描くのが遅かった) ----
  // 前は、ポインターが動くたびに、全部のレイヤーを元の大きさのまま重ね直していた(A4 350dpi = 1200 万画素 × レイヤーの数。クリップのかたまりは、さらに作業用の絵に何度も写す)。
  // 描いている間に変わるのは、今のレイヤーのかたまり(一番外の並びで、今のレイヤーを含むもの + そのクリップの土台から終わりまで)だけなので、
  // その下の全部と、その上の全部を、画面の大きさの絵に作っておき(this.sc)、毎回は「下の絵 + かたまり + 上の絵」だけを描く。
  // 上の絵を作っておけるのは、上の土台がどれも「通常」のときだけ(乗算などは、下の絵によって色が変わるので、毎回重ねる)。
  // 0.21.1: ・描いている間は、描いた所(と、ブラシの丸の前と今の所)だけを描き直す(画面の残りは、前のまま)
  //         ・作っておいた絵は、描き終わっても捨てない(描き終わるたびに全部を重ね直していたので、ザザザと続けて描くと、そのたびに待ちが出ていた)。
  //           ほかのレイヤーの絵・並び・表示の位置が変わったら、捨てる。動かし終わって 0.3 秒たったら、先に作っておく(描き始めに待たないように)
  strokePlan(doc) {
    const L = doc.layers, target = state.stroke?.layer || doc.active;
    if (!target) return null;
    const has = (n) => n === target || (n.isGroup && n.children.some(has));
    const i = L.findIndex(has);
    if (i < 0) return null;
    let base = i, end = i;
    while (base > 0 && L[base].clip) base--;
    while (end + 1 < L.length && L[end + 1].clip) end++;
    return { base, end };
  }

  scKey(doc, plan) {
    const c = this.canvas;
    return [doc.layers.length, plan.base, plan.end, this.zoom, this.ox, this.oy, this.rot, this.flip, this.dpr, c.width, c.height, state.canvasBg].join();
  }

  scValid(doc, plan) { return !!this.sc && this.sc.doc === doc && this.sc.key === this.scKey(doc, plan); }

  // 作っておいた絵を、捨てるとき: 絵が変わった・並びや見え方が変わった。
  // history の項目が、今のかたまりのレイヤーの絵だけを変えたなら、そのまま使える(かたまりは、毎回重ねるので)
  watchScene() {
    if (this.watching) return;
    this.watching = true;
    const drop = () => { this.sc = null; };
    on('doc', drop);
    on('layers', drop);
    on('history', (kind, entry) => {
      const sc = this.sc;
      if (!sc) return;
      if (!entry || entry.structure || !entry.layer || !sc.unit.has(entry.layer)) this.sc = null;
    });
  }

  prepareSoon() {
    clearTimeout(this.prepTimer);
    this.prepTimer = setTimeout(() => {
      const doc = state.doc;
      if (!doc || state.stroke || state.maskMode || this.panning) return;
      const plan = this.strokePlan(doc);
      if (plan && !this.scValid(doc, plan)) { this.buildSc(doc, plan); this.requestRender(); }
    }, 300);
  }

  buildSc(doc, plan) {
    this.watchScene();
    const { canvas } = this, L = doc.layers;
    const old = this.sc;
    const reuse = (c) => (c && c.width === canvas.width && c.height === canvas.height ? c : null);
    const below = reuse(old?.below) || createCanvas(canvas.width, canvas.height);
    this.paintBack(below.getContext('2d'));
    const hq = this.zoom < 0.5 ? 'high' : 'low';
    this.paintNodes(below.getContext('2d'), doc, L.slice(0, plan.base), null, hq);
    const unitList = L.slice(plan.base, plan.end + 1), aboveList = L.slice(plan.end + 1);
    const plain = aboveList.every((n) => n.clip || !n.visible || n.blend === 'normal');
    let above = null;
    if (plain && aboveList.some((n) => n.visible)) {
      above = reuse(old?.above) || createCanvas(canvas.width, canvas.height);
      const a = above.getContext('2d');
      a.setTransform(1, 0, 0, 1, 0, 0);
      a.globalAlpha = 1;
      a.globalCompositeOperation = 'source-over';
      a.clearRect(0, 0, canvas.width, canvas.height);
      this.paintNodes(a, doc, aboveList, null, hq);
    }
    const unit = new Set();
    const add = (n) => { unit.add(n); if (n.isGroup) n.children.forEach(add); };
    unitList.forEach(add);
    this.sc = { key: this.scKey(doc, plan), doc, below, above, unitList, aboveList, plain, unit, shown: false, cursor: null };
  }

  // ブラシの丸の、画面の四角(画面の実際の px)。出していなければ null
  cursorBox() {
    const c = state.cursor;
    if (!c || this.panning) return null;
    const b = currentBrush();
    const r = (state.picking ? 42 : Math.max(10, (b ? (b.size / 2) * this.zoom : 0) + 2)) + 3;
    return { x0: (c.x - r) * this.dpr, y0: (c.y - r) * this.dpr, x1: (c.x + r) * this.dpr, y1: (c.y + r) * this.dpr };
  }

  // 画面の四角(実際の px)を、ドキュメントの四角に(回転していても、全部が入る大きさ)
  screenRectToDoc(r) {
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => this.screenToDoc(x / this.dpr, y / this.dpr));
    const x = Math.floor(Math.min(...pts.map((p) => p.x))) - 2, y = Math.floor(Math.min(...pts.map((p) => p.y))) - 2;
    return { x, y, w: Math.ceil(Math.max(...pts.map((p) => p.x))) + 2 - x, h: Math.ceil(Math.max(...pts.map((p) => p.y))) + 2 - y };
  }

  // ドキュメントの四角を、画面の四角(実際の px)に
  docRectToScreen(r) {
    const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => this.docToScreen(x, y));
    const d = this.dpr;
    return { x0: Math.min(...pts.map((p) => p.x)) * d - 2, y0: Math.min(...pts.map((p) => p.y)) * d - 2, x1: Math.max(...pts.map((p) => p.x)) * d + 2, y1: Math.max(...pts.map((p) => p.y)) * d + 2 };
  }

  // 返り値: 描いた所だけに切り抜いて描いた(呼んだ側が、目印を描いたあとに restore する)
  renderFast(doc, plan) {
    const { ctx, canvas } = this;
    if (!this.scValid(doc, plan)) this.buildSc(doc, plan);
    const sc = this.sc, st = state.stroke;
    // 描いた所だけを描き直す: 前に、この絵で全体を描いてあって、線の描いた範囲が分かるとき(ブラシ)
    let region = null;
    const cur = this.cursorBox();
    // 線ごとに、はじめのコマは全体を描く(前の線の描き終わりが、まだ画面に出ていないことがある。すばやく続けて描いたとき)
    if (st && st.partial && sc.shown && sc.lastStroke === st) {
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      const grow = (q) => { if (!q) return; box.x0 = Math.min(box.x0, q.x0); box.y0 = Math.min(box.y0, q.y0); box.x1 = Math.max(box.x1, q.x1); box.y1 = Math.max(box.y1, q.y1); };
      if (st.rect) grow(this.docRectToScreen(st.rect));
      grow(sc.cursor);
      grow(cur);
      const x = Math.max(0, Math.floor(box.x0)), y = Math.max(0, Math.floor(box.y0));
      region = { x, y, w: Math.max(0, Math.min(canvas.width, Math.ceil(box.x1)) - x), h: Math.max(0, Math.min(canvas.height, Math.ceil(box.y1)) - y) };
    }
    if (st) st.rect = null;
    sc.cursor = cur;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let area = null;
    if (region) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(region.x, region.y, region.w, region.h);
      ctx.clip();
      if (!region.w || !region.h) return true; // 何も変わっていない
      area = this.screenRectToDoc(region); // かたまりの作業用の絵の仕事も、この範囲だけに
    }
    ctx.drawImage(sc.below, 0, 0);
    // 描いている間のかたまりは、縮めるときも速い方で(なめらかな縮小は、毎回、絵ぜんぶの縮小版を作り直すことがあるので重い。描き終わると、なめらかな方で描き直す)
    this.paintNodes(ctx, doc, sc.unitList, st, st ? 'low' : null, area); // 止まるまでは、quality() が low を返す
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (sc.above) ctx.drawImage(sc.above, 0, 0);
    else if (!sc.plain) this.paintNodes(ctx, doc, sc.aboveList, null, null, area);
    if (!region) sc.shown = true;
    sc.lastStroke = st;
    return !!region;
  }

  // 移動ツールの枠: 絵のまわりの四角、大きさを変えるハンドル(8つ)、回すハンドル(上の丸と下の四角)
  drawTransform() {
    const box = transformBox();
    if (!box) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const line = (pts, close) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); if (close) ctx.closePath(); ctx.stroke(); };
    if (box.warp) {
      // 自由変形・メッシュ: 点の間を結ぶ線と、動かせる点
      for (const [color, width, dash] of [['rgba(0,0,0,.55)', 2.4, []], ['#fff', 1.2, [5, 4]]]) {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
        for (const l of box.lines) line(l);
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2f6fd8'; ctx.lineWidth = 2.5;
      for (const p of box.points) { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
      return;
    }
    for (const [color, width, dash] of [['rgba(0,0,0,.55)', 2.4, []], ['#fff', 1.2, [5, 4]]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      line(box.poly, true);
    }
    ctx.setLineDash([]);
    for (const r of box.rots) {
      const color = r.side < 0 ? '#3ecf5a' : '#f5b921';
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      line([r.from, r]);
      ctx.fillStyle = color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (r.side < 0) ctx.arc(r.x, r.y, 7, 0, Math.PI * 2); else ctx.rect(r.x - 6.5, r.y - 6.5, 13, 13);
      ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2f6fd8'; ctx.lineWidth = 2.5;
    for (const h of box.scale) { ctx.beginPath(); ctx.arc(h.x, h.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }

  // 選択範囲の枠(白黒の点線)。作っている最中の形も
  drawSelection() {
    const sel = state.selection, draft = state.selectDraft;
    if (state.tool === 'move' && transformBox()) return; // 移動・変形の枠が出ている間は、点線を出さない(絵が見やすいように)
    const path = draft?.path || sel?.path;
    const ctx = this.ctx;
    if (!path) {
      // マスクモードで作った選択範囲: ふちの線の絵
      if (!sel?.edge) return;
      ctx.save();
      this.setWorld(ctx);
      ctx.imageSmoothingEnabled = this.zoom < 2;
      ctx.drawImage(sel.edge, 0, 0);
      ctx.restore();
      return;
    }
    ctx.save();
    this.setWorld(ctx);
    const px = 1 / this.zoom; // 画面の 1px
    ctx.lineWidth = 1.2 * px;
    ctx.strokeStyle = '#000';
    ctx.setLineDash([]);
    ctx.stroke(path);
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([5 * px, 5 * px]);
    ctx.stroke(path);
    ctx.restore();
  }

  // グリッド・ガイド・対称の軸・切り抜きの範囲・スタンプのコピー元(どれも、絵の上に重ねる目印。書き出しには入らない)
  drawGuides() {
    const doc = state.doc, ctx = this.ctx, px = 1 / this.zoom;
    ctx.save();
    this.setWorld(ctx);
    const lines = (color, width, dash, draw) => { ctx.strokeStyle = color; ctx.lineWidth = width * px; ctx.setLineDash(dash.map((d) => d * px)); ctx.beginPath(); draw(); ctx.stroke(); };
    const g = Math.max(2, state.gridSize);
    if (state.showGrid && g * this.zoom >= 4) {
      lines('rgba(40,150,255,.45)', 1, [], () => {
        for (let x = g; x < doc.w; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, doc.h); }
        for (let y = g; y < doc.h; y += g) { ctx.moveTo(0, y); ctx.lineTo(doc.w, y); }
      });
    }
    if (state.showGuides && doc.guides.length) {
      const far = 1e5;
      lines('#00d8ff', 1.2, [], () => {
        for (const gd of doc.guides) { if (gd.axis === 'x') { ctx.moveTo(gd.pos, -far); ctx.lineTo(gd.pos, far); } else { ctx.moveTo(-far, gd.pos); ctx.lineTo(far, gd.pos); } }
      });
    }
    if (state.symmetry !== 'off') {
      lines('#ff4fd8', 1.4, [8, 5], () => {
        if (state.symmetry !== 'y') { ctx.moveTo(doc.w / 2, 0); ctx.lineTo(doc.w / 2, doc.h); }
        if (state.symmetry !== 'x') { ctx.moveTo(0, doc.h / 2); ctx.lineTo(doc.w, doc.h / 2); }
      });
    }
    const c = state.tool === 'crop' ? state.crop : null;
    if (c) {
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath();
      ctx.rect(0, 0, doc.w, doc.h);
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.fill('evenodd');
      lines('#fff', 1.5, [], () => ctx.rect(c.x, c.y, c.w, c.h));
      lines('rgba(255,255,255,.5)', 1, [], () => {
        for (const t of [1 / 3, 2 / 3]) { ctx.moveTo(c.x + c.w * t, c.y); ctx.lineTo(c.x + c.w * t, c.y + c.h); ctx.moveTo(c.x, c.y + c.h * t); ctx.lineTo(c.x + c.w, c.y + c.h * t); }
      });
    }
    ctx.restore();
    // スタンプのコピー元(十字)。ずれが決まったあとは、ポインターについてくる
    const src = state.tool === 'stamp' ? state.cloneSrc : null;
    if (src) {
      let p = this.docToScreen(src.x, src.y);
      if (state.cloneOff && state.cursor) { const d = this.screenToDoc(state.cursor.x, state.cursor.y); p = this.docToScreen(d.x - state.cloneOff.dx, d.y - state.cloneOff.dy); }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      for (const [color, width] of [['rgba(0,0,0,.7)', 3], ['#fff', 1.2]]) {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(p.x - 9, p.y); ctx.lineTo(p.x + 9, p.y); ctx.moveTo(p.x, p.y - 9); ctx.lineTo(p.x, p.y + 9); ctx.stroke();
      }
    }
  }

  // 定規(上と左。px)。画面を回しているときは出さない
  drawRulers() {
    if (!state.showRulers || this.rot !== 0) return;
    const ctx = this.ctx, doc = state.doc;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.setLineDash([]);
    ctx.fillStyle = '#26282d';
    ctx.fillRect(0, 0, this.w, RULER);
    ctx.fillRect(0, 0, RULER, this.h);
    // 目盛りの間隔: 画面で 60px より広くなる、きりのよい数
    const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => s * this.zoom >= 60) || 5000;
    ctx.strokeStyle = '#8b929c'; ctx.fillStyle = '#b6bcc5'; ctx.lineWidth = 1; ctx.font = '9px sans-serif'; ctx.textBaseline = 'top';
    ctx.beginPath();
    for (let v = 0; v <= doc.w; v += step / 5) {
      const x = Math.round(this.docToScreen(v, 0).x) + 0.5, major = Math.round(v / (step / 5)) % 5 === 0;
      if (x < RULER || x > this.w) continue;
      ctx.moveTo(x, major ? 2 : RULER - 5); ctx.lineTo(x, RULER);
      if (major) ctx.fillText(String(Math.round(v)), x + 2, 2);
    }
    for (let v = 0; v <= doc.h; v += step / 5) {
      const y = Math.round(this.docToScreen(0, v).y) + 0.5, major = Math.round(v / (step / 5)) % 5 === 0;
      if (y < RULER || y > this.h) continue;
      ctx.moveTo(major ? 2 : RULER - 5, y); ctx.lineTo(RULER, y);
      if (major) { ctx.save(); ctx.translate(2, y + 2); ctx.rotate(Math.PI / 2); ctx.fillText(String(Math.round(v)), 0, -8); ctx.restore(); }
    }
    ctx.stroke();
    ctx.fillStyle = '#26282d';
    ctx.fillRect(0, 0, RULER, RULER);
    ctx.strokeStyle = '#40444d';
    ctx.strokeRect(0.5, 0.5, this.w, RULER - 0.5);
    ctx.strokeRect(0.5, 0.5, RULER - 0.5, this.h);
    ctx.restore();
  }

  // ブラシの丸(今のサイズ)。ポインターの位置に出す。スポイトで拾っている最中は、拾った色の輪
  drawCursor() {
    const c = state.cursor;
    if (!c || this.panning) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (state.picking) {
      ctx.lineWidth = 12;
      ctx.strokeStyle = state.fg;
      ctx.beginPath(); ctx.arc(c.x, c.y, 34, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(c.x, c.y, 40.5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.arc(c.x, c.y, 27.5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.x - 5, c.y); ctx.lineTo(c.x + 5, c.y); ctx.moveTo(c.x, c.y - 5); ctx.lineTo(c.x, c.y + 5); ctx.stroke();
      return;
    }
    const b = currentBrush();
    if (!b) return;
    const r = Math.max(1.5, (b.size / 2) * this.zoom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath(); ctx.arc(c.x, c.y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(c.x, c.y, r - 0.5, 0, Math.PI * 2); ctx.stroke();
    if (r < 4) {
      // 小さいブラシは見失わないように十字も
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(c.x - 9, c.y); ctx.lineTo(c.x - 5, c.y); ctx.moveTo(c.x + 5, c.y); ctx.lineTo(c.x + 9, c.y);
      ctx.moveTo(c.x, c.y - 9); ctx.lineTo(c.x, c.y - 5); ctx.moveTo(c.x, c.y + 5); ctx.lineTo(c.x, c.y + 9);
      ctx.stroke();
    }
  }
}
