// 絵の調整: 色相・彩度・明るさ / シャープ / ノイズ。今のレイヤー(選択範囲があれば、その中だけ)を変える。
//   ウィンドウ(#pop-hsb・#pop-sharpen・#pop-noise)のスライダーを動かすと、その場で見た目が変わる。「適用」で確定、「やめる」で元に戻す
import { state, requestRender } from './state.js';
import { createCanvas } from './doc.js';
import { say } from './messages.js';

const $ = (id) => document.getElementById(id);
let A = null; // 調整中: { kind, layer, rect, src(元の絵の ImageData), before(元の絵), out(作業用), base(絵の平均の色。HSL) }

// 絵のある範囲(選択範囲があれば、その範囲と重なる所)。何もなければ null
export function contentRect(layer, sel) {
  const doc = state.doc;
  const box = sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : { x: 0, y: 0, w: doc.w, h: doc.h };
  const d = layer.ctx.getImageData(box.x, box.y, box.w, box.h).data;
  let x0 = box.w, y0 = box.h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < box.h; y++) {
    for (let x = 0; x < box.w; x++, i += 4) {
      if (!d[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: box.x + x0, y: box.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// h: -180〜180(度)、s・l: -100〜100
export function adjustPixels(src, dst, dh, ds, dl) {
  const a = src.data, b = dst.data;
  const hs = dh / 360, sk = 1 + ds / 100, lk = dl / 100;
  for (let i = 0; i < a.length; i += 4) {
    b[i + 3] = a[i + 3];
    if (!a[i + 3]) continue;
    const r = a[i] / 255, g = a[i + 1] / 255, bl = a[i + 2] / 255;
    const max = Math.max(r, g, bl), min = Math.min(r, g, bl);
    let h = 0, s = 0, l = (max + min) / 2;
    const d = max - min;
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - bl) / d + (g < bl ? 6 : 0);
      else if (max === g) h = (bl - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    h = (h + hs + 1) % 1;
    s = Math.min(1, Math.max(0, s * sk));
    l = lk < 0 ? l * (1 + lk) : l + (1 - l) * lk;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    b[i] = Math.round(255 * hue(p, q, h + 1 / 3));
    b[i + 1] = Math.round(255 * hue(p, q, h));
    b[i + 2] = Math.round(255 * hue(p, q, h - 1 / 3));
  }
}

function hue(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

// シャープ(アンシャープマスク): ぼかした絵との差を足して、輪郭をくっきりさせる。
//   amount = 強さ(%。100 で、差をそのまま足す)/ radius = ぼかす半径(px。どのくらいの太さの輪郭に効かせるか)/
//   threshold = しきい値(差がこれより小さい所は、そのまま。ざらつきを強めない)
// ぼかしは、箱ぼかしを縦横に2回ずつ(なめらかなぼかしに近い)。透明度の重みつき(透明な所の色を拾って、ふちが暗くならないように)
export function sharpenPixels(src, dst, amount, radius = 1, threshold = 0) {
  const a = src.data, b = dst.data, w = src.width, h = src.height, n = w * h, k = amount / 100;
  // 色に透明度を掛けたもの(R・G・B)と、透明度
  let ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0, j = 0; i < n; i++, j += 4) { const al = a[j + 3]; ch[0][i] = a[j] * al; ch[1][i] = a[j + 1] * al; ch[2][i] = a[j + 2] * al; ch[3][i] = al; }
  const r = Math.max(1, Math.round(radius / 2)), line = new Float32Array(Math.max(w, h));
  // 1列(start から step おきに len 個)を、幅 2r+1 の平均にする(はしは、はしの値が続くものとして)
  const box = (c, start, step, len) => {
    for (let i = 0; i < len; i++) line[i] = c[start + i * step];
    let sum = line[0] * (r + 1);
    for (let i = 1; i <= r; i++) sum += line[Math.min(len - 1, i)];
    for (let i = 0; i < len; i++) {
      c[start + i * step] = sum / (2 * r + 1);
      sum += line[Math.min(len - 1, i + r + 1)] - line[Math.max(0, i - r)];
    }
  };
  for (const c of ch) {
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) box(c, y * w, 1, w);
      for (let x = 0; x < w; x++) box(c, x, w, h);
    }
  }
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    b[j + 3] = a[j + 3];
    if (!a[j + 3]) continue;
    const al = ch[3][i] || 1;
    for (let c = 0; c < 3; c++) {
      const d = a[j + c] - ch[c][i] / al;
      b[j + c] = Math.abs(d) < threshold ? a[j + c] : a[j + c] + d * k; // Uint8ClampedArray なので、0〜255 に収まる
    }
  }
}

// ノイズ: 絵のある所に、ざらざらを足す。amount = 0〜100、color = 色つき(オフなら明るさだけ)。
// 乱数は、いつも同じ並び(スライダーを動かしても、粒の位置が変わらない)
export function noisePixels(src, dst, amount, color) {
  const a = src.data, b = dst.data, k = (amount / 100) * 160;
  let seed = 0x2f6e2b1;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296 - 0.5) * k; };
  for (let i = 0; i < a.length; i += 4) {
    const n = rnd(), n2 = rnd(), n3 = rnd(); // 絵のない所でも進める(粒の位置を、絵の形によらず同じに)
    b[i + 3] = a[i + 3];
    if (!a[i + 3]) continue;
    b[i] = a[i] + n;
    b[i + 1] = a[i + 1] + (color ? n2 : n);
    b[i + 2] = a[i + 2] + (color ? n3 : n);
  }
}

// レベル補正: 入力の 黒(in0)〜 白(in1)を、0〜255 に広げる。gamma = 中間の明るさ(1 = そのまま。大きいほど明るい)。出力は out0〜out1 に収める
export function levelsPixels(src, dst, in0, gamma, in1, out0, out1) {
  const a = src.data, b = dst.data, lut = new Uint8Array(256), span = Math.max(1, in1 - in0);
  for (let i = 0; i < 256; i++) {
    const v = Math.min(1, Math.max(0, (i - in0) / span)) ** (1 / Math.max(0.05, gamma));
    lut[i] = Math.round(out0 + v * (out1 - out0));
  }
  for (let i = 0; i < a.length; i += 4) {
    b[i + 3] = a[i + 3];
    if (!a[i + 3]) continue;
    b[i] = lut[a[i]]; b[i + 1] = lut[a[i + 1]]; b[i + 2] = lut[a[i + 2]];
  }
}

// 明るさの分布(ヒストグラム)を、レベル補正のウィンドウに描く
function drawHistogram() {
  const c = $('lv-hist'), x = c.getContext('2d'), d = A.src.data, bins = new Uint32Array(256);
  const step = Math.max(1, Math.floor(d.length / 4 / 200000)) * 4;
  for (let i = 0; i < d.length; i += step) if (d[i + 3]) bins[Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114)]++;
  let max = 1;
  for (let i = 1; i < 255; i++) max = Math.max(max, bins[i]); // 両はし(まっ黒・まっ白)は、高さの基準にしない
  x.clearRect(0, 0, c.width, c.height);
  x.fillStyle = '#c9ced6';
  for (let i = 0; i < 256; i++) { const h = Math.min(c.height, (bins[i] / max) * c.height); x.fillRect(i, c.height - h, 1, h); }
}

const sign = (v) => (v > 0 ? '+' : '') + v;
// 調整の種類: ids = 値を持つ部品(スライダーかチェック)、none = 何も変えない値か、run = 絵に掛ける、show = 値の表示
const KINDS = {
  hsb: {
    label: '色相・彩度・明るさ', ids: ['hsb-h', 'hsb-s', 'hsb-l'], none: (v) => !v[0] && !v[1] && !v[2],
    run: (v) => adjustPixels(A.src, A.out, v[0], v[1], v[2]),
    show: (v) => [sign(v[0]) + '°', sign(v[1]), sign(v[2])],
  },
  sharpen: { label: 'シャープ', ids: ['sharpen-amount', 'sharpen-radius', 'sharpen-threshold'], none: (v) => !v[0], run: (v) => sharpenPixels(A.src, A.out, v[0], v[1], v[2]), show: (v) => [v[0] + '%', v[1] + ' px', String(v[2])] },
  noise: { label: 'ノイズ', ids: ['noise-amount', 'noise-color'], none: (v) => !v[0], run: (v) => noisePixels(A.src, A.out, v[0], !!v[1]), show: (v) => [String(v[0])] },
  levels: {
    label: 'レベル補正', ids: ['lv-in0', 'lv-gamma', 'lv-in1', 'lv-out0', 'lv-out1'], none: (v) => v[0] === 0 && v[1] === 100 && v[2] === 255 && v[3] === 0 && v[4] === 255,
    run: (v) => levelsPixels(A.src, A.out, Math.min(v[0], v[2] - 1), v[1] / 100, v[2], v[3], v[4]),
    show: (v) => [String(v[0]), (v[1] / 100).toFixed(2), String(v[2]), String(v[3]), String(v[4])],
  },
};
// 階調の反転(色を、反対の色にする)。ウィンドウは出さずに、すぐ掛ける
KINDS.invert = {
  label: '階調の反転', ids: [], none: () => false, show: () => [],
  run: () => { const a = A.src.data, b = A.out.data; for (let i = 0; i < a.length; i += 4) { b[i] = 255 - a[i]; b[i + 1] = 255 - a[i + 1]; b[i + 2] = 255 - a[i + 2]; b[i + 3] = a[i + 3]; } },
};
const NEUTRAL = { 'lv-gamma': 100, 'lv-in1': 255, 'lv-out1': 255, 'sharpen-radius': 2 }; // 何も変えない値(ほかは 0)
const DEFAULTS = { ...NEUTRAL, 'sharpen-amount': 100, 'noise-amount': 20 }; // 開いたときの値
export const ADJUST_POPS = { 'pop-hsb': 'hsb', 'pop-sharpen': 'sharpen', 'pop-noise': 'noise', 'pop-levels': 'levels' };

function values(kind = A.kind) {
  return KINDS[kind].ids.map((id) => ($(id).type === 'checkbox' ? Number($(id).checked) : Number($(id).value)));
}

// 絵の平均の色(HSL。h は 0〜360)。色相・彩度・明るさのバーを、実際の色で塗るのに使う
function averageHsl(img) {
  const d = img.data, step = Math.max(1, Math.floor(d.length / 4 / 20000)) * 4;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += step) { const a = d[i + 3]; r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a; }
  if (!n) return { h: 0, s: 0, l: 0.5 };
  r /= n * 255; g /= n * 255; b /= n * 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, df = max - min;
  let h = 0, s = 0;
  if (df > 1e-6) {
    s = l > 0.5 ? df / (2 - max - min) : df / (max + min);
    if (max === r) h = (g - b) / df + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / df + 2;
    else h = (r - g) / df + 4;
    h *= 60;
  }
  return { h, s, l };
}

// 色相・彩度・明るさのバーを、動かしたらなる色で塗る(真ん中が今の色。絵の平均の色をもとにする)
function paintTracks(dh, ds, dl) {
  const { h, s, l } = A.base;
  const sat = (d) => Math.min(1, Math.max(0, s * (1 + d / 100)));
  const lit = (d) => (d < 0 ? l * (1 + d / 100) : l + (1 - l) * (d / 100));
  const css = (hh, ss, ll) => `hsl(${Math.round(((hh % 360) + 360) % 360)} ${Math.round(ss * 100)}% ${Math.round(ll * 100)}%)`;
  const grad = (n, at) => { const st = []; for (let i = 0; i <= n; i++) st.push(at(i / n)); return `linear-gradient(to right, ${st.join(', ')})`; };
  $('hsb-h').style.background = grad(12, (t) => css(h + (t - 0.5) * 360, sat(ds), lit(dl)));
  $('hsb-s').style.background = grad(4, (t) => css(h + dh, sat((t - 0.5) * 200), lit(dl)));
  $('hsb-l').style.background = grad(8, (t) => css(h + dh, sat(ds), lit((t - 0.5) * 200)));
}

function preview() {
  if (!A) return;
  const K = KINDS[A.kind], v = values();
  K.show(v).forEach((text, i) => { const em = $(K.ids[i] + '-val'); if (em) em.textContent = text; });
  if (A.kind === 'hsb') paintTracks(v[0], v[1], v[2]);
  const { layer, rect } = A;
  K.run(v);
  const x = A.tmp.getContext('2d');
  x.globalCompositeOperation = 'source-over';
  x.putImageData(A.out, 0, 0);
  if (state.selection) {
    // 選択範囲の外は、元の絵のまま
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(state.selection.mask, -rect.x, -rect.y);
    x.globalCompositeOperation = 'destination-over';
    x.drawImage(A.before, 0, 0);
    x.globalCompositeOperation = 'source-over';
  }
  put(layer, rect, A.tmp);
  requestRender();
}

function put(layer, rect, img) {
  layer.ctx.globalAlpha = 1;
  layer.ctx.globalCompositeOperation = 'source-over';
  layer.ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  layer.ctx.drawImage(img, rect.x, rect.y);
}

// 値を入れ直す。zero = true なら、ぜんぶ 0(「0 に戻す」)。false なら、開いたときの値
function reset(kind, zero = false) {
  for (const id of KINDS[kind].ids) {
    if ($(id).type === 'checkbox') $(id).checked = false;
    else $(id).value = (zero ? NEUTRAL[id] : DEFAULTS[id]) ?? 0;
  }
}

// ウィンドウを開いたとき。調整を始められなければ false
export function beginAdjust(kind = 'hsb') {
  endAdjust(false);
  const layer = state.doc.active;
  if (!layer || layer.isGroup) { say('adjustNeedLayer'); return false; }
  if (layer.locked) { say('layerLocked'); return false; }
  if (state.maskMode) return false;
  const rect = contentRect(layer, state.selection);
  if (!rect) { say(state.selection ? 'adjustEmptySel' : 'adjustEmpty'); return false; }
  const before = createCanvas(rect.w, rect.h);
  before.getContext('2d').drawImage(layer.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const src = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  A = { kind, layer, rect, before, src, out: new ImageData(rect.w, rect.h), tmp: createCanvas(rect.w, rect.h), base: averageHsl(src) };
  reset(kind);
  if (kind === 'levels') drawHistogram();
  preview();
  return true;
}

// ウィンドウを閉じるとき。apply = true なら確定(元に戻せるよう履歴に入れる)、false なら元の絵に戻す
export function endAdjust(apply) {
  if (!A) return;
  const { kind, layer, rect, before } = A;
  const none = KINDS[kind].none(values());
  A = null;
  if (!apply || none) { put(layer, rect, before); requestRender(); return; }
  const after = createCanvas(rect.w, rect.h);
  after.getContext('2d').drawImage(layer.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  state.history.push({ label: KINDS[kind].label, layer, undo: () => put(layer, rect, before), redo: () => put(layer, rect, after) });
  requestRender();
}

export const isAdjusting = () => !!A;

export function invertColors() {
  if (beginAdjust('invert')) endAdjust(true);
}

// close(id): そのウィンドウを閉じる(ui.js)
export function initAdjust(close) {
  let raf = 0;
  for (const [pop, kind] of Object.entries(ADJUST_POPS)) {
    for (const id of KINDS[kind].ids) {
      $(id).addEventListener('input', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(preview); });
    }
    $(kind + '-apply').onclick = () => { endAdjust(true); close(pop); };
    $(kind + '-cancel').onclick = () => { endAdjust(false); close(pop); };
    $(kind + '-reset').onclick = () => { if (A?.kind === kind) { reset(kind, true); preview(); } };
  }
}
