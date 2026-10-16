// エントリポイント: 初期化・ポインター / キーボード入力・メニューのアクション
import { state, on, emit, requestRender, currentBrush, DEFAULT_SIZES } from './state.js';
import { Doc } from './doc.js';
import { View, RULER } from './view.js';
import { tools } from './tools.js';
import { copyLayer, pasteLayer, copyCanvas, clearSelection, toggleMask, selectAll, invertSelection } from './select.js';
import { fillWith } from './tools2.js';
import { flipLayer, flipMove, canMove, flushMove } from './transform.js';
import { isAdjusting, invertColors } from './adjust.js';
import { settingsDialog, guidesDialog, charmDialog, layerCtlDialog } from './settingsdlg.js';
import * as layers from './layers.js';
import { initUI, swapColors, renameLayer, togglePop, closePops, closeAdjust, toggleBlend, toggleClip } from './ui.js';
import { toggleLayout, resetLayout } from './layout.js';
import { say } from './messages.js';
import { loadSettings, initSettings } from './prefs.js';
import { saveProject, openProject, exportPng, placeImage, importBrushes } from './io.js';
import { openModal, isModalOpen, alertModal } from './modal.js';
import { checkUpdate } from './update.js';
import { shareSend, shareOpen } from './share.js';
import './claude.js'; // Claude 連携の道具(window.kaiju.tool。Windows 版で、lib/claude.js が呼ぶ)

const canvas = document.getElementById('view');
const view = (state.view = new View(canvas));

state.history.onChange = (kind, entry) => {
  if (kind !== 'clear') state.dirty = true;
  if ((kind === 'undo' || kind === 'redo') && entry.structure) emit('layers');
  emit('history', kind, entry);
  emit('title');
  requestRender();
};

// ---- ドキュメント ----

function loadDocument(doc, path = null) {
  state.doc = doc;
  state.filePath = path;
  state.dirty = false;
  state.stroke = null;
  state.lastPoint = null;
  state.history.clear();
  view.fit();
  emit('doc');
  requestRender();
}

async function safe(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(err);
    await alertModal('エラー', err.message || String(err));
    return false;
  }
}

// 保存していない変更があれば確認。続けてよければ true
async function confirmUnsaved() {
  if (!state.dirty) return true;
  const { value } = await openModal({
    title: '保存されていない変更があります',
    body: '今の絵への変更を保存しますか?',
    buttons: [{ label: 'キャンセル', value: null }, { label: '保存しない', value: 'discard' }, { label: '保存', value: 'save', primary: true }],
  });
  if (value === 'save') return await safe(() => saveProject());
  return value === 'discard';
}

const MAX_SIZE = 8000;

async function newDocumentDialog() {
  if (!(await confirmUnsaved())) return;
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `
    <div class="presets"></div>
    <div class="row">
      <label>幅 <input type="number" id="nd-w" min="1" max="${MAX_SIZE}" value="${state.startSize.w}"> px</label>
      <label>高さ <input type="number" id="nd-h" min="1" max="${MAX_SIZE}" value="${state.startSize.h}"> px</label>
    </div>
    <label>用紙 <select id="nd-bg"><option value="#ffffff">白</option><option value="">透明</option></select></label>
    <div class="row preset-edit">
      <input type="text" id="nd-name" maxlength="16" placeholder="名前(なくてもよい)">
      <button type="button" id="nd-add" title="上の幅と高さを、よく使うサイズとして登録する">＋ このサイズを登録</button>
      <button type="button" id="nd-reset" title="よく使うサイズを、はじめの一覧に戻す">はじめに戻す</button>
    </div>
    <div class="opt-hint">上のボタンを押すと、そのサイズになります。ボタンの × で、登録を外せます。起動したときのサイズは、設定で変えられます。</div>`;
  const w = body.querySelector('#nd-w'), h = body.querySelector('#nd-h');
  const clampSize = (v) => Math.min(MAX_SIZE, Math.max(1, Math.round(Number(v)) || 1));
  // よく使うサイズ(state.sizePresets。登録・削除できる。この端末に覚える)
  const drawPresets = () => {
    const box = body.querySelector('.presets');
    box.textContent = '';
    state.sizePresets.forEach(([label, pw, ph], i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${label ? label + ' ' : ''}${pw}×${ph}`;
      b.onclick = () => { w.value = pw; h.value = ph; };
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.textContent = '×';
      x.title = 'このサイズの登録を外す';
      x.onclick = () => { state.sizePresets.splice(i, 1); emit('settings'); drawPresets(); };
      chip.append(b, x);
      box.append(chip);
    });
  };
  drawPresets();
  body.querySelector('#nd-add').onclick = () => {
    const pw = clampSize(w.value), ph = clampSize(h.value), label = body.querySelector('#nd-name').value.trim();
    if (!state.sizePresets.some((p) => p[1] === pw && p[2] === ph && p[0] === label)) state.sizePresets.push([label, pw, ph]);
    body.querySelector('#nd-name').value = '';
    emit('settings');
    drawPresets();
  };
  body.querySelector('#nd-reset').onclick = () => { state.sizePresets = structuredClone(DEFAULT_SIZES); emit('settings'); drawPresets(); };
  const { value } = await openModal({ title: '新規作成', body, width: 460, buttons: [{ label: 'キャンセル', value: null }, { label: '作成', value: 'ok', primary: true }] });
  if (value !== 'ok') return;
  loadDocument(new Doc(clampSize(w.value), clampSize(h.value), { background: body.querySelector('#nd-bg').value || null }));
}

async function openDialog() {
  if (!(await confirmUnsaved())) return;
  const r = await safe(() => openProject());
  if (r) loadDocument(r.doc, r.path);
}

// ---- ツール ----

function setTool(id) {
  if (!tools[id] || drag) return;
  if (id !== 'eyedropper') state.pickReturn = null;
  if (!['move', 'select', 'eyedropper', 'hand', 'zoom', 'crop', 'text'].includes(id)) state.lastDrawTool = id; // 移動・変形を終えたら、ここに戻る
  state.tool = id;
  // 切り抜き: 選択範囲があれば、その範囲から始める
  if (id === 'crop' && !state.crop && state.selection) { const s = state.selection; state.crop = { x: s.x, y: s.y, w: s.w, h: s.h }; }
  updateCursor();
  emit('tool');
  requestRender();
}

function updateCursor() {
  if (drag?.type === 'pan') canvas.style.cursor = 'grabbing';
  else if (spaceDown) canvas.style.cursor = 'grab';
  else if (altPick()) canvas.style.cursor = 'crosshair';
  else canvas.style.cursor = tools[state.tool].cursor;
}

function adjustBrush(dir) {
  const b = currentBrush();
  if (!b) return;
  // Photoshop と同じように、小さいときは細かく・大きいときは大きく変わる
  const step = b.size < 10 ? 1 : b.size < 50 ? 5 : b.size < 100 ? 10 : 25;
  b.size = Math.min(2000, Math.max(1, Math.round(b.size + dir * step)));
  emit('brush');
  requestRender();
}

// ---- アクション(ボタン・メニュー・ショートカット共通) ----

const actions = {
  new: newDocumentDialog,
  open: openDialog,
  save: () => safe(() => saveProject(false)),
  saveAs: () => safe(() => saveProject(true)),
  exportPng: () => safe(() => exportPng()),
  undo: () => state.history.undo(),
  redo: () => state.history.redo(),
  zoomIn: () => view.zoomStep(1),
  zoomOut: () => view.zoomStep(-1),
  fit: () => view.fit(),
  zoom100: () => view.setZoom(1),
  swapColors,
  defaultColors: () => { state.fg = '#000000'; state.bg = '#ffffff'; emit('color'); },
  addLayer: layers.addLayer,
  dupLayer: layers.duplicateLayer,
  deleteLayer: layers.deleteLayer,
  layerUp: () => layers.moveLayer(1),
  layerDown: () => layers.moveLayer(-1),
  mergeDown: layers.mergeDown,
  clearLayer: layers.clearLayer,
  copy: () => { copyLayer(); },
  cut: () => { if (copyLayer()) layers.clearLayer(); },
  paste: pasteLayer,
  canvasCopy: copyCanvas,
  deselect: clearSelection,
  hsb: () => togglePop('pop-hsb'),
  sharpen: () => togglePop('pop-sharpen'),
  noise: () => togglePop('pop-noise'),
  flipView: () => { view.setFlip(!view.flip); say(view.flip ? 'flipOn' : 'flipOff'); },
  settings: () => settingsDialog(),
  charm: () => charmDialog(),
  layerCtl: () => layerCtlDialog(),
  layout: () => toggleLayout(),
  levels: () => togglePop('pop-levels'),
  selectAll,
  invertSelection,
  invertColors,
  fillFg: () => fillWith(state.fg),
  fillBg: () => fillWith(state.bg),
  transform: () => setTool('move'),
  guidesShow: () => { state.showGuides = !state.showGuides; flags(); },
  alphaLock: () => { const l = state.doc.active; if (l && !l.isGroup) layers.setLayerProp(l, 'lockAlpha', !l.lockAlpha); },
  layerSelUp: () => stepLayer(1),
  layerSelDown: () => stepLayer(-1),
  popBrush: () => togglePop('pop-brush'),
  popColor: () => togglePop('pop-color'),
  popLayers: () => togglePop('pop-layers'),
  quickMask: toggleMask,
  symmetry: () => {
    state.symmetry = { off: 'x', x: 'y', y: 'xy', xy: 'off' }[state.symmetry];
    say({ x: 'symX', y: 'symY', xy: 'symXY', off: 'symOff' }[state.symmetry]);
    flags();
  },
  grid: () => { state.showGrid = !state.showGrid; say(state.showGrid ? 'gridOn' : 'gridOff'); flags(); },
  rulers: () => { state.showRulers = !state.showRulers; say(state.showRulers ? 'rulersOn' : 'rulersOff'); flags(); },
  cmyk: () => { state.cmyk = !state.cmyk; say(state.cmyk ? 'cmykOn' : 'cmykOff'); flags(); },
  guides: async () => { await guidesDialog(); flags(); },
  placeImage: () => safe(() => placeImage()),
  importBrush: () => safe(() => importBrushes()),
  // 移動・変形の帯: 反転(枠の中の絵を、その場で)・完了(選択を解除して、前の描くツールに戻る)
  moveFlipH: () => flipMove('h'),
  moveFlipV: () => flipMove('v'),
  moveDone: () => finishMove(),
  flipLayerH: () => flipLayer('h'),
  flipLayerV: () => flipLayer('v'),
  lockLayer: () => { const l = state.doc.active; if (!l) return; layers.setLayerProp(l, 'locked', !l.locked); say(l.locked ? 'lockOn' : 'lockOff'); },
  cropApply: () => { if (!state.crop) { say('cropNone'); return; } if (layers.cropDoc(state.crop)) say('cropDone'); },
  cropCancel: () => { state.crop = null; setTool('brush'); },
  layoutReset: () => resetLayout(),
  blendToggle: toggleBlend,
  clipToggle: toggleClip,
  resetRotation: () => view.setRotation(0),
  toggleFinger: () => { state.fingerDraw = !state.fingerDraw; emit('settings'); say(state.fingerDraw ? 'fingerOn' : 'fingerOff'); },
  groupLayer: layers.groupLayer,
  ungroupLayer: layers.ungroupLayer,
  renameLayer: () => renameLayer(),
  // 取扱説明書: Windows 版は別のウィンドウで、Web 版は別のタブで開く
  checkUpdate: () => checkUpdate(),
  // 共有パック(絵と設定を、ほかの端末へ)
  shareSend: () => shareSend().catch((e) => alertModal('エラー', e.message)),
  shareOpen: () => shareOpen().catch((e) => alertModal('エラー', e.message)),
  manual: () => (window.native ? window.native.openManual() : window.open('manual.html', '_blank')),
};

// 移動・変形を終わる: 選択を解除して、前に使っていた描くツールに戻る(キャンバスの外を押したとき・帯の「完了」)
function finishMove() {
  clearSelection();
  setTool(tools[state.lastDrawTool] ? state.lastDrawTool : 'brush');
}

// となりのレイヤーを選ぶ(dir = 1 で上、-1 で下。同じ並びの中で)
function stepLayer(dir) {
  const doc = state.doc, at = doc.active && doc.place(doc.active), next = at?.list[at.index + dir];
  if (next) layers.setActive(next.id);
}

// 表示の切り替え(グリッド・定規・対称・仮想 CMYK)を変えたあと: ボタンと画面を描き直して、設定を覚える
function flags() {
  emit('flags');
  emit('settings');
  requestRender();
}

function runAction(name) {
  if (isModalOpen() || !actions[name] || drag) return;
  // 自由変形・メッシュでゆがめた選択範囲は、要るときに作る(transform.js)。選択範囲を使うかもしれない操作の前に、作っておく
  if (!['undo', 'redo', 'moveFlipH', 'moveFlipV', 'moveDone', 'fit', 'zoom100', 'zoomIn', 'zoomOut', 'resetRotation', 'flipView'].includes(name)) flushMove();
  // 絵の調整(色相・彩度・明るさ / シャープ / ノイズ)の最中に、ほかの操作をしたら、調整はやめる(元の絵に戻す)
  if (isAdjusting() && !['hsb', 'sharpen', 'noise', 'levels', 'grid', 'rulers', 'cmyk', 'guides', 'fit', 'zoom100', 'zoomIn', 'zoomOut', 'resetRotation', 'flipView'].includes(name)) closeAdjust();
  actions[name]();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (b) runAction(b.dataset.action);
});

// ---- ポインター入力 ----

let drag = null; // { type: 'tool' | 'pan', ... }
let lastEv = null;
let spaceDown = false;
let altDown = false;
const altPick = () => altDown && !!currentBrush() && state.tool !== 'stamp'; // ブラシ・消しゴムの最中の Alt はスポイト(スタンプでは、コピー元を選ぶ)

function localPos(e) {
  const r = canvas.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}

// st = 手ぶれ補正に使う時刻(ms)。動作確認で作った点(isTrusted = false)は、時刻なし = 1/60 秒ごとに届いたものとして数える
function makeEv(e, st) {
  const { sx, sy } = localPos(e);
  const p = view.screenToDoc(sx, sy);
  return {
    x: p.x, y: p.y, sx, sy,
    p: e.pressure ?? 0, type: e.pointerType || 'mouse',
    shift: !!e.shiftKey, alt: !!e.altKey, ctrl: !!e.ctrlKey, t: e.timeStamp ?? performance.now(),
    st: e.isTrusted === false ? null : (st ?? e.timeStamp ?? null),
  };
}

canvas.addEventListener('pointerdown', (e) => {
  if (!state.doc) return;
  if (e.pointerType === 'touch') { touchDown(e); return; }
  if (drag || gesture) return;
  cancelPendingTouch(); // ペンで描き始めたら、先に触れていた手は無視する
  try { canvas.setPointerCapture(e.pointerId); } catch { /* つかめなくても続ける */ }
  beginDrag(e);
});

// ガイド: 定規から持ってくると、新しいガイド。移動ツールのときは、今あるガイドも持って動かせる。定規へ戻す(かキャンバスの外へ出す)と、消える
function guideAt(e) {
  const doc = state.doc;
  if (view.rot !== 0 || e.button > 0) return null;
  const { sx, sy } = localPos(e);
  if (state.showRulers && (sy < RULER || sx < RULER)) {
    const g = { axis: sy < RULER ? 'y' : 'x', pos: -1 }; // 上の定規からは横の線、左の定規からは縦の線
    doc.guides.push(g);
    state.showGuides = true;
    return g;
  }
  if (state.tool !== 'move' || !state.showGuides) return null;
  return doc.guides.find((g) => { const s = view.docToScreen(g.pos, g.pos); return Math.abs(g.axis === 'x' ? sx - s.x : sy - s.y) < 6; }) || null;
}

// キャンバスの長押しで、スポイト(ブラシ・模様ペンのとき。設定でオフにできる): 押したまま、動かさずに HOLD_PICK だけ待つと、
// 描きかけの点を捨てて、色を拾う。そのまま動かすと、動かした先の色。離すと、元のツールのまま
const HOLD_PICK = 500, HOLD_PICK_SLOP = 8;
let holdPick = null;
let lastSt = 0; // 前の点の時刻(手ぶれ補正用)
function clearHoldPick() { if (holdPick) { clearTimeout(holdPick.timer); holdPick = null; } }
// pan = 指で画面を動かしている最中(「指で描く」がオフのとき)。そのときも、動かさずに待てば、スポイトになる
function armHoldPick(ev, pan = false) {
  clearHoldPick();
  holdPick = { sx: ev.sx, sy: ev.sy, timer: setTimeout(() => {
    holdPick = null;
    if (!lastEv || !(pan ? drag?.type === 'pan' : drag?.type === 'tool' && drag.tool === tools[state.tool])) return;
    if (pan) { view.panning = false; drag = { type: 'tool', tool: tools.eyedropper }; }
    else { drag.tool.cancel?.(); drag.tool = tools.eyedropper; }
    tools.eyedropper.down(lastEv);
    state.picking = true;
    state.cursor = { x: lastEv.sx, y: lastEv.sy };
    requestRender();
  }, HOLD_PICK) };
}

function beginDrag(e) {
  // 指でキャンバスを押したとき、パネルは、描き始めるときに閉じる(2本指のタップ = 元に戻す では、閉じない)
  if (e.pointerType === 'touch') closePops();
  lastSt = e.timeStamp ?? 0;
  const guide = spaceDown ? null : guideAt(e);
  if (guide) { drag = { type: 'guide', guide }; return; }
  if (e.button === 1 || spaceDown || state.tool === 'hand') {
    drag = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
    view.panning = true;
    updateCursor();
    requestRender();
    return;
  }
  if (e.button !== 0 || isModalOpen()) return;
  e.preventDefault();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  if (isAdjusting()) { say('adjusting'); return; }
  const tool = e.altKey && currentBrush() && state.tool !== 'stamp' ? tools.eyedropper : tools[state.tool];
  const ev = makeEv(e);
  if (!tool.down(ev)) return;
  drag = { type: 'tool', tool };
  lastEv = ev;
  if (state.canvasHoldPick && tool === tools.brush && (state.tool === 'brush' || state.tool === 'pattern') && !state.maskMode) armHoldPick(ev);
  // スポイト: 押している間、拾った色の輪を出す
  if (tool === tools.eyedropper) { state.picking = true; state.cursor = { x: ev.sx, y: ev.sy }; }
}

// ---- タッチ(iPad など) ----
// 1本指 = 今のツール / 2本指 = 移動と拡大・縮小 / 2本指でタップ = 元に戻す / 3本指でタップ = やり直し
// マウスとペンは下のふつうの処理(ここは pointerType が touch のときだけ通る)。ペンで描いている最中の手のひらは無視する

const TOUCH_SLOP = 8;    // これより動いたら「なぞった」とみなす(px)
const TOUCH_WAIT = 120;  // 1本目の指は、この時間だけ描き始めるのを待つ(2本指の操作と見分けるため。ms)
const TAP_TIME = 350;    // 2本指・3本指のタップとみなす長さ(ms)
const touches = new Map(); // pointerId → { x, y }(今、画面に触れている指)
let pendingTouch = null;   // 描き始めるのを待っている1本目の指
let touchDragId = null;    // ツールを動かしている指(ペン・マウスのドラッグ中は null)
let gesture = null;        // 2本指の操作

function cancelPendingTouch() {
  if (!pendingTouch) return;
  clearTimeout(pendingTouch.timer);
  touches.delete(pendingTouch.e.pointerId);
  pendingTouch = null;
}

function touchDown(e) {
  e.preventDefault();
  if (drag && touchDragId === null) return;
  if (e.isPrimary && !drag) touches.clear(); // 離したのを取りこぼしていても、ここでやり直す
  try { canvas.setPointerCapture(e.pointerId); } catch { /* つかめなくても続ける */ }
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 1 && !gesture) {
    // イベントはあとで読むと値が変わることがあるので、要るものだけ写しておく
    const down = {
      pointerId: e.pointerId, clientX: e.clientX, clientY: e.clientY, button: 0, pressure: e.pressure, pointerType: 'touch',
      shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, timeStamp: e.timeStamp, preventDefault() {},
    };
    pendingTouch = { e: down, x: e.clientX, y: e.clientY, timer: setTimeout(startPendingTouch, TOUCH_WAIT) };
    return;
  }
  // 2本目からの指: 描きかけならそこまでで終えて、移動と拡大・縮小に切り替える
  if (pendingTouch) { clearTimeout(pendingTouch.timer); pendingTouch = null; }
  if (drag) finishTouchDrag();
  if (touches.size >= 2) startGesture();
}

function startPendingTouch() {
  const p = pendingTouch;
  if (!p) return;
  clearTimeout(p.timer);
  pendingTouch = null;
  if (drag) return;
  touchDragId = p.e.pointerId;
  if (state.fingerDraw) beginDrag(p.e);
  else {
    // 指で描く = オフ: 指1本は画面の移動
    closePops();
    drag = { type: 'pan', sx: p.e.clientX, sy: p.e.clientY, ox: view.ox, oy: view.oy };
    view.panning = true;
    // 指で描かない設定でも、指の長押しで、スポイトは使える
    lastEv = makeEv(p.e);
    if (state.canvasHoldPick && (state.tool === 'brush' || state.tool === 'pattern') && !state.maskMode) armHoldPick(lastEv, true);
  }
  if (!drag) touchDragId = null;
}

function finishTouchDrag() {
  const t = touches.get(touchDragId);
  touchDragId = null;
  if (t) endDrag({ clientX: t.x, clientY: t.y, pressure: 0, pointerType: 'touch' });
}

function gesturePoint() {
  const [a, b] = [...touches.values()];
  const r = canvas.getBoundingClientRect();
  return { sx: (a.x + b.x) / 2 - r.left, sy: (a.y + b.y) / 2 - r.top, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), a: Math.atan2(b.y - a.y, b.x - a.x) };
}

const ROT_START = (5 * Math.PI) / 180; // 指の向きがこれより変わったら、回し始める(拡大だけしたいときに、少しずつ回ってしまわないように)

function startGesture() {
  const g = gesturePoint();
  const w = view.screenToDoc(g.sx, g.sy);
  gesture = {
    wx: w.x, wy: w.y, zoom: view.zoom, rot: view.rot, d: g.d, a: g.a, sx: g.sx, sy: g.sy, turning: false, slack: 0,
    t0: gesture?.t0 ?? performance.now(), moved: gesture?.moved ?? false, fingers: Math.max(gesture?.fingers ?? 0, touches.size),
  };
  view.panning = true;
  state.cursor = null;
  requestRender();
}

const SCRUB_TRAVEL = 160; // 3本指でこすったとみなす、動かした長さ(px。行ったり来たりの合計)

function moveGesture() {
  if (touches.size < 2) return;
  const G = gesture;
  if (touches.size >= 3 || G.three) {
    // 3本指でこする(行ったり来たり): 今のレイヤーの絵を消す(離したとき。レイヤーは残る)。この間、画面は動かさない
    G.three = true;
    if (touches.size < 3) return;
    const pts = [...touches.values()], cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    if (G.cx === undefined) { G.cx = cx; G.cy = cy; G.travel = 0; G.turns = 0; G.dir = 0; }
    const dx = cx - G.cx, dy = cy - G.cy, d = Math.hypot(dx, dy);
    if (d < 6) return;
    G.travel += d;
    // 向きが、逆になった回数(横になぞっているなら左右、縦なら上下)
    const dir = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * 2;
    if (G.dir && dir === -G.dir) G.turns++;
    G.dir = dir;
    G.cx = cx; G.cy = cy;
    if (G.travel > TOUCH_SLOP) G.moved = true;
    return;
  }
  const g = gesturePoint();
  // 回転: 指の向きの変化(-180°〜180° に直す)
  let da = g.a - G.a;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  // ほとんど動いていなければ、まだ何もしない(2本指のタップと見分ける)。その場でひねるだけでも「動いた」に数える
  if (!G.moved && Math.hypot(g.sx - G.sx, g.sy - G.sy) < TOUCH_SLOP && Math.abs(g.d - G.d) < TOUCH_SLOP && (Math.abs(da) * G.d) / 2 < TOUCH_SLOP) return;
  G.moved = true;
  if (!G.turning && Math.abs(da) > ROT_START) { G.turning = true; G.slack = Math.sign(da) * ROT_START; }
  let rot = G.turning ? G.rot + da - G.slack : G.rot;
  // 0° の近くでは、0° に吸いつく(設定の角度)
  const deg = (Math.atan2(Math.sin(rot), Math.cos(rot)) * 180) / Math.PI;
  if (state.rotSnap > 0 && Math.abs(deg) < state.rotSnap) rot = 0;
  // 指の間にあった絵の点が、指の間にあり続けるように
  view.place((G.zoom * g.d) / G.d, rot, G.wx, G.wy, g.sx, g.sy);
}

function touchMove(e) {
  const t = touches.get(e.pointerId);
  if (!t) return false;
  t.x = e.clientX;
  t.y = e.clientY;
  if (gesture) { moveGesture(); return false; }
  if (pendingTouch) {
    if (Math.hypot(e.clientX - pendingTouch.x, e.clientY - pendingTouch.y) < TOUCH_SLOP) return false;
    startPendingTouch();
  }
  return e.pointerId === touchDragId; // ツールを動かしている指だけ、下のふつうの処理へ
}

function touchUp(e) {
  if (!touches.has(e.pointerId)) return;
  // 「指で描く」がオフのとき: 選択・移動変形の最中に、指でキャンバスの外をタップしたら、まとめて完了
  if (pendingTouch?.e.pointerId === e.pointerId && !state.fingerDraw && (state.tool === 'move' || state.tool === 'select')) {
    const q = makeEv(pendingTouch.e), doc = state.doc;
    if (q.x < 0 || q.y < 0 || q.x > doc.w || q.y > doc.h) { cancelPendingTouch(); finishMove(); return; }
  }
  if (pendingTouch?.e.pointerId === e.pointerId) startPendingTouch(); // 動かさずに離した = タップ
  touches.delete(e.pointerId);
  if (gesture) {
    if (touches.size) return;
    const G = gesture;
    gesture = null;
    view.panning = false;
    if (e.type !== 'pointercancel' && G.three && G.travel >= SCRUB_TRAVEL && G.turns >= 1) { runAction('clearLayer'); say('scrubClear'); }
    else if (e.type !== 'pointercancel' && !G.moved && performance.now() - G.t0 < TAP_TIME) runAction(G.fingers >= 3 ? 'redo' : 'undo');
    requestRender();
    return;
  }
  if (e.pointerId !== touchDragId) return;
  touchDragId = null;
  endDrag(e);
  state.cursor = null; // 指を離したら、ブラシの丸は消す
  requestRender();
}

canvas.addEventListener('pointermove', (e) => {
  if (!state.doc) return;
  if (e.pointerType === 'touch' && !touchMove(e)) return;
  if (holdPick) { const q = localPos(e); if (Math.hypot(q.sx - holdPick.sx, q.sy - holdPick.sy) > HOLD_PICK_SLOP) clearHoldPick(); }
  if (drag?.type === 'pan') {
    view.pan(drag.ox + e.clientX - drag.sx, drag.oy + e.clientY - drag.sy);
    return;
  }
  if (drag?.type === 'guide') {
    const { sx, sy } = localPos(e), p = view.screenToDoc(sx, sy);
    drag.guide.pos = Math.round(drag.guide.axis === 'x' ? p.x : p.y);
    requestRender();
    return;
  }
  // 速く動かしたときは、間の点もまとめて届く(線がカクカクしない)
  const events = drag && e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  let ev;
  const list = events.length ? events : [e];
  for (const ce of list) {
    // まとめて届いた点の時刻が同じ(か、戻っている)ときは、1画面の間に等しく並んでいたものとして数える
    let st = ce.timeStamp ?? e.timeStamp ?? 0;
    if (!(st > lastSt)) st = lastSt + Math.max(1, 16.7 / list.length);
    lastSt = st;
    ev = makeEv(ce, st);
    if (holdPick && Math.hypot(ev.sx - holdPick.sx, ev.sy - holdPick.sy) > HOLD_PICK_SLOP) clearHoldPick();
    if (drag) drag.tool.move(ev);
  }
  lastEv = ev;
  state.cursor = { x: ev.sx, y: ev.sy };
  emit('cursor', ev);
  requestRender();
});

function endDrag(e) {
  clearHoldPick();
  if (!drag) return;
  const d = drag;
  drag = null;
  if (state.picking) { state.picking = false; emit('color'); }
  view.panning = false;
  if (d.type === 'guide') {
    const g = d.guide, { sx, sy } = localPos(e), doc = state.doc;
    const back = state.showRulers && (g.axis === 'y' ? sy < RULER : sx < RULER);
    if (back || g.pos < 0 || g.pos > (g.axis === 'x' ? doc.w : doc.h)) doc.guides.splice(doc.guides.indexOf(g), 1);
    state.dirty = true;
    emit('title');
  }
  if (d.type === 'tool') d.tool.up(makeEv(e));
  // ブラシのボタンの長押しで出したスポイト: 色を拾ったら、ブラシに戻る
  if (d.tool === tools.eyedropper && state.pickReturn) setTool(state.pickReturn);
  updateCursor();
  requestRender();
}

function pointerEnd(e) {
  if (e.pointerType === 'touch') touchUp(e);
  else endDrag(e);
}
canvas.addEventListener('pointerup', pointerEnd);
canvas.addEventListener('pointercancel', pointerEnd);
canvas.addEventListener('pointerleave', () => {
  if (drag) return;
  state.cursor = null;
  emit('cursor', null);
  requestRender();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ホイール: 拡大・縮小(ポインターの位置を中心に)。Shift = 横に、Ctrl = 縦に動かす
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!state.doc) return;
  const { sx, sy } = localPos(e);
  if (e.shiftKey) view.pan(view.ox - e.deltaY, view.oy);
  else if (e.ctrlKey) view.pan(view.ox, view.oy - e.deltaY);
  else view.zoomStep(e.deltaY < 0 ? 1 : -1, sx, sy);
}, { passive: false });

// ---- キーボード(Photoshop に合わせる) ----
// ツールのキー。同じキーに2つあるもの(G・M / L)は、Photoshop と同じ組み。G は、押すたびに バケツ ⇄ グラデーション
const TOOL_KEYS = { b: 'brush', e: 'eraser', s: 'stamp', i: 'eyedropper', v: 'move', h: 'hand', z: 'zoom', t: 'text', u: 'shape', c: 'crop' };

// Ctrl(Mac は ⌘)と一緒に押すキー。S- = Shift、A- = Alt も一緒
const CTRL_KEYS = {
  z: 'undo', 'S-z': 'redo', 'A-z': 'undo', y: 'cmyk',
  s: 'save', 'S-s': 'saveAs', o: 'open', n: 'new', 'S-n': 'addLayer', 'S-A-w': 'exportPng', 'S-A-s': 'exportPng', k: 'settings',
  c: 'copy', v: 'paste', x: 'cut', a: 'selectAll', d: 'deselect', 'S-i': 'invertSelection', t: 'transform',
  j: 'dupLayer', e: 'mergeDown', 'S-A-e': 'canvasCopy', g: 'groupLayer', 'S-g': 'ungroupLayer', 'A-g': 'clipToggle', '/': 'lockLayer', ']': 'layerUp', '[': 'layerDown',
  l: 'levels', u: 'hsb', i: 'invertColors', backspace: 'fillBg', delete: 'fillBg',
  r: 'rulers', "'": 'grid', '@': 'grid', ':': 'guidesShow',
  0: 'fit', 1: 'zoom100', '=': 'zoomIn', '+': 'zoomIn', ';': 'zoomIn', '-': 'zoomOut',
};
// Alt と一緒に押すキー / そのまま押すキー(F のキーは、ウィンドウを出す)
const ALT_KEYS = { backspace: 'fillFg', delete: 'fillFg', ']': 'layerSelUp', '[': 'layerSelDown' };
const PLAIN_KEYS = { q: 'quickMask', d: 'defaultColors', '/': 'alphaLock', delete: 'clearLayer', backspace: 'clearLayer', escape: 'deselect', f5: 'popBrush', f6: 'popColor', f7: 'popLayers' };

function isTextInput(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'color', 'button'].includes(el.type);
}

window.addEventListener('keydown', (e) => {
  if (isModalOpen() || isTextInput(e.target) || !state.doc) return;
  if (e.key === 'Alt') { e.preventDefault(); if (!altDown) { altDown = true; updateCursor(); } return; }
  // 文字と数字は、キーの場所で見る(Shift や Alt を押していても、同じキーとして読めるように)
  const k = /^Key[A-Z]$/.test(e.code || '') ? e.code[3].toLowerCase() : /^Digit[0-9]$/.test(e.code || '') ? e.code[5] : e.key.toLowerCase();
  if (e.ctrlKey || e.metaKey) {
    const name = CTRL_KEYS[(e.shiftKey ? 'S-' : '') + (e.altKey ? 'A-' : '') + k];
    if (name) { e.preventDefault(); runAction(name); }
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceDown) { spaceDown = true; updateCursor(); }
    return;
  }
  if (drag) return;
  if (e.altKey) {
    if (ALT_KEYS[k]) { e.preventDefault(); runAction(ALT_KEYS[k]); }
    return;
  }
  const b = currentBrush();
  if (!e.shiftKey && TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
  switch (k) {
    case 'g': setTool(state.tool === 'fill' ? 'gradient' : 'fill'); break; // バケツ ⇄ グラデーション
    case 'm': state.selectMode = 'rect'; setTool('select'); emit('settings'); break; // 四角で囲む
    case 'l': state.selectMode = 'lasso'; setTool('select'); emit('settings'); break; // なぞって囲む
    case 'x': swapColors(); break;
    case '[': case '{': case ']': case '}': {
      const dir = k === '[' || k === '{' ? -1 : 1;
      if (!e.shiftKey) adjustBrush(dir);
      else if (b) { b.hardness = Math.min(1, Math.max(0, Math.round((b.hardness + dir * 0.25) * 100) / 100)); emit('brush'); } // Shift: 硬さを 25% ずつ
      break;
    }
    case 'enter': if (state.tool !== 'crop') return; runAction('cropApply'); break;
    case 'f5': if (e.shiftKey) { runAction('fillFg'); break; } // Shift+F5: 塗りつぶし
    // fallthrough
    default:
      // 数字: ブラシの不透明度(1 = 10% … 9 = 90%、0 = 100%)。Shift を押していると、流量
      if (/^[0-9]$/.test(k) && b) { b[e.shiftKey ? 'flow' : 'opacity'] = k === '0' ? 1 : Number(k) / 10; emit('brush'); break; }
      if (e.shiftKey || !PLAIN_KEYS[k]) return;
      runAction(PLAIN_KEYS[k]);
  }
  e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceDown = false; updateCursor(); }
  if (e.key === 'Alt') { altDown = false; updateCursor(); }
});
window.addEventListener('blur', () => { spaceDown = false; altDown = false; updateCursor(); });

// ---- Electron 連携 ----

if (window.native) {
  window.native.getVersion().then((v) => { state.appVersion = v; emit('title'); });
  window.native.onMenu((action) => runAction(action));
  window.native.onRequestClose(async () => {
    if (isModalOpen()) return;
    if (await confirmUnsaved()) window.native.confirmClose();
  });
} else {
  // Web 版(iPad など): 版は index.html に書いてある(scripts/build-web.js)。Safari がページごと拡大するのを止める
  state.appVersion = document.documentElement.dataset.version || '';
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault());
  window.addEventListener('beforeunload', (e) => { if (state.dirty) e.preventDefault(); });
  // オフライン対応: 1回開くと、中身を端末に取っておく(web/sw.js)。次からは、ネットがなくても起動できる
  if ('serviceWorker' in navigator && document.documentElement.dataset.build) {
    navigator.serviceWorker.register(new URL('sw.js', location.href).href).then(() => navigator.serviceWorker.ready).then(() => {
      state.offlineReady = true;
      emit('title');
      let told = null;
      try { told = localStorage.getItem('kaiju.offline'); } catch { /* 覚えられなくても続ける */ }
      if (!told) { say('offlineReady'); try { localStorage.setItem('kaiju.offline', '1'); } catch { /* 同上 */ } }
    }).catch(() => { /* 取っておけなくても、ネットがあれば使える */ });
  }
}

// ---- 起動 ----

loadSettings();
initSettings();
initUI(setTool);
on('request-tool', (id) => setTool(id));
// 囲み終わったら、そのまま移動・変形へ(囲んだ中に、動かせる絵があるとき。設定でオフにできる)
on('selection-made', () => { if (state.selectToMove && state.tool === 'select' && canMove()) setTool('move'); });
on('move-done', finishMove);
on('open-settings', () => runAction('settings'));
on('claude-load-doc', (doc) => loadDocument(doc)); // Claude 連携の「新しい絵」
on('load-doc', ({ doc }) => loadDocument(doc)); // 共有パックの絵(share.js)
on('open-layer-ctl', () => runAction('layerCtl'));
on('color', () => requestRender());
loadDocument(new Doc(state.startSize.w, state.startSize.h));
setTool('brush');
