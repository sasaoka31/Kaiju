// 線との隙間: ブラシで描くとき、すでにある絵(線)から gap px 以内には色が乗らないようにする。
//   描き始めに「塗れない所」の絵を1枚作り、ストロークからそこを抜く(tools.js の refresh)。
//   すでにある絵 = 用紙を除いた、見えているレイヤーぜんぶ。keepSame なら、今の描画色と同じ色の所は数えない
//   (同じ色で塗り足すときは、くっつく。ちがう色の線とのあいだにだけ隙間があく)
import { createCanvas, composite } from './doc.js';
import { distance2, INF } from './fill.js';
import { hexRgb } from './brush.js';

const MAX_PIXELS = 400000; // 距離の計算は、これくらいの大きさに縮めた絵で行う(描き始めに待たせないため。誤差は 1px ほど)
const SAME = 40; // 「同じ色」とみなす差

let small = null, out = null;

// → 塗れない所が不透明な絵(ドキュメントより小さい。使うときに引きのばす)。隙間をあける相手がなければ null
export function protectMask(doc, gap, color, keepSame) {
  const s = Math.min(1, Math.sqrt(MAX_PIXELS / (doc.w * doc.h)));
  const w = Math.max(1, Math.round(doc.w * s)), h = Math.max(1, Math.round(doc.h * s));
  if (!small || small.width !== w || small.height !== h) {
    small = createCanvas(w, h);
    out = createCanvas(w, h);
  }
  const x = small.getContext('2d', { willReadFrequently: true });
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, w, h);
  x.setTransform(w / doc.w, 0, 0, h / doc.h, 0, 0);
  x.imageSmoothingQuality = 'high';
  composite(x, doc, null, true);
  const px = x.getImageData(0, 0, w, h).data;

  const c = hexRgb(color);
  const d = new Float32Array(w * h);
  let any = false;
  for (let i = 0, o = 0; i < d.length; i++, o += 4) {
    const line = px[o + 3] > 24 && !(keepSame && Math.abs(px[o] - c.r) <= SAME && Math.abs(px[o + 1] - c.g) <= SAME && Math.abs(px[o + 2] - c.b) <= SAME);
    d[i] = line ? 0 : INF;
    any ||= line;
  }
  if (!any) return null;
  distance2(d, w, h);

  // 線から gap 以内 = 不透明。ふちは 1px ぶん、なめらかに
  const lim = gap * s + 0.5, far = (lim + 1) * (lim + 1);
  const img = new ImageData(w, h);
  for (let i = 0; i < d.length; i++) {
    if (d[i] >= far) continue;
    img.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, lim - Math.sqrt(d[i]))));
  }
  out.getContext('2d').putImageData(img, 0, 0);
  return out;
}
