// ブラシ: 入ってきた点をなめらかな線にして、丸い「判」(ダブ)を細かい間隔で押していく。
//   サイズ・流量は筆圧で変わる。1本の線は別の絵(ストローク)にためてから、ブラシの不透明度でレイヤーに重ねる
//   (Photoshop と同じ。同じ線の中で重ねても、不透明度より濃くならない)
import { createCanvas } from './doc.js';

// size: 直径 px / minSize: 筆圧が 0 のときのサイズの割合 / opacity: 1本の線の濃さの上限 / flow: 判1つの濃さ /
// hardness: 0 = ふわっと 〜 1 = くっきり / spacing: 判の間隔(サイズに対する割合)/ pSize・pFlow: 筆圧でサイズ・濃さを変える /
// grain: 紙のざらつき / smooth: 手ぶれ補正 0〜10 / erase: 消しゴム /
// round: 丸さ(1 = 丸、小さいほど平たい)/ angle: 平たい向き(度)/ scatter: 散らし(サイズに対する割合。判をばらまく)/
// marks: 固定したサイズ(左のバーの目盛り)/ custom: 自分で作ったブラシ /
// tip: 判の形(読み込んだブラシ。濃さだけの PNG の data URL。あれば、丸の代わりにこの形を押す)
export const BRUSHES = [
  { id: 'pen', name: 'Gペン', size: 10, minSize: 0.08, opacity: 1, flow: 1, hardness: 1, spacing: 0.05, pSize: true, pFlow: false, grain: 0, smooth: 4 },
  { id: 'maru', name: '丸ペン', size: 4, minSize: 0.2, opacity: 1, flow: 1, hardness: 1, spacing: 0.05, pSize: true, pFlow: false, grain: 0, smooth: 3 },
  { id: 'pencil', name: '鉛筆', size: 7, minSize: 0.55, opacity: 1, flow: 0.5, hardness: 0.7, spacing: 0.12, pSize: true, pFlow: true, grain: 0.75, smooth: 1 },
  { id: 'marker', name: 'マーカー', size: 26, minSize: 1, opacity: 0.55, flow: 1, hardness: 0.92, spacing: 0.05, pSize: false, pFlow: false, grain: 0, smooth: 2 },
  { id: 'gouache', name: '筆(不透明水彩)', size: 34, minSize: 0.35, opacity: 1, flow: 0.45, hardness: 0.65, spacing: 0.06, pSize: true, pFlow: true, grain: 0.15, smooth: 2 },
  { id: 'water', name: '水彩', size: 64, minSize: 0.6, opacity: 0.6, flow: 0.1, hardness: 0.3, spacing: 0.07, pSize: true, pFlow: true, grain: 0.25, smooth: 2 },
  { id: 'air', name: 'エアブラシ', size: 140, minSize: 1, opacity: 1, flow: 0.05, hardness: 0, spacing: 0.08, pSize: false, pFlow: true, grain: 0, smooth: 1 },
  { id: 'eraser-hard', name: '消しゴム(硬め)', size: 30, minSize: 0.5, opacity: 1, flow: 1, hardness: 1, spacing: 0.05, pSize: true, pFlow: false, grain: 0, smooth: 1, erase: true },
  { id: 'eraser-soft', name: '消しゴム(やわらかめ)', size: 90, minSize: 1, opacity: 1, flow: 0.25, hardness: 0.1, spacing: 0.07, pSize: false, pFlow: true, grain: 0, smooth: 1, erase: true },
];

// ---- ふわっとした判(中心は濃く、ふちに向かって消える)。色・硬さごとに1つ作って使い回す ----

const STAMP = 256;
const stamps = new Map();

export function softStamp(color, hardness) {
  const key = color + '|' + hardness.toFixed(2);
  let c = stamps.get(key);
  if (c) return c;
  c = createCanvas(STAMP, STAMP);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(STAMP / 2, STAMP / 2, 0, STAMP / 2, STAMP / 2, STAMP / 2);
  const rgb = hexRgb(color);
  const stop = (t, a) => g.addColorStop(t, `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`);
  stop(0, 1);
  stop(hardness, 1);
  for (let i = 1; i <= 10; i++) {
    const u = i / 10;
    stop(hardness + (1 - hardness) * u, 0.5 * (1 + Math.cos(Math.PI * u))); // なめらかに 0 へ
  }
  x.fillStyle = g;
  x.fillRect(0, 0, STAMP, STAMP);
  if (stamps.size > 40) stamps.delete(stamps.keys().next().value);
  stamps.set(key, c);
  return c;
}

// ---- 形のある判(読み込んだブラシ)。絵は読み込みに少しかかるので、できるまでは丸で押す ----

const tips = new Map(); // data URL → { img(読み込めたら入る), tinted(色ごとの絵) }

// ブラシの形を読み込んでおく。読み込めたら ready() を呼ぶ(見本を描き直すため)
export function loadTip(url, ready) {
  if (!url || tips.has(url)) return;
  const t = { img: null, tinted: new Map() };
  tips.set(url, t);
  const img = new Image();
  img.onload = () => { t.img = img; ready?.(); };
  img.src = url;
}

function tipStamp(url, color) {
  const t = tips.get(url);
  if (!t) { loadTip(url); return null; }
  if (!t.img) return null;
  let c = t.tinted.get(color);
  if (!c) {
    c = createCanvas(t.img.width, t.img.height);
    const x = c.getContext('2d');
    x.drawImage(t.img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, c.width, c.height);
    if (t.tinted.size > 6) t.tinted.delete(t.tinted.keys().next().value);
    t.tinted.set(color, c);
  }
  return c;
}

export function hexRgb(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ---- 紙のざらつき(鉛筆など)。ストロークをこの模様で抜く ----

const GRAIN = 256;
const grains = new Map();

export function grainPattern(ctx, grain) {
  const key = grain.toFixed(2);
  let c = grains.get(key);
  if (!c) {
    c = createCanvas(GRAIN, GRAIN);
    const x = c.getContext('2d');
    const img = x.createImageData(GRAIN, GRAIN);
    // 細かい粒 + 少し大きなむら(同じ種から作るので、いつも同じ紙)
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const coarse = new Float32Array(64 * 64);
    for (let i = 0; i < coarse.length; i++) coarse[i] = rnd();
    for (let py = 0; py < GRAIN; py++) {
      for (let px = 0; px < GRAIN; px++) {
        const fine = rnd();
        const m = coarse[(py >> 2) * 64 + (px >> 2)];
        const v = 1 - grain * Math.min(1, Math.max(0, (fine * 0.75 + m * 0.5) * 1.25 - 0.1));
        img.data[(py * GRAIN + px) * 4 + 3] = Math.round(255 * v);
      }
    }
    x.putImageData(img, 0, 0);
    grains.set(key, c);
  }
  return ctx.createPattern(c, 'repeat');
}

// ---- 1本の線 ----

export class Stroke {
  // ctx: 判を押す先(ストロークの絵) / color: '#rrggbb' /
  // sym: 対称 { cx, cy, list: [[左右を逆に, 上下を逆に], …] }(判を、(cx, cy) を軸に映した所にも押す)
  constructor(ctx, brush, color, sym = null) {
    this.sym = sym;
    this.ctx = ctx;
    this.brush = brush;
    this.color = brush.erase ? '#000000' : color;
    // 手ぶれ補正: 入ってきた点に、少しずつ近づく。follow = 1/60 秒ごとに近づく割合。
    // 点が届く速さは、機械でちがう(マウスは 1/60 秒ごと、Apple Pencil は 1/240 秒ごと)ので、前の点からの時間で割合を決める
    // (点ごとに同じ割合にすると、点がたくさん届く iPad では、すぐ追いついてしまって、補正がほとんど効かなかった。0.15.0)
    this.follow = 1 / (1 + brush.smooth * 0.55);
    this.maxLag = Infinity; // 手ぶれ補正で、線がペンから遅れてよい長さ(ドキュメントの px。tools.js が、画面の大きさから決める)
    // くっきりした丸い判を、同じ濃さで押すブラシ(Gペン・丸ペン・硬い消しゴム)は、曲線1本ぶんの判を1つの形にまとめて、1回で塗る(0.21.0。判ごとに塗るより、ずっと速い。
    // 重なっても濃くならない判なので、見た目は同じ)
    this.batch = brush.hardness >= 0.98 && !brush.tip && (brush.round ?? 1) >= 0.98 && !brush.pFlow && brush.flow >= 1;
    this.open = false;
    this.lt = null; // 前の点の時刻(ms)
    this.pts = [];
    this.acc = 0; // 前の判から進んだ長さ
    this.seed = 20240917; // 散らしの乱数(同じ線なら同じ形になるよう、決まった種から)
    this.dirty = null; // 描いた範囲(全体)
    this.fresh = null; // 前に takeFresh してから描いた範囲
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.color;
  }

  begin(x, y, p, t = null) {
    this.lt = t;
    this.sx = this.rx = x;
    this.sy = this.ry = y;
    this.sp = p;
    this.pts.push({ x, y, p });
    this.dab(x, y, p);
  }

  // t = その点の時刻(ms)。なければ、1/60 秒ごとに届いたものとして数える
  add(x, y, p, t = null) {
    let f = this.follow;
    if (f < 1 && t !== null && this.lt !== null) {
      const dt = t - this.lt;
      // 同じ時刻の点(動作確認で作った点など)は、1/60 秒ごととして数える
      if (dt >= 0.5) f = 1 - (1 - f) ** (Math.min(dt, 60) / 16.7);
    }
    if (t !== null) this.lt = t;
    this.rx = x;
    this.ry = y;
    this.sx += (x - this.sx) * f;
    this.sy += (y - this.sy) * f;
    const lag = Math.hypot(x - this.sx, y - this.sy);
    if (lag > this.maxLag) { const k = 1 - this.maxLag / lag; this.sx += (x - this.sx) * k; this.sy += (y - this.sy) * k; }
    this.sp += (p - this.sp) * 0.6;
    this.push(this.sx, this.sy, this.sp);
  }

  // 離したとき: 手ぶれ補正で遅れていた分を、最後の点まで描き切る
  end() {
    for (let i = 0; i < 120 && Math.hypot(this.rx - this.sx, this.ry - this.sy) > 0.5; i++) this.add(this.rx, this.ry, this.sp); // 補正が強いと、追いつくまでの回数が増える
    const n = this.pts.length;
    if (n >= 2) {
      const a = this.pts[n - 2], b = this.pts[n - 1];
      this.line(mid(a, b), b);
    }
    this.ctx.globalAlpha = 1;
  }

  push(x, y, p) {
    const pts = this.pts;
    const last = pts[pts.length - 1];
    if (Math.hypot(x - last.x, y - last.y) < 0.3) return;
    pts.push({ x, y, p });
    const n = pts.length;
    if (n === 2) this.line(pts[0], mid(pts[0], pts[1]));
    else this.quad(mid(pts[n - 3], pts[n - 2]), pts[n - 2], mid(pts[n - 2], pts[n - 1]));
  }

  line(a, b) { this.quad(a, mid(a, b), b); }

  // a → b の曲線(c が曲がり角)を細かくたどって、間隔ごとに判を押す
  quad(a, c, b) {
    const len = Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y);
    if (len < 0.01) return;
    const step = Math.max(0.3, Math.min(1, this.gap(a.p) * 0.5));
    const n = Math.max(1, Math.ceil(len / step));
    let px = a.x, py = a.y;
    if (this.batch) { this.ctx.beginPath(); this.open = true; }
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
      const y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
      const p = a.p + (b.p - a.p) * t;
      this.acc += Math.hypot(x - px, y - py);
      px = x;
      py = y;
      const gap = this.gap(p);
      if (this.acc >= gap) {
        this.acc = this.acc % gap;
        this.dab(x, y, p);
      }
    }
    if (this.open) { this.open = false; this.ctx.fill(); }
  }

  size(p) {
    const b = this.brush;
    return Math.max(0.7, b.size * (b.pSize ? b.minSize + (1 - b.minSize) * p : 1));
  }

  gap(p) { return Math.max(0.4, this.brush.spacing * this.size(p)); }

  dab(x, y, p) {
    const b = this.brush, ctx = this.ctx;
    const d = this.size(p), r = d / 2;
    if (b.scatter > 0) {
      const a = this.rand() * Math.PI * 2, m = this.rand() * b.scatter * d;
      x += Math.cos(a) * m;
      y += Math.sin(a) * m;
    }
    ctx.globalAlpha = Math.min(1, b.flow * (b.pFlow ? 0.15 + 0.85 * p : 1));
    this.put(x, y, d, false, false);
    if (this.sym) for (const [mx, my] of this.sym.list) this.put(mx ? 2 * this.sym.cx - x : x, my ? 2 * this.sym.cy - y : y, d, mx, my);
  }

  // 判を1つ押す。mx・my = 左右・上下を逆にした判(対称)
  put(x, y, d, mx, my) {
    const b = this.brush, ctx = this.ctx, r = d / 2;
    const round = b.round ?? 1, hard = b.hardness >= 0.98;
    const tip = b.tip ? tipStamp(b.tip, this.color) : null;
    if (tip || round < 0.98) {
      // 形のある判・平たい判: 向きを回して、縦をつぶす
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(((mx !== my ? -1 : 1) * (b.angle || 0) * Math.PI) / 180);
      ctx.scale(mx ? -1 : 1, (my ? -1 : 1) * Math.max(0.05, round));
      if (tip) ctx.drawImage(tip, -r, -r, d, d);
      else if (hard) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); }
      else ctx.drawImage(softStamp(this.color, b.hardness), -r, -r, d, d);
      ctx.restore();
    } else if (hard && this.open) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    } else if (hard) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.drawImage(softStamp(this.color, b.hardness), x - r, y - r, d, d);
    }
    const x0 = Math.floor(x - r - 2), y0 = Math.floor(y - r - 2), x1 = Math.ceil(x + r + 2), y1 = Math.ceil(y + r + 2);
    this.dirty = grow(this.dirty, x0, y0, x1, y1);
    this.fresh = grow(this.fresh, x0, y0, x1, y1);
  }

  rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  takeFresh() {
    const f = this.fresh;
    this.fresh = null;
    return f;
  }
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 });

function grow(r, x0, y0, x1, y1) {
  if (!r) return { x0, y0, x1, y1 };
  r.x0 = Math.min(r.x0, x0);
  r.y0 = Math.min(r.y0, y0);
  r.x1 = Math.max(r.x1, x1);
  r.y1 = Math.max(r.y1, y1);
  return r;
}

// 範囲をドキュメントの中に収める(はみ出していれば null)
export function clampRect(r, w, h) {
  if (!r) return null;
  const x0 = Math.max(0, r.x0), y0 = Math.max(0, r.y0), x1 = Math.min(w, r.x1), y1 = Math.min(h, r.y1);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}
