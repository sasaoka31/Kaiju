// アプリ全体の状態と簡易イベントバス
import { History } from './history.js';
import { BRUSHES } from './brush.js';

const listeners = {};

export function on(evt, fn) {
  (listeners[evt] ||= []).push(fn);
}

export function emit(evt, ...args) {
  for (const fn of listeners[evt] || []) fn(...args);
}

// 新規作成の「よく使うサイズ」の、はじめの一覧([名前, 幅, 高さ])
export const DEFAULT_SIZES = [['A4 縦 (350dpi)', 2894, 4093], ['B5 縦 (350dpi)', 2508, 3541], ['正方形', 2048, 2048], ['フル HD', 1920, 1080], ['イラスト', 2000, 1400], ['小さめ', 1200, 900]];

export const state = {
  doc: null,
  history: new History(),
  view: null,
  tool: 'brush',
  fg: '#000000', // 描画色
  bg: '#ffffff', // 背景色
  brushes: structuredClone(BRUSHES), // ブラシの設定(サイズなどを変えたら、ここに残る)
  brushId: { brush: 'pen', eraser: 'eraser-hard' }, // ツールごとに選んでいるブラシ
  fillTolerance: 32,
  multi: [], // まとめて選んでいるレイヤーの id(今のレイヤー doc.activeId のほかに)
  selection: null, // 選択範囲(select.js)
  selectDraft: null, // 作っている最中の選択範囲
  selectMode: 'lasso', // 選択ツールの形: 'lasso'(なぞって囲む)| 'rect'(四角)
  selectToMove: true, // 囲み終わったら、そのまま移動・変形にする(囲んだ中に絵があるとき)
  moveMode: 'scale', // 移動ツールの変形のしかた: 'scale'(拡縮・回転)| 'free'(自由変形)| 'mesh'(メッシュ)
  moveKeepRatio: true, // 角を持って大きさを変えるとき、縦横比を固定する
  lastDrawTool: 'brush', // 前に使っていた、描くツール(移動・変形を終えたら、ここに戻る)
  canvasHoldPick: true, // キャンバスを長押しで、スポイト(ブラシ・模様ペンのとき)
  colorWheel: 'square', // 色のパネルの形: 'square'(四角 + 色相のバー)| 'circle'(丸。まわりの輪が色相)
  colorUi: { extras: false, swatches: true, outline: false }, // outline = 描画色・背景色の四角の、白いふち // 色のパネル: 入れ替え・初期・色のコード・CMYK を出すか、履歴とよく使う色を開いているか
  theme: 'standard', // 画面の色合い: 'standard' | 'dark'(暗い)| 'black'(もっと暗い)
  iconSize: 'm', // 左のバーのボタンの大きさ: 's' | 'm' | 'l'
  webDest: 'folder', // iPad(ブラウザ)の保存する所: 'folder' = Kaiju フォルダ(files.js)| 'file' = ファイルに書き出す(名前を付けて保存で選ぶ。0.24.0)
  leftHanded: false, // 左利きモード(0.24.0): サイドバーを右の端に、右に固めたウィンドウを左の端に(左右を入れ替える)
  sizePresets: structuredClone(DEFAULT_SIZES), // 新規作成の、よく使うサイズ(登録・削除できる)
  startSize: { w: 2000, h: 1400 }, // 起動したときのキャンバスの大きさ(新規作成のはじめの値にもなる)
  smoothGain: 3, // 手ぶれ補正の強さ(全部のブラシの「手ぶれ補正」に掛ける倍率。0 = 補正なし)
  barStyle: 'pill', // サイズ・不透明度のバーの形: 'pill'(角丸のつまみ)| 'dango'(串団子。細い棒に、丸い玉)
  barCharm: null, // バーのつまみに入れる絵(チャーム。data URL。なければ null)
  // 色とデザイン: bar = バー(とタブ)の色、pop = タブだけ別の色、canvas = キャンバスのまわりの色、barImg / popImg = 敷く素材(data URL)、
  //   barTone / popTone = その素材の平均の色(文字の色を決めるのに使う)。null = 画面の色合いのまま
  look: { bar: null, pop: null, canvas: null, barImg: null, popImg: null, barTone: null, popTone: null },
  clipboard: null, // コピーした絵
  picking: false, // スポイトで、色を拾っている最中(輪を出す)
  pickReturn: null, // ブラシのボタンの長押しでスポイトにしたとき、色を拾ったあとに戻るツール
  holdPick: true, // ブラシのボタンの長押しで、スポイトにする(オフのときの長押しは、ブラシの一覧)
  fingerDraw: true, // 指で描く(オフにすると、指1本は画面の移動になる。ペンだけで描く)
  rotSnap: 8, // 画面の回転が、この角度(度)より 0° に近ければ、0° に吸いつく
  // ウィンドウ(ブラシ・バケツ・レイヤー・色)の出し方: mode = 'pop'(はじめ)| 'float'(小窓。x, y に位置)| 'dock'(右に固める)
  win: {},
  // 上のバーに並べるもの(actions.js の ITEMS の id。レイアウトで並びと中身を変えられる)
  topbar: ['save', 'sep', 'move', 'select', 'sep', 'copy', 'paste', 'canvasCopy', 'sep', 'sharpen', 'noise', 'more', 'gap', 'layers', 'color'],
  // 左のバーに並べるもの(同じく、レイアウトで変えられる)
  layoutCustom: false, // バーの並びを、自分で変えた(変えた並びは、アップデートしても、そのまま。prefs.js)
  sidebar: ['brush', 'pattern', 'eraser', 'fill', 'hsb', 'sep', 'size', 'opacity', 'undo', 'redo', 'gap', 'zoom', 'flipView'],
  // レイヤーのパネル: いつも出しておく合成モード2つ、ほかも選べるようにするか、隠してある項目を出すか
  blendFav: ['normal', 'multiply'],
  // props = 重ね方・不透明度・複製などの欄を開いているか、thumb = 左にスライドしたときに出る大きい絵の幅(px)
  layerUi: { allBlends: false, alphaLock: false, rename: false, upDown: false, ungroup: false, props: true, thumb: 96, onSelect: true }, // onSelect = レイヤーを選ぶと、その行に欄を出す
  // レイヤーの欄に出すものと、その並び(レイアウト →「レイヤーの欄…」)。出せるもの: opacity blend blendAll alphaLock rename dup up down ungroup clip merge clear lock delete
  layerCtl: ['opacity', 'blend', 'dup', 'lock', 'delete'],
  icons: {}, // チャーム: ボタンの絵を、自分で選んだ画像に変えたもの(ITEMS の id → data URL)
  lineGap: 0, // ブラシの「線との隙間」(px。0 = なし)。すでにある線から、この距離以内には色が乗らない(protect.js)
  lineGapSame: true, // 今の描画色と同じ色の所には、隙間をあけずにくっつく
  fillGap: 10, // バケツの隙間閉じ(px。0 = なし)。線の切れ目がこれより狭ければ、そこからもれない(線がくっついていなくても塗れる)
  fillExpand: 2, // バケツの「線へのはみ出し」(px)。塗る範囲をこれだけ広げて、線の下にもぐらせる
  fillRef: 'canvas', // バケツが境目にする絵: 'canvas'(見えている絵ぜんぶ)| 'layer'(今のレイヤーだけ)
  saveFormat: 'psd', // 保存の形式: 'psd'(はじめ)| 'kaiju'
  messages: {}, // 文言を変えたメッセージ(messages.js の id → 文言)
  recentColors: [], // 使った色の履歴(新しい順)
  palette: Array(30).fill(null), // よく使う色(自分で並べる。空いたマスは null)
  symmetry: 'off', // 対称: 'off' | 'x'(左右)| 'y'(上下)| 'xy'(4方向)。キャンバスのまん中が軸
  showGrid: false, gridSize: 100, // グリッド(px)
  showRulers: false, // 定規(上と左)。定規から持ってくると、ガイドができる
  showGuides: true, // ガイドを見せる
  cmyk: false, // 仮想 CMYK(印刷したときの色に近づけて見せる。見た目だけ)
  shape: { kind: 'rect', fill: true, width: 8 }, // 図形ツール: 'rect' | 'ellipse' | 'line' | 'triangle'
  gradient: { kind: 'linear', to: 'bg' }, // グラデーション: 'linear' | 'radial'、描画色から 'bg'(背景色)| 'clear'(透明)へ
  smudge: { strength: 60 }, // 指先ツールの強さ(%)
  // 模様ペン: mode = 'shade'(下の色を shade % だけ暗く − / 明るく + した色)| 'lum'(描画色の色みのまま、明るさだけ下の色に合わせる)、
  //   onlyPainted = 何も描いていない所には描かない
  pattern: { mode: 'shade', shade: -15, onlyPainted: true },
  text: { font: 'sans-serif', size: 80, bold: false, italic: false }, // テキストの、前に使った設定
  cloneSrc: null, cloneOff: null, // スタンプ: コピー元の点と、そこからのずれ
  crop: null, // 切り抜きツールで囲んだ範囲 { x, y, w, h }
  maskMode: null, // マスクモード(クイックマスク)の最中: { layer }。描いた所が、選択範囲になる
  filePath: null,
  dirty: false,
  cursor: null, // 画面座標(CSS px)のポインター位置。ブラシの丸を出す
  stroke: null, // 描いている最中の線 { layer, canvas }(表示はレイヤーの代わりに canvas を使う)
  lastPoint: null, // Shift+クリックで直線を引くための、前の線の終点
  appVersion: '',
  offlineReady: false, // Web 版: 中身を端末に取っておけた(ネットがなくても起動できる)
};

// スタンプ・指先・模様ペンは、ブラシで選んでいるブラシ(サイズ・硬さ)を使う
const BRUSH_OF = { stamp: 'brush', smudge: 'brush', pattern: 'brush' };

// 今のツールで使うブラシ(ブラシ・消しゴム・スタンプ・指先以外のツールでは null)
export function currentBrush() {
  const id = state.brushId[BRUSH_OF[state.tool] ?? state.tool];
  return id ? state.brushes.find((b) => b.id === id) : null;
}

export function requestRender() {
  state.view?.requestRender();
}

export function toast(msg) {
  emit('toast', msg);
}
