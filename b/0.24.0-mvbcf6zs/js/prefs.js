// この PC(このブラウザ)に取っておく設定: ブラシ(作ったブラシ・変えた設定・固定したサイズ)、色、バケツと隙間の設定、バーの並び(レイアウト)
//
// **バーの並び(レイアウト)の決まり**: ユーザーが自分で変えた並び(state.layoutCustom = true)は、アップデートしても、こちらからは変えない。
//   - 変えていない人: いつも、その版のはじめの並び(新しいボタンが、はじめの並びに足されたら、そのまま出る)
//   - 変えた人: 並びはそのまま。新しく増えた機能は「そのほかの機能」とレイアウトの箱に出て、起動のときに1回だけ知らせる(state.knownItems と比べる)
//   はじめの並びを変えるときは、前の並びを OLD_LAYOUTS に足す(印のない前の設定が「変えていない」かどうかを、これで見分ける)
import { state, on } from './state.js';
import { BRUSHES } from './brush.js';
import { ITEMS } from './actions.js';

const KEY = 'kaiju.settings';
export const DEFAULT_TOPBAR = [...state.topbar];
export const DEFAULT_SIDEBAR = [...state.sidebar];
const FIELDS = ['brushId', 'lineGap', 'lineGapSame', 'fillTolerance', 'fillGap', 'fillExpand', 'fg', 'bg',
  'fingerDraw', 'holdPick', 'rotSnap', 'win', 'topbar', 'blendFav', 'layerUi', 'selectMode',
  'fillRef', 'saveFormat', 'messages', 'recentColors', 'palette', 'sidebar', 'layoutCustom',
  'showGrid', 'gridSize', 'showRulers', 'showGuides', 'cmyk', 'shape', 'gradient', 'smudge', 'text', 'pattern',
  'selectToMove', 'moveKeepRatio', 'canvasHoldPick', 'colorWheel', 'colorUi', 'theme', 'iconSize',
  'smoothGain', 'barStyle', 'barCharm', 'look', 'sizePresets', 'startSize', 'layerCtl', 'icons', 'leftHanded'];
const VERSION = 6; // 設定の版(5 = 0.12.0。バーの並びを変えたかどうかの印 layoutCustom と、知っている機能の一覧 knownItems を持つ / 6 = 0.14.0。模様ペンは、ブラシではなくツール)
// 前の版の、はじめの並び(トップバー + サイドバー)。これと同じなら、ユーザーは並びを変えていない
const SIDE = 'brush,eraser,fill,hsb,sep,size,opacity,undo,redo,gap,zoom,flipView';
const OLD_LAYOUTS = [
  ['save,move,select,hsb,canvasCopy,copy,paste', null], // 〜0.8
  ['save,sep,move,select,sep,copy,paste,canvasCopy,sep,sharpen,noise', null], // 0.9
  ['save,sep,move,select,sep,copy,paste,canvasCopy,sep,sharpen,noise,gap,layers,color', SIDE], // 0.10
  ['save,sep,move,select,sep,copy,paste,canvasCopy,sep,sharpen,noise,more,gap,layers,color', SIDE], // 0.11〜0.13(0.14 で、サイドバーのブラシの下に模様ペン)
];

export let newItems = []; // このアップデートで増えた機能(並びを変えた人に、起動のときに知らせる)

// 保存してある設定を、今の状態に入れる
export function applySettings(s) {
  newItems = [];
  for (const k of FIELDS) {
    if (s[k] === undefined) continue;
    // 項目の集まり(layerUi など)は、あとの版で足した項目が消えないよう、上書きではなく足し込む
    if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k])) Object.assign(state[k], s[k]);
    else state[k] = s[k];
  }
  // 印のない前の設定: はじめの並びのどれかと同じなら「変えていない」
  if (s.layoutCustom === undefined) {
    const top = (s.topbar || []).join(','), side = Array.isArray(s.sidebar) ? s.sidebar.join(',') : null;
    state.layoutCustom = !!s.topbar && !OLD_LAYOUTS.some(([t, sd]) => t === top && (side === null || sd === null || sd === side));
  }
  if (!state.layoutCustom) {
    state.topbar = [...DEFAULT_TOPBAR];
    state.sidebar = [...DEFAULT_SIDEBAR];
  } else {
    // 変えた並びは、そのまま使う。前の版の形だけ、今の形に直す(レイヤー・色のボタンは、0.9 まではいつも右はしにあった)
    if (!Array.isArray(s.sidebar)) {
      state.sidebar = [...DEFAULT_SIDEBAR];
      state.topbar = state.topbar.filter((id) => id === 'sep' || !state.sidebar.includes(id));
      if (!state.topbar.includes('layers')) state.topbar.push('gap', 'layers');
      if (!state.topbar.includes('color')) state.topbar.push('color');
    }
    // 増えた機能(前に知っていた一覧にないもの)。一覧がまだない前の設定では、知らせない
    if (Array.isArray(s.knownItems)) newItems = Object.keys(ITEMS).filter((id) => !s.knownItems.includes(id));
  }
  if (Array.isArray(s.brushes) && s.brushes.length) {
    // あとの版で足した初めからのブラシは、保存してある一覧にも足す
    // 0.13.0 だけにあった、ブラシとしての模様ペン(一覧の2本と、ブラシごとの設定)は外す(0.14.0 から、独立したツール)
    const saved = s.brushes.filter((b) => b.id !== 'pattern-shade' && b.id !== 'pattern-lum');
    for (const b of saved) { delete b.pattern; delete b.shade; }
    const ids = new Set(saved.map((b) => b.id));
    state.brushes = [...saved, ...structuredClone(BRUSHES.filter((b) => !ids.has(b.id)))];
  }
  for (const t of ['brush', 'eraser']) {
    if (!state.brushes.some((b) => b.id === state.brushId[t])) state.brushId[t] = state.brushes.find((b) => !!b.erase === (t === 'eraser')).id;
  }
}

export function loadSettings() {
  if (window.native?.smoke) return; // 動作確認のときは、いつも初期設定から
  let s;
  try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { s = null; }
  if (s) applySettings(s);
  // ブラウザに「この設定は、勝手に消さないで」と頼む(聞いてくれるとは限らない。Safari は、ホーム画面に追加したものだけ)
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* 頼めなくても続ける */ }
}

// 今の設定を、保存する形にする(設定の書き出しにも使う)
export function settingsObject() {
  const s = { app: 'Kaiju', kind: 'settings', v: VERSION, brushes: state.brushes, knownItems: Object.keys(ITEMS) };
  for (const k of FIELDS) s[k] = state[k];
  return s;
}

// 書き出した設定を読み込む(次に開いたときから効く。すぐ効かせるには、開き直す)
export function storeSettings(s) {
  if (!s || s.app !== 'Kaiju' || s.kind !== 'settings') throw new Error('Kaiju の設定のファイルではありません');
  clearTimeout(timer);
  frozen = true; // このあとの自動の保存で、読み込んだ設定を上書きしない
  localStorage.setItem(KEY, JSON.stringify(s));
}

let frozen = false;
let timer = 0;
export function saveSettings() {
  if (window.native?.smoke || frozen) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(settingsObject())); } catch { /* 保存できなくても描くのは続けられる */ }
  }, 400);
}

export function initSettings() {
  for (const evt of ['brush', 'tool', 'color', 'settings']) on(evt, saveSettings);
}
