// ドキュメント: キャンバスの大きさとレイヤー(下 → 上の順)。レイヤーは1枚ずつ、ドキュメントと同じ大きさの絵を持つ。
// グループ(Group)は、レイヤーやグループをまとめたもの(children も下 → 上の順)。グループは絵を持たない

export function createCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// 合成モード: [id, 名前, キャンバスの合成, PSD のキー]。名前と並びは Photoshop / クリスタに合わせる
export const BLENDS = [
  ['normal', '通常', 'source-over', 'norm'],
  ['darken', '比較(暗)', 'darken', 'dark'],
  ['multiply', '乗算', 'multiply', 'mul '],
  ['color-burn', '焼き込みカラー', 'color-burn', 'idiv'],
  ['lighten', '比較(明)', 'lighten', 'lite'],
  ['screen', 'スクリーン', 'screen', 'scrn'],
  ['color-dodge', '覆い焼きカラー', 'color-dodge', 'div '],
  ['add', '加算(覆い焼きリニア)', 'lighter', 'lddg'],
  ['overlay', 'オーバーレイ', 'overlay', 'over'],
  ['soft-light', 'ソフトライト', 'soft-light', 'sLit'],
  ['hard-light', 'ハードライト', 'hard-light', 'hLit'],
  ['difference', '差の絶対値', 'difference', 'diff'],
  ['exclusion', '除外', 'exclusion', 'smud'],
  ['hue', '色相', 'hue', 'hue '],
  ['saturation', '彩度', 'saturation', 'sat '],
  ['color', 'カラー', 'color', 'colr'],
  ['luminosity', '輝度', 'luminosity', 'lum '],
];
const BLEND_OP = Object.fromEntries(BLENDS.map(([id, , op]) => [id, op]));

let nextId = 1;

export class Layer {
  constructor(w, h, name) {
    this.id = nextId++;
    this.name = name;
    this.canvas = createCanvas(w, h);
    this.ctx = this.canvas.getContext('2d');
    this.opacity = 1;
    this.blend = 'normal';
    this.visible = true;
    this.lockAlpha = false; // 透明な所には描けない(アルファロック)
    this.clip = false; // 下のレイヤー(かグループ)でクリッピング(マスクをクリップ)
    this.paper = false; // 用紙(いちばん下の白い紙)。「線との隙間」では絵として数えない
    this.locked = false; // ロック(描く・動かす・消す・削除ができない)
    this.text = null; // テキストのレイヤー: { str, font, size, bold, italic, color, x, y }(テキストツールで押すと、打ち直せる)
  }

  clone(name = this.name) {
    const l = new Layer(this.canvas.width, this.canvas.height, name);
    l.ctx.drawImage(this.canvas, 0, 0);
    l.opacity = this.opacity;
    l.blend = this.blend;
    l.visible = this.visible;
    l.lockAlpha = this.lockAlpha;
    l.clip = this.clip;
    l.paper = this.paper;
    l.locked = this.locked;
    l.text = this.text ? { ...this.text } : null;
    return l;
  }
}

export class Group {
  constructor(name) {
    this.id = nextId++;
    this.name = name;
    this.isGroup = true;
    this.children = [];
    this.opacity = 1;
    this.blend = 'normal';
    this.visible = true;
    this.clip = false;
    this.open = true; // レイヤーの一覧で、中身を開いて見せる
  }

  clone(name = this.name) {
    const g = new Group(name);
    g.children = this.children.map((c) => c.clone());
    g.opacity = this.opacity;
    g.blend = this.blend;
    g.visible = this.visible;
    g.clip = this.clip;
    g.open = this.open;
    return g;
  }
}

export class Doc {
  constructor(w, h, { background = '#ffffff', empty = false } = {}) {
    this.w = w;
    this.h = h;
    this.layers = [];
    this.guides = []; // ガイド: { axis: 'x'(縦の線)| 'y'(横の線), pos(px) }
    this.resetWork();
    if (empty) return;
    const paper = this.addLayer('用紙');
    paper.paper = true;
    if (background) {
      paper.ctx.fillStyle = background;
      paper.ctx.fillRect(0, 0, w, h);
    }
    this.activeId = this.addLayer('レイヤー 1').id;
  }

  // 作業用の絵(ドキュメントと同じ大きさ): 描いている最中の線・その表示・線を抜く型。大きさを変えたら、作り直す
  resetWork() {
    this.bufs = new Map(); // 合成の途中に使う絵(グループの深さごと)
    this.workOf = null; // 表示用の絵(workCanvas)が、このレイヤーと同じ絵になっている(tools.js のブラシ)
    this.strokeClean = false; // 線の絵(strokeCanvas)が、まっさら
    for (const k of ['strokeCanvas', 'workCanvas', 'maskCanvas']) this[k] = createCanvas(this.w, this.h);
  }

  // すべてのレイヤーとグループを順に(下 → 上。グループは中身の後)。fn(node, 入っている配列, 親のグループか null)
  walk(fn, list = this.layers, parent = null) {
    for (const n of [...list]) {
      if (n.isGroup) this.walk(fn, n.children, n);
      fn(n, list, parent);
    }
  }

  find(id) {
    let hit = null;
    this.walk((n) => { if (n.id === id) hit = n; });
    return hit;
  }

  // node が入っている配列と、親のグループ(いちばん外なら null)
  place(node) {
    let hit = null;
    this.walk((n, list, parent) => { if (n === node) hit = { list, parent, index: list.indexOf(n) }; });
    return hit;
  }

  get active() { return this.find(this.activeId); }
  indexOf(node) { return this.layers.indexOf(node); }

  // 絵を持つレイヤーの数
  get leafCount() {
    let n = 0;
    this.walk((x) => { if (!x.isGroup) n++; });
    return n;
  }

  // 今のレイヤー(かグループ)のすぐ上に足す
  addLayer(name, node = new Layer(this.w, this.h, name)) {
    const at = this.active && this.place(this.active);
    if (at) at.list.splice(at.index + 1, 0, node);
    else this.layers.push(node);
    this.activeId = node.id;
    return node;
  }

  nextName(base = 'レイヤー') {
    const used = new Set();
    this.walk((n) => used.add(n.name));
    let n = 1;
    while (used.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  buf(depth, key) {
    const k = depth + key;
    let c = this.bufs.get(k);
    if (!c) this.bufs.set(k, (c = createCanvas(this.w, this.h)));
    return c;
  }
}

// ドキュメントを ctx に合成する(ドキュメントの座標で描く。拡大・縮小は ctx の変形で)。
// sub = { layer, canvas }: そのレイヤーは canvas を代わりに使う(描いている最中の線を重ねた絵)。
// skipPaper: 用紙のレイヤーは描かない(絵だけがほしいとき)。
// グループ: 中身を1枚にまとめてから、グループの不透明度・合成モードで重ねる。
// クリッピング: 土台(レイヤーかグループ)と、その上に続く clip のものを1つにまとめてから重ねる(Photoshop・Procreate と同じ)
export function composite(ctx, doc, sub = null, skipPaper = false) {
  compositeList(ctx, doc, doc.layers, 0, sub, skipPaper);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// area(ドキュメントの四角)があれば、作業用の絵(グループ・クリップのかたまり)の仕事を、その中だけにする(描いている間の表示が、描いた所だけを描き直すとき。0.21.1)。
// そのときは、作業用の絵の area の外は古いままなので、ctx の側も area の中に切り抜いておくこと
function compositeList(ctx, doc, list, depth, sub, skipPaper, area = null) {
  const L = skipPaper ? list.filter((l) => !l.paper) : list;
  const clipA = (g) => { if (area) { g.save(); g.beginPath(); g.rect(area.x, area.y, area.w, area.h); g.clip(); } };
  const unclip = (g) => { if (area) g.restore(); };
  // node の絵(グループなら、中身をまとめた絵を key の作業用の絵に作る)
  const src = (node, key) => {
    if (!node.isGroup) return sub && sub.layer === node ? sub.canvas : node.canvas;
    const c = doc.buf(depth, key), g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    clipA(g);
    g.clearRect(0, 0, doc.w, doc.h);
    compositeList(g, doc, node.children, depth + 1, sub, skipPaper, area);
    unclip(g);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    return c;
  };
  for (let i = 0; i < L.length; i++) {
    const base = L[i];
    let j = i + 1;
    while (j < L.length && L[j].clip) j++;
    if (!base.visible) { i = j - 1; continue; }
    const baseImg = src(base, 'g');
    if (j === i + 1) {
      put(ctx, baseImg, base);
      continue;
    }
    const a = doc.buf(depth, 'a'), b = doc.buf(depth, 'b');
    const g = a.getContext('2d'), t = b.getContext('2d');
    clipA(g); clipA(t);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'copy';
    g.drawImage(baseImg, 0, 0);
    // クリップしたレイヤーは、土台の絵の「上にだけ」重ねる(source-atop)。土台の透明度は変えない。
    // (前は、土台の形に切り抜いてから、ふつうに重ねていた。半透明のふちでは、重ねた分だけ濃くなって、ふちが太く・濃く見えていた。0.16.0)
    for (let k = i + 1; k < j; k++) {
      const c = L[k];
      if (!c.visible) continue;
      const img = src(c, 'c');
      if (!BLEND_OP[c.blend] || BLEND_OP[c.blend] === 'source-over') {
        g.globalAlpha = c.opacity;
        g.globalCompositeOperation = 'source-atop';
        g.drawImage(img, 0, 0);
      } else {
        // 乗算など: いったん別の絵で重ねてから、土台の上にだけ戻す
        t.globalAlpha = 1;
        t.globalCompositeOperation = 'copy';
        t.drawImage(a, 0, 0);
        put(t, img, c);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-atop';
        g.drawImage(b, 0, 0);
      }
    }
    unclip(t); unclip(g);
    put(ctx, a, base);
    i = j - 1;
  }
}

function put(ctx, canvas, layer) {
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = BLEND_OP[layer.blend] || 'source-over';
  ctx.drawImage(canvas, 0, 0);
}

// 一番外の並びの一部(list)だけを ctx に合成する。sub は composite と同じ(描いている最中の線を重ねた絵)。
// 描いている間の表示(view.js の renderStroke)が、今のレイヤーのかたまりだけを毎回重ね直すのに使う
export function compositeNodes(ctx, doc, list, sub = null, area = null) {
  compositeList(ctx, doc, list, 0, sub, false, area);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// レイヤーやグループの並び(グループの中身など)だけを ctx に合成する
export function renderNodes(ctx, doc, list) {
  compositeList(ctx, doc, list, 1, null, false);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// 1枚にまとめた絵(書き出し・スポイト用)
export function flatten(doc) {
  const c = createCanvas(doc.w, doc.h);
  composite(c.getContext('2d'), doc);
  return c;
}
