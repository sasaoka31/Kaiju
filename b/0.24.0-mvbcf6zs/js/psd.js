// PSD(Photoshop の形式)の読み書き。8bit の RGB だけ。
//   書く: レイヤー(絵・名前・不透明度・合成モード・表示・マスクをクリップ・アルファロック)、グループ(フォルダ)、1枚にまとめた絵。絵は RLE(PackBits)で圧縮
//   読む: 上と同じもの。圧縮は「なし」と RLE。レイヤーマスク・調整レイヤー・文字・効果は読まない(絵のあるレイヤーだけが残る)
// レイヤーは下 → 上の順に入っている。グループは「終わりの印(lsct 3)→ 中身 → フォルダ(lsct 1 = 開いている / 2 = 閉じている)」の順
import { Doc, Layer, Group, BLENDS, flatten } from './doc.js';

const KEY_OF = Object.fromEntries(BLENDS.map(([id, , , key]) => [id, key]));
const ID_OF = Object.fromEntries(BLENDS.map(([id, , , key]) => [key, id]));

// ---- 書く ----

class Writer {
  constructor() { this.parts = []; this.size = 0; }
  bytes(u8) { this.parts.push(u8); this.size += u8.length; }
  make(n, fn) { const b = new Uint8Array(n); fn(new DataView(b.buffer)); this.bytes(b); }
  u8(v) { this.make(1, (d) => d.setUint8(0, v)); }
  u16(v) { this.make(2, (d) => d.setUint16(0, v)); }
  i16(v) { this.make(2, (d) => d.setInt16(0, v)); }
  u32(v) { this.make(4, (d) => d.setUint32(0, v)); }
  i32(v) { this.make(4, (d) => d.setInt32(0, v)); }
  str(s) { this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0))); }
  zeros(n) { if (n > 0) this.bytes(new Uint8Array(n)); }
  // 中身を先に作って、その長さ(u32)を前に付ける
  block(fn, pad = 1) {
    const w = new Writer();
    fn(w);
    w.zeros((pad - (w.size % pad)) % pad);
    this.u32(w.size);
    for (const p of w.parts) this.bytes(p);
  }
  result() {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

// 1行を PackBits で圧縮して out の o から書く。書いたあとの位置を返す
function packRow(src, start, len, out, o) {
  const end = start + len;
  let i = start;
  while (i < end) {
    let run = 1;
    while (i + run < end && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 3) { out[o++] = 257 - run; out[o++] = src[i]; i += run; continue; }
    let j = i;
    while (j < end && j - i < 128) {
      if (j + 2 < end && src[j] === src[j + 1] && src[j] === src[j + 2]) break;
      j++;
    }
    out[o++] = j - i - 1;
    out.set(src.subarray(i, j), o);
    o += j - i;
    i = j;
  }
  return o;
}

// RGBA の絵(w × h)の ch 番目(0〜3)を、RLE にする → { counts(行ごとの長さ。u16 の並び), data }
function packChannel(rgba, w, h, ch) {
  const row = new Uint8Array(w);
  const out = new Uint8Array(h * (w + Math.ceil(w / 128) + 2));
  const counts = new Uint8Array(h * 2);
  let o = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0, i = y * w * 4 + ch; x < w; x++, i += 4) row[x] = rgba[i];
    const n = packRow(row, 0, w, out, o) - o;
    counts[y * 2] = n >> 8;
    counts[y * 2 + 1] = n & 255;
    o += n;
  }
  return { counts, data: out.slice(0, o) };
}

// 絵のある範囲(なければ null)
function bounds(d, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      if (!d[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// 保存する並び(下 → 上)。グループは、終わりの印 → 中身 → フォルダ
function records(list, out = []) {
  for (const n of list) {
    if (n.isGroup) {
      out.push({ node: n, divider: 3, name: '</Layer group>' });
      records(n.children, out);
      out.push({ node: n, divider: n.open ? 1 : 2, name: n.name });
    } else {
      out.push({ node: n, name: n.name });
    }
  }
  return out;
}

export function writePsd(doc) {
  const { w, h } = doc;
  const recs = records(doc.layers);
  // レイヤーごとの絵(絵のある範囲だけ)
  for (const r of recs) {
    r.rect = { x: 0, y: 0, w: 0, h: 0 };
    r.chans = [];
    if (r.divider) continue;
    const full = r.node.ctx.getImageData(0, 0, w, h).data;
    const b = bounds(full, w, h);
    if (!b) continue;
    r.rect = b;
    const d = b.w === w && b.h === h ? full : r.node.ctx.getImageData(b.x, b.y, b.w, b.h).data;
    r.chans = [3, 0, 1, 2].map((ch) => packChannel(d, b.w, b.h, ch)); // 透明度・R・G・B の順
  }

  const out = new Writer();
  out.str('8BPS'); out.u16(1); out.zeros(6); out.u16(4); out.u32(h); out.u32(w); out.u16(8); out.u16(3);
  out.u32(0); // カラーモードのデータ
  out.u32(0); // 画像リソース
  out.block((sec) => {
    sec.block((info) => {
      info.i16(-recs.length); // マイナス = 1枚にまとめた絵の4つ目のチャンネルは、透明度
      for (const r of recs) {
        const n = r.node, b = r.rect, plain = !r.divider || r.divider !== 3;
        info.i32(b.y); info.i32(b.x); info.i32(b.y + b.h); info.i32(b.x + b.w);
        info.u16(4);
        [-1, 0, 1, 2].forEach((id, k) => { info.i16(id); info.u32(r.chans[k] ? 2 + r.chans[k].counts.length + r.chans[k].data.length : 2); });
        info.str('8BIM');
        info.str(plain ? KEY_OF[n.blend] || 'norm' : 'norm');
        info.u8(plain ? Math.round(n.opacity * 255) : 255);
        info.u8(plain && n.clip ? 1 : 0);
        info.u8((plain && n.lockAlpha ? 1 : 0) | (plain && !n.visible ? 2 : 0) | 8 | (r.divider ? 16 : 0));
        info.u8(0);
        info.block((ex) => {
          ex.u32(0); // レイヤーマスク
          ex.u32(0); // ブレンドの範囲
          // 名前(昔の形式。英数字だけ)。本当の名前は、下の luni(Unicode)
          const ascii = r.name.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 30) || (r.divider ? 'Group' : 'Layer');
          ex.u8(ascii.length); ex.str(ascii); ex.zeros((4 - ((1 + ascii.length) % 4)) % 4);
          ex.str('8BIM'); ex.str('luni');
          ex.block((u) => { u.u32(r.name.length); for (const c of r.name) for (let i = 0; i < c.length; i++) u.u16(c.charCodeAt(i)); }, 4);
          if (r.divider) {
            ex.str('8BIM'); ex.str('lsct');
            ex.block((s) => { s.u32(r.divider); s.str('8BIM'); s.str(r.divider === 3 ? 'norm' : KEY_OF[n.blend] || 'norm'); });
          }
        });
      }
      for (const r of recs) {
        for (let k = 0; k < 4; k++) {
          const c = r.chans[k];
          if (!c) { info.u16(0); continue; }
          info.u16(1); info.bytes(c.counts); info.bytes(c.data);
        }
      }
    }, 2);
    sec.u32(0); // 全体のレイヤーマスク
  });
  // 1枚にまとめた絵(R・G・B・透明度。行ごとの長さをぜんぶ先に、絵をそのあとに)
  const flat = flatten(doc).getContext('2d').getImageData(0, 0, w, h).data;
  const merged = [0, 1, 2, 3].map((ch) => packChannel(flat, w, h, ch));
  out.u16(1);
  for (const c of merged) out.bytes(c.counts);
  for (const c of merged) out.bytes(c.data);
  return out.result();
}

// ---- 読む ----

const fail = (msg) => { throw new Error(msg); };

function unpackRow(src, o, n, out, at, len) {
  const end = o + n, stop = at + len;
  while (o < end && at < stop) {
    const c = src[o++];
    if (c < 128) { const k = Math.min(c + 1, stop - at); out.set(src.subarray(o, o + k), at); at += k; o += c + 1; }
    else if (c > 128) { const k = Math.min(257 - c, stop - at); out.fill(src[o], at, at + k); at += k; o++; }
  }
}

// 1つのチャンネル(w × h)を読む。o は、圧縮の種類(u16)の次の位置
function readPlane(u8, dv, o, comp, w, h) {
  const out = new Uint8Array(w * h);
  if (comp === 0) { out.set(u8.subarray(o, o + w * h)); return out; }
  if (comp !== 1) fail('この PSD の圧縮(ZIP)には対応していません。Photoshop / クリスタで、ふつうの PSD として保存し直してください');
  let p = o + h * 2;
  for (let y = 0; y < h; y++) {
    const n = dv.getUint16(o + y * 2);
    unpackRow(u8, p, n, out, y * w, w);
    p += n;
  }
  return out;
}

const utf16 = (dv, o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(dv.getUint16(o + i * 2)); return s.replace(/\0+$/, ''); };

export function readPsd(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (tag(0) !== '8BPS') fail('PSD ではありません');
  if (dv.getUint16(4) !== 1) fail('大きいドキュメント形式(PSB)には対応していません');
  const channels = dv.getUint16(12), h = dv.getUint32(14), w = dv.getUint32(18), depth = dv.getUint16(22), mode = dv.getUint16(24);
  if (depth !== 8 || mode !== 3) fail('8bit の RGB の PSD だけ開けます(Photoshop / クリスタで、RGB・8bit にして保存し直してください)');
  if (w > 8000 || h > 8000) fail('大きすぎます(8000 px まで)');
  let o = 26;
  o += 4 + dv.getUint32(o); // カラーモード
  o += 4 + dv.getUint32(o); // 画像リソース
  const secLen = dv.getUint32(o);
  const secEnd = o + 4 + secLen;
  o += 4;
  const recs = [];
  if (secLen > 0) {
    const infoLen = dv.getUint32(o);
    o += 4;
    if (infoLen > 0) {
      const count = Math.abs(dv.getInt16(o));
      o += 2;
      for (let i = 0; i < count; i++) {
        const r = { top: dv.getInt32(o), left: dv.getInt32(o + 4), bottom: dv.getInt32(o + 8), right: dv.getInt32(o + 12), chans: [] };
        const nch = dv.getUint16(o + 16);
        o += 18;
        for (let k = 0; k < nch; k++, o += 6) r.chans.push({ id: dv.getInt16(o), len: dv.getUint32(o + 2) });
        r.blend = tag(o + 4);
        r.opacity = u8[o + 8] / 255;
        r.clip = u8[o + 9] === 1;
        r.lockAlpha = !!(u8[o + 10] & 1);
        r.visible = !(u8[o + 10] & 2);
        const extraEnd = o + 16 + dv.getUint32(o + 12);
        o += 16;
        o += 4 + dv.getUint32(o); // レイヤーマスク
        o += 4 + dv.getUint32(o); // ブレンドの範囲
        const nameLen = u8[o];
        try { r.name = new TextDecoder('shift_jis').decode(u8.subarray(o + 1, o + 1 + nameLen)); } catch { r.name = ''; }
        o += Math.ceil((1 + nameLen) / 4) * 4;
        while (o + 12 <= extraEnd) {
          const key = tag(o + 4), len = dv.getUint32(o + 8), at = o + 12;
          if (key === 'luni' && len >= 4) r.name = utf16(dv, at + 4, Math.min(dv.getUint32(at), (len - 4) >> 1));
          if (key === 'lsct' || key === 'lsdk') { r.divider = dv.getUint32(at); if (len >= 12) r.blend = tag(at + 8); }
          o = at + len + (len & 1);
        }
        o = extraEnd;
        recs.push(r);
      }
      // 絵
      for (const r of recs) {
        const lw = r.right - r.left, lh = r.bottom - r.top;
        const planes = {};
        for (const c of r.chans) {
          if (c.id >= -1 && c.id <= 2 && lw > 0 && lh > 0 && c.len > 2) planes[c.id] = readPlane(u8, dv, o + 2, dv.getUint16(o), lw, lh);
          o += c.len;
        }
        if (r.divider || lw <= 0 || lh <= 0 || !planes[0]) continue;
        const img = new ImageData(lw, lh), d = img.data;
        const R = planes[0], G = planes[1] || R, B = planes[2] || R, A = planes[-1];
        for (let i = 0, p = 0; i < R.length; i++, p += 4) { d[p] = R[i]; d[p + 1] = G[i]; d[p + 2] = B[i]; d[p + 3] = A ? A[i] : 255; }
        r.img = img;
      }
    }
  }

  const doc = new Doc(w, h, { empty: true });
  if (!recs.length) {
    // レイヤーのない PSD: 1枚にまとめた絵を、1枚のレイヤーにする
    o = secEnd;
    const comp = dv.getUint16(o);
    o += 2;
    const planes = [];
    let p = comp === 1 ? o + channels * h * 2 : o;
    for (let k = 0; k < channels; k++) {
      const out = new Uint8Array(w * h);
      if (comp === 0) { out.set(u8.subarray(p, p + w * h)); p += w * h; }
      else if (comp === 1) {
        for (let y = 0; y < h; y++) { const n = dv.getUint16(o + (k * h + y) * 2); unpackRow(u8, p, n, out, y * w, w); p += n; }
      } else fail('この PSD の圧縮には対応していません');
      planes.push(out);
    }
    const l = new Layer(w, h, 'レイヤー 1');
    const img = new ImageData(w, h), d = img.data;
    const [R, G = R, B = R] = planes;
    for (let i = 0, q = 0; i < R.length; i++, q += 4) { d[q] = R[i]; d[q + 1] = G[i]; d[q + 2] = B[i]; d[q + 3] = 255; }
    l.ctx.putImageData(img, 0, 0);
    doc.layers.push(l);
  } else {
    // 並びを組み立てる(終わりの印でグループの中に入り、フォルダで外に出る)
    const stack = [[]];
    for (const r of recs) {
      if (r.divider === 3) { stack.push([]); continue; }
      let n;
      if (r.divider === 1 || r.divider === 2) {
        n = new Group(r.name || 'グループ');
        n.children = stack.length > 1 ? stack.pop() : [];
        n.open = r.divider === 1;
      } else {
        n = new Layer(w, h, r.name || 'レイヤー');
        n.lockAlpha = r.lockAlpha;
        if (r.img) n.ctx.putImageData(r.img, r.left, r.top);
      }
      Object.assign(n, { opacity: r.opacity, blend: ID_OF[r.blend] || 'normal', visible: r.visible, clip: r.clip });
      stack[stack.length - 1].push(n);
    }
    while (stack.length > 1) { const rest = stack.pop(); stack[stack.length - 1].push(...rest); } // 壊れた並びでも、レイヤーは残す
    doc.layers = stack[0];
    if (!doc.leafCount) doc.layers.push(new Layer(w, h, 'レイヤー 1'));
  }
  return doc;
}
