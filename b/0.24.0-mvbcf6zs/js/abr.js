// Photoshop のブラシのファイル(.abr)から、ブラシの形(濃さだけの絵)を取り出す。
//   読めるのは、形を絵で持っているブラシ(サンプルブラシ)。版 1・2 と、版 6 以上(samp のかたまり)。
//   Photoshop の中で計算して作る丸ブラシ・ブラシの動き方(散布・ゆらぎなど)の設定は、読まない
// → [{ name, w, h, gray(Uint8Array。255 = いちばん濃い) }]

function unpack(u8, dv, o, w, h, depth, compressed) {
  const bytes = depth >> 3, out = new Uint8Array(w * h);
  if (!compressed) {
    for (let i = 0; i < w * h; i++) out[i] = u8[o + i * bytes]; // 16bit は、上の桁だけ使う
    return out;
  }
  // 行ごとの長さ(u16)が先に並び、そのあとに PackBits
  let p = o + h * 2;
  const row = new Uint8Array(w * bytes);
  for (let y = 0; y < h; y++) {
    const end = p + dv.getUint16(o + y * 2);
    let at = 0;
    while (p < end && at < row.length) {
      const c = u8[p++];
      if (c < 128) { const k = Math.min(c + 1, row.length - at); row.set(u8.subarray(p, p + k), at); at += k; p += c + 1; }
      else if (c > 128) { const k = Math.min(257 - c, row.length - at); row.fill(u8[p], at, at + k); at += k; p++; }
    }
    p = end;
    for (let x = 0; x < w; x++) out[y * w + x] = row[x * bytes];
  }
  return out;
}

export function parseAbr(u8, baseName = 'ブラシ') {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const version = dv.getUint16(0), sub = dv.getUint16(2);
  const out = [];
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const add = (name, top, left, bottom, right, depth, compressed, o) => {
    const w = right - left, h = bottom - top;
    if (w < 1 || h < 1 || w > 8000 || h > 8000 || (depth !== 8 && depth !== 16)) return;
    out.push({ name, w, h, gray: unpack(u8, dv, o, w, h, depth, compressed) });
  };
  if (version === 1 || version === 2) {
    let o = 4;
    for (let i = 0; i < sub && o + 6 <= u8.length; i++) {
      const type = dv.getUint16(o), size = dv.getUint32(o + 2), next = o + 6 + size;
      if (type === 2) {
        let p = o + 6 + 4 + 2; // その他(4)・間隔(2)
        let name = `${baseName} ${out.length + 1}`;
        if (version === 2) {
          const n = dv.getUint32(p);
          p += 4;
          let s = '';
          for (let k = 0; k < n; k++) s += String.fromCharCode(dv.getUint16(p + k * 2));
          name = s.replace(/\0+$/, '') || name;
          p += n * 2;
        }
        p += 1 + 8; // アンチエイリアス(1)・範囲(短い形。2 × 4)
        add(name, dv.getInt32(p), dv.getInt32(p + 4), dv.getInt32(p + 8), dv.getInt32(p + 12), dv.getUint16(p + 16), u8[p + 18] === 1, p + 19);
      }
      o = next;
    }
  } else if (version >= 6 && (sub === 1 || sub === 2)) {
    let o = 4;
    while (o + 12 <= u8.length && tag(o) === '8BIM') {
      const key = tag(o + 4), len = dv.getUint32(o + 8), end = o + 12 + len;
      if (key === 'samp') {
        let p = o + 12;
        while (p + 4 < end && out.length < 200) {
          const size = dv.getUint32(p), next = p + 4 + Math.ceil(size / 4) * 4;
          const q = p + 4 + (sub === 1 ? 47 : 301);
          if (q + 19 <= u8.length) add(`${baseName} ${out.length + 1}`, dv.getInt32(q), dv.getInt32(q + 4), dv.getInt32(q + 8), dv.getInt32(q + 12), dv.getUint16(q + 16), u8[q + 18] === 1, q + 19);
          p = next;
        }
      }
      o = end;
    }
  } else {
    throw new Error('このブラシのファイルは、読めない形式です');
  }
  return out;
}
