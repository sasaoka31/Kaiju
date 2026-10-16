// レイヤーの操作(追加・グループ・複製・削除・並べ替え・結合・消去)。
// 履歴は「並び」(いちばん外の配列と、各グループの children)を前後で持つ
import { state, emit, requestRender } from './state.js';
import { Layer, Group, createCanvas, renderNodes } from './doc.js';
import { inheritClip } from './select.js';
import { say } from './messages.js';

function snapshot(doc) {
  const lists = [[doc, 'layers', [...doc.layers]]];
  doc.walk((n) => { if (n.isGroup) lists.push([n, 'children', [...n.children]]); });
  return { lists, activeId: doc.activeId };
}

function restore(doc, s) {
  for (const [owner, key, list] of s.lists) owner[key] = [...list];
  doc.activeId = s.activeId;
}

function structural(label, change) {
  const doc = state.doc;
  const before = snapshot(doc);
  if (change() === false) { restore(doc, before); return; }
  const after = snapshot(doc);
  state.history.push({ label, structure: true, undo: () => restore(doc, before), redo: () => restore(doc, after) });
  emit('layers');
  requestRender();
}

export function addLayer() {
  // 下にクリップしているレイヤーの間に作ったときは、新しいレイヤーも下にクリップする
  structural('新規レイヤー', () => { const doc = state.doc; inheritClip(doc, doc.addLayer(doc.nextName())); });
}

// 選んでいるレイヤー(まとめて選んでいれば、その全部)。下 → 上の順
export function selectedNodes() {
  const doc = state.doc, ids = new Set([doc.activeId, ...state.multi]);
  const out = [];
  doc.walk((n) => { if (ids.has(n.id)) out.push(n); });
  return out;
}

// 選んでいるレイヤーを、新しいグループに入れる。グループは1段だけ(グループの中にグループは作らない)
export function groupLayer() {
  const doc = state.doc, nodes = selectedNodes().filter((n) => !n.paper);
  if (!nodes.length) { say('paperNoGroup'); return; }
  if (nodes.some((n) => n.isGroup || doc.place(n).parent)) { say('noNestGroup'); return; }
  structural('グループにする', () => {
    const g = new Group(doc.nextName('グループ'));
    const top = nodes[nodes.length - 1];
    g.clip = nodes[0].clip; // クリッピングは、グループの方に引き継ぐ(グループごと下にクリップされる)
    doc.layers.splice(doc.layers.indexOf(top), 0, g); // いちばん上の、選んだレイヤーの所に置く
    for (const n of nodes) doc.layers.splice(doc.layers.indexOf(n), 1);
    g.children = nodes;
    doc.activeId = g.id;
    state.multi = [];
  });
}

// グループをほどく(中身を、グループのあった所に出す)
export function ungroupLayer() {
  const doc = state.doc, g = doc.active;
  if (!g?.isGroup) { say('needGroup'); return; }
  structural('グループを解除', () => {
    const at = doc.place(g);
    at.list.splice(at.index, 1, ...g.children);
    doc.activeId = (g.children[g.children.length - 1] || at.list[Math.max(0, at.index - 1)])?.id;
    if (!doc.activeId) return false;
  });
}

export function duplicateLayer() {
  const n = state.doc.active;
  if (n) structural('複製', () => { state.doc.addLayer(null, n.clone(n.name + ' のコピー')); });
}

export function deleteLayer() {
  const doc = state.doc, nodes = selectedNodes().filter((n) => !nodes_inside(n));
  if (!nodes.length) return;
  if (nodes.some((n) => n.locked)) { say('layerLocked'); return; }
  let leaves = 0;
  for (const n of nodes) doc.walk((x) => { if (!x.isGroup) leaves++; }, n.isGroup ? n.children : [n]);
  if (doc.leafCount - leaves < 1) { say('lastLayer'); return; }
  structural('削除', () => {
    let next = null;
    for (const n of nodes) {
      const at = doc.place(n);
      at.list.splice(at.index, 1);
      next = at.list[Math.max(0, at.index - 1)] || at.parent || doc.layers[doc.layers.length - 1];
    }
    doc.activeId = (doc.find(next?.id) || doc.layers[doc.layers.length - 1]).id;
    state.multi = [];
  });
}

// 選んでいるグループの中にあるか(グループごと消すときに、中身を2回数えないため)
function nodes_inside(n) {
  const p = state.doc.place(n).parent;
  return !!p && (p.id === state.doc.activeId || state.multi.includes(p.id));
}

// 上(dir = 1)・下(dir = -1)へ。となりが開いているグループなら中に入り、グループの端からは外に出る
export function moveLayer(dir) {
  const doc = state.doc, n = doc.active;
  if (!n) return;
  const at = doc.place(n);
  const j = at.index + dir;
  const out = j < 0 || j >= at.list.length;
  if (out && !at.parent) return;
  structural('順番', () => {
    at.list.splice(at.index, 1);
    if (out) {
      // グループの外へ: グループのすぐ上か下
      const up = doc.place(at.parent);
      up.list.splice(up.index + (dir > 0 ? 1 : 0), 0, n);
      return;
    }
    const next = at.list[dir > 0 ? at.index : at.index - 1]; // 抜いたあとの、となり
    if (next.isGroup && next.open && !n.paper && !n.isGroup) {
      if (dir > 0) next.children.unshift(n); // 上のグループの、いちばん下に入る
      else next.children.push(n); // 下のグループの、いちばん上に入る
    } else {
      at.list.splice(j, 0, n);
    }
  });
}

// 下のレイヤーと結合(見た目どおりに1枚にする)。グループを選んでいるときは、グループを1枚のレイヤーにする
export function mergeDown() {
  const doc = state.doc, top = doc.active;
  if (!top) return;
  const at = doc.place(top);
  if (top.locked || at.list[at.index - 1]?.locked) { say('layerLocked'); return; }
  if (top.isGroup) {
    structural('グループを結合', () => {
      const m = new Layer(doc.w, doc.h, top.name);
      Object.assign(m, { opacity: top.opacity, blend: top.blend, visible: top.visible, clip: top.clip });
      renderNodes(m.ctx, doc, top.children);
      at.list.splice(at.index, 1, m);
      doc.activeId = m.id;
    });
    return;
  }
  const below = at.list[at.index - 1];
  if (!below) { say('noBelow'); return; }
  if (below.isGroup) { say('noMergeGroup'); return; }
  structural('下のレイヤーと結合', () => {
    const m = new Layer(doc.w, doc.h, below.name);
    Object.assign(m, { blend: below.blend, clip: below.clip, visible: below.visible, paper: below.paper });
    m.ctx.globalAlpha = below.opacity;
    m.ctx.drawImage(below.canvas, 0, 0);
    if (top.visible) {
      m.ctx.globalAlpha = top.opacity;
      m.ctx.globalCompositeOperation = top.blend === 'normal' ? 'source-over' : top.blend === 'add' ? 'lighter' : top.blend;
      m.ctx.drawImage(top.canvas, 0, 0);
    }
    m.ctx.globalAlpha = 1;
    m.ctx.globalCompositeOperation = 'source-over';
    at.list.splice(at.index - 1, 2, m);
    doc.activeId = m.id;
  });
}

// レイヤーの中身を消す(Delete)
export function clearLayer() {
  const doc = state.doc, l = doc.active;
  if (!l) return;
  if (l.isGroup) { say('noClearGroup'); return; }
  if (l.locked) { say('layerLocked'); return; }
  const before = createCanvas(doc.w, doc.h);
  before.getContext('2d').drawImage(l.canvas, 0, 0);
  // 選択範囲があれば、その中だけを消す
  const sel = state.selection;
  const clear = () => {
    if (!sel) { l.ctx.clearRect(0, 0, doc.w, doc.h); return; }
    l.ctx.globalCompositeOperation = 'destination-out';
    l.ctx.drawImage(sel.mask, 0, 0);
    l.ctx.globalCompositeOperation = 'source-over';
  };
  clear();
  state.history.push({
    label: 'レイヤーを消去', layer: l,
    undo: () => { l.ctx.globalCompositeOperation = 'copy'; l.ctx.drawImage(before, 0, 0); l.ctx.globalCompositeOperation = 'source-over'; },
    redo: clear,
  });
  requestRender();
}

// キャンバスを、rect の範囲に切り抜く(全部のレイヤー。元に戻せる)
export function cropDoc(rect) {
  const doc = state.doc;
  const x = Math.max(0, Math.round(rect.x)), y = Math.max(0, Math.round(rect.y));
  const w = Math.min(doc.w, Math.round(rect.x + rect.w)) - x, h = Math.min(doc.h, Math.round(rect.y + rect.h)) - y;
  if (w < 2 || h < 2 || (w === doc.w && h === doc.h)) return false;
  const shot = (cw, ch, make) => {
    const s = { w: cw, h: ch, canvas: new Map(), text: new Map(), guides: null };
    doc.walk((n) => { if (!n.isGroup) { s.canvas.set(n, make(n)); s.text.set(n, n.text); } });
    return s;
  };
  const before = shot(doc.w, doc.h, (n) => n.canvas);
  before.guides = doc.guides;
  const after = shot(w, h, (n) => { const c = createCanvas(w, h); c.getContext('2d').drawImage(n.canvas, -x, -y); return c; });
  after.guides = doc.guides.map((g) => ({ ...g, pos: g.pos - (g.axis === 'x' ? x : y) })).filter((g) => g.pos >= 0 && g.pos <= (g.axis === 'x' ? w : h));
  for (const [n, t] of before.text) after.text.set(n, t ? { ...t, x: t.x - x, y: t.y - y } : null);
  const apply = (s) => {
    doc.w = s.w;
    doc.h = s.h;
    for (const [n, c] of s.canvas) { n.canvas = c; n.ctx = c.getContext('2d'); n.text = s.text.get(n); }
    doc.resetWork();
    doc.guides = s.guides;
    state.selection = null;
    state.crop = null;
    state.stroke = null;
    state.cloneSrc = state.cloneOff = null;
    emit('selection');
    emit('crop');
    emit('title');
    state.view.fit();
  };
  apply(after);
  state.history.push({ label: '切り抜き', structure: true, undo: () => apply(before), redo: () => apply(after) });
  emit('layers');
  requestRender();
  return true;
}

// 不透明度・合成モード・表示などを変える(履歴には入れない)
export function setLayerProp(layer, key, value) {
  layer[key] = value;
  state.dirty = true;
  emit('layers');
  emit('title');
  requestRender();
}

// レイヤーをつかんで動かす(一覧でのドラッグ)。nodes を、target のすぐ上('above')・すぐ下('below')・グループの中('into')へ
export function moveNodes(nodes, target, where) {
  const doc = state.doc;
  nodes = nodes.filter((n) => !n.paper && n !== target);
  if (!nodes.length || target.paper && where === 'below') return;
  const intoGroup = where === 'into' ? target : doc.place(target).parent;
  if (intoGroup && nodes.some((n) => n.isGroup)) { say('noGroupInGroup'); return; }
  if (nodes.includes(intoGroup)) return;
  structural('順番', () => {
    for (const n of nodes) { const at = doc.place(n); at.list.splice(at.index, 1); }
    if (where === 'into') { target.children.push(...nodes); target.open = true; return; }
    const at = doc.place(target);
    at.list.splice(at.index + (where === 'above' ? 1 : 0), 0, ...nodes);
  });
}

// レイヤーを選ぶ。add = true なら、今の選択に足す(まとめて選ぶ)
export function setActive(id, add = false) {
  const doc = state.doc;
  if (add) {
    const ids = new Set([doc.activeId, ...state.multi]);
    ids.add(id);
    state.multi = [...ids].filter((x) => x !== id);
  } else {
    state.multi = [];
  }
  doc.activeId = id;
  emit('layers');
}
