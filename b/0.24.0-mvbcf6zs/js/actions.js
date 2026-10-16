// 上のバーに並べられるボタンの一覧。id は app.js のアクション名(tool: true のものは、ツールの切り替え)。
// icon は 24×24 の SVG の中身(線で描く)。png は Kodai で描いたアイコン(src/icons/ の黒い絵。文字の色で塗る)。text があれば、絵の代わりに文字のボタン。sep は区切りの線。
// state.topbar に id を並べたものが、上のバーになる(設定で変えられる)
export const ACTIONS = {
  save: { label: '保存', hint: 'Ctrl+S。PSD で保存(前に保存したファイルがあれば、上書き)', icon: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>' },
  move: { label: '移動・変形', hint: 'V(Ctrl+T でも)。今のレイヤー(選択範囲があれば、その中)の絵を、動かす・大きさを変える・回す', tool: true, icon: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>' },
  select: { label: '選択', hint: 'M = 四角 / L = なぞって囲む。囲んだ所だけ塗る・動かす・コピーする。もう一度押すと、なぞって囲む / 四角 を切り替え。タップで解除', tool: true, icon: '<path d="M12 4c5 0 8.5 2.2 8.5 5.2S17 14.5 12 14.5c-1.2 0-2.3-.1-3.3-.4" stroke-dasharray="2.6 2.2"/><path d="M8.7 14.1C5.6 13.3 3.5 11.5 3.5 9.2 3.5 6.2 7 4 12 4" stroke-dasharray="2.6 2.2"/><path d="M8.5 14.5c1.5 1 1.5 3-.5 3.5s-2.500-1.500-1-2.500 3 .5 2.500 2.500-1.500 2.500-3 3"/>' },
  hsb: { label: '色相・彩度・明るさ', hint: 'Ctrl+U。今のレイヤー(選択範囲があれば、その中)の色を変える', icon: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>' },
  canvasCopy: { label: 'キャンバスのコピー', hint: 'Ctrl+Alt+Shift+E。今見えている絵を1枚にまとめて、新しいレイヤーとして足す', icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 15l4.500-4.500 4 4 3-3 4.500 4.500"/><circle cx="15.500" cy="8.500" r="1.300"/>' },
  copy: { label: 'コピー', hint: 'Ctrl+C。今のレイヤー(選択範囲があれば、その中)をコピー', icon: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>' },
  paste: { label: 'ペースト', hint: 'Ctrl+V。コピーしたものを、新しいレイヤーとして貼る', icon: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 13h6M9 17h4"/>' },
  sharpen: { label: 'シャープ', hint: '今のレイヤー(選択範囲があれば、その中)の輪郭を、くっきりさせる', png: 'icons/sharpen.png' },
  noise: { label: 'ノイズ', hint: '今のレイヤー(選択範囲があれば、その中)に、ざらざらを足す', png: 'icons/noise.png' },
  sep: { label: '区切りの線', sep: true },
  // ここから下は、はじめは並んでいない(「そのほかの機能」から使える。レイアウトで、バーに足せる)
  shape: { label: '図形', hint: 'U。四角・楕円・直線・三角を描く。もう一度押すと、設定', tool: true, opts: true, icon: '<rect x="3.500" y="4" width="10" height="10" rx="1"/><circle cx="15.500" cy="15.500" r="5.500"/>' },
  gradient: { label: 'グラデーション', hint: 'G(バケツと交代)。押した所から離した所へ、色をなめらかに変えて塗る。もう一度押すと、設定', tool: true, opts: true, icon: '<rect x="3.500" y="5" width="17" height="14" rx="2"/><path d="M7 5v14M10.500 5v14M14 5v14" stroke-width="2.600" opacity=".55"/>' },
  smudge: { label: '指先', hint: 'なぞった向きに、絵をのばす。もう一度押すと、設定', tool: true, opts: true, icon: '<path d="M9 21v-9.500a1.800 1.800 0 0 1 3.600 0V15l4.200.900a2.500 2.500 0 0 1 2 2.700L18.500 21"/><path d="M4 8c2-3 5-4.500 9-4.500"/>' },
  pattern: { label: '模様ペン', hint: '下の色に合わせて、線の色が変わるペン(下の色を少し暗く / 明るく、または、明るさだけ下の色に合わせる)。もう一度押すと、設定', tool: true, opts: true, png: 'icons/pattern-pen.png' },
  stamp: { label: 'スタンプ', hint: 'S。絵のほかの所を、写して描く。はじめに押した所(か、Alt を押しながら押した所)が、コピー元。もう一度押すと、設定', tool: true, opts: true, icon: '<path d="M9 4h6v4.500l2 3.500H7l2-3.500z"/><path d="M5 12h14v4H5zM5 20h14"/>' },
  text: { label: 'テキスト', hint: 'T。押した所に、文字を入れる', tool: true, icon: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>' },
  crop: { label: '切り抜き', hint: 'C。囲んだ範囲に、キャンバスを切り抜く', tool: true, icon: '<path d="M7 3v14h14M3 7h14v14"/>' },
  levels: { label: 'レベル補正', hint: 'Ctrl+L。明るさの幅(いちばん暗い所・中間・いちばん明るい所)を整える', icon: '<path d="M3 20h18M4 20V16M7 20v-7M10 20V8M13 20V5M16 20v-9M19 20v-4"/>' },
  quickMask: { label: 'マスクモード', hint: 'Q。入ると、描いた所が赤く出る。出ると、そこが選択範囲になる', icon: '<rect x="3.500" y="5" width="17" height="14" rx="2"/><circle cx="12" cy="12" r="4" stroke-dasharray="2.600 2.200"/>' },
  symmetry: { label: '対称モード', hint: '押すたびに、左右 → 上下 → 4方向 → なし。キャンバスのまん中を軸に、映した所にも描く', icon: '<path d="M12 3v18" stroke-dasharray="2.600 2.200"/><path d="M9 7 4 16h5zM15 7l5 9h-5z"/>' },
  grid: { label: 'グリッド表示', hint: "Ctrl+'。間隔は、ガイド設定で", icon: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M9.300 4v16M14.700 4v16M4 9.300h16M4 14.700h16"/>' },
  rulers: { label: '定規表示', hint: 'Ctrl+R。定規から持ってくると、ガイドができる', icon: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v3M11 8v4M15 8v3M19 8v2"/>' },
  guides: { label: 'ガイド設定', hint: 'ガイドを数字で足す・消す、グリッドの間隔', icon: '<path d="M8 3v18M3 15h18"/><circle cx="16.500" cy="8" r="2.500"/>' },
  cmyk: { label: '仮想 CMYK', hint: 'Ctrl+Y。印刷したときの色に近づけて見せる(見た目だけ。絵そのものは変わらない)', png: 'icons/cmyk.png' },
  placeImage: { label: '画像を埋め込む', hint: '画像のファイルを、新しいレイヤーとして置く', icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8.500 12.500 12 16l3.500-3.500"/>' },
  importBrush: { label: 'ブラシの読み込み', hint: 'Photoshop のブラシ(.abr)か画像から、ブラシを足す', icon: '<path d="M4 20c0-3 2-4 4-4s3 1 3 3-3 3-7 1z"/><path d="M17 4v8M13.500 8.500 17 12l3.500-3.500"/>' },
  flipLayerH: { label: 'レイヤーを左右反転', hint: '今のレイヤー(選択範囲があれば、その中)の絵そのものを、左右に反転する', png: 'icons/flip-h.png' },
  flipLayerV: { label: 'レイヤーを上下反転', hint: '今のレイヤー(選択範囲があれば、その中)の絵そのものを、上下に反転する', png: 'icons/flip-v.png' },
  selectAll: { label: 'すべてを選択', hint: 'Ctrl+A', icon: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2.600 2.200"/><path d="M8.500 12l2.500 2.500 4.500-5"/>' },
  invertSelection: { label: '選択範囲を反転', hint: 'Ctrl+Shift+I。選んでいない所を選ぶ', icon: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2.600 2.200"/><rect x="9" y="9" width="6" height="6" fill="currentColor"/>' },
  fillFg: { label: '描画色で塗りつぶす', hint: 'Alt+Backspace。今のレイヤー(選択範囲があれば、その中)を、描画色で塗る', png: 'icons/fill-fg.png' },
  fillBg: { label: '背景色で塗りつぶす', hint: 'Ctrl+Backspace', png: 'icons/fill-bg.png' },
  invertColors: { label: '階調の反転', hint: 'Ctrl+I。今のレイヤー(選択範囲があれば、その中)の色を、反対の色にする', png: 'icons/invert.png' },
  lockLayer: { label: 'レイヤーをロック', hint: 'Ctrl+/。描く・動かす・消す・削除ができなくなる', png: 'icons/lock.png' },
  blendToggle: { label: '重ね方の切り替え', hint: '今のレイヤーの重ね方を、通常 ⇄ 乗算 で切り替える(どの2つかは、設定で選べる)', png: 'icons/blend.png' },
  clipToggle: { label: 'マスクをクリップ', hint: 'Ctrl+Alt+G。今のレイヤーを、下のレイヤーにクリップする / やめる', png: 'icons/clip-down.png' },
  dupLayer: { label: 'レイヤーを複製', hint: 'Ctrl+J', png: 'icons/dup.png' },
  mergeDown: { label: '下のレイヤーと結合', hint: 'Ctrl+E', png: 'icons/merge.png' },
  deleteLayer: { label: 'レイヤーを削除', png: 'icons/trash.png' },
  groupLayer: { label: 'グループにする', hint: 'Ctrl+G', png: 'icons/folder.png' },
  charm: { label: 'チャーム', hint: 'ボタンの絵を、自分の好きな画像に変える(バーのつまみの絵も)', png: 'icons/ribbon.png' },
  shareSend: { label: '共有パックを送る', hint: '描いている絵と設定を、1つのファイルにして、ほかの端末へ(iCloud Drive・OneDrive・AirDrop など)', png: 'icons/share-send.png' },
  shareOpen: { label: '共有パックを開く', hint: 'ほかの端末から送った共有パックの、絵を開く・設定を入れる', png: 'icons/share-open.png' },
  checkUpdate: { label: '新しい版を確かめる', hint: '新しい版があれば、取ってきて入れ替える(iPad 版。保存していない絵があるときは、先に確かめる)', png: 'icons/update.png' },
  settings: { label: '設定', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100"/>' },
  flipView: { label: '左右反転して表示', hint: '見た目だけ。絵そのものは変わらない', icon: '<path d="M12 3v18"/><path d="M9.500 6.500v11L3 12z" fill="currentColor"/><path d="M14.500 6.500v11L21 12z" fill="currentColor"/>' },
  cut: { label: 'カット', hint: 'Ctrl+X。コピーして、元の絵を消す', icon: '<circle cx="6.500" cy="17.500" r="2.500"/><circle cx="17.500" cy="17.500" r="2.500"/><path d="M8.300 15.700 18 4M15.700 15.700 6 4"/>' },
  deselect: { label: '選択を解除', hint: 'Ctrl+D', icon: '<rect x="5" y="5" width="14" height="14" rx="1" stroke-dasharray="2.600 2.200"/><path d="M9 9l6 6M15 9l-6 6"/>' },
  undo: { label: '元に戻す', hint: 'Ctrl+Z', icon: '<path d="M9 7 4.500 11.500 9 16"/><path d="M4.500 11.500H14a5 5 0 0 1 0 10h-3"/>' },
  redo: { label: 'やり直し', hint: 'Ctrl+Shift+Z', icon: '<path d="M15 7l4.500 4.500L15 16"/><path d="M19.500 11.500H10a5 5 0 0 0 0 10h3"/>' },
  eyedropper: { label: 'スポイト', hint: 'I。押した所の色を拾う(ブラシのボタンの長押しでも)', tool: true, icon: '<path d="M4 20l1-4 9-9 3 3-9 9z"/><path d="M13 6l2-2a2.100 2.100 0 0 1 3 0l2 2a2.100 2.100 0 0 1 0 3l-2 2z" fill="currentColor"/>' },
  addLayer: { label: '新規レイヤー', hint: 'Ctrl+Shift+N', icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>' },
  clearLayer: { label: '消去', hint: 'Delete。レイヤーの中身(選択範囲があれば、その中)を消す', icon: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>' },
  exportPng: { label: 'PNG で書き出し', hint: 'Ctrl+Alt+Shift+W', icon: '<path d="M12 4v11M8 11l4 4 4-4M5 19h14"/>' },
  open: { label: '開く', hint: 'Ctrl+O', icon: '<path d="M4 7v11a1 1 0 0 0 1 1h13l2-8H7l-2 8"/><path d="M4 7a1 1 0 0 1 1-1h4l2 2h6a1 1 0 0 1 1 1v2"/>' },
  new: { label: '新規作成', hint: 'Ctrl+N', icon: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M12 11v6M9 14h6"/>' },
  fit: { label: '全体を表示', hint: 'Ctrl+0。回転も元に戻す', icon: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>' },
  resetRotation: { label: '角度を戻す', hint: '画面の回転を 0° に戻す', icon: '<path d="M5 12a7 7 0 1 0 2.300-5.200"/><path d="M4 4v4h4"/>' },
  hand: { label: '手のひら', hint: 'H。ドラッグで画面を動かす', tool: true, icon: '<path d="M8 12V6.500a1.500 1.500 0 0 1 3 0V11M11 11V5a1.500 1.500 0 0 1 3 0v6M14 11V6.500a1.500 1.500 0 0 1 3 0V12M17 12V9a1.500 1.500 0 0 1 3 0v5.500c0 4-2.500 6.500-6.500 6.500-3 0-4.600-1.200-6-3.500L5 13.600a1.500 1.500 0 0 1 2.400-1.800L8 12.600"/>' },
};

// 左のバーのツール(ここは決まった並び。この下に、色相・彩度・明るさのボタンが付く)
export const SIDE_TOOLS = [
  ['brush', 'ブラシ', 'B', '<path d="M4 20c0-3 2-4 4-4s3 1 3 3-3 3-7 1z" fill="currentColor" stroke="none"/><path d="M10.500 15.500 19 5a1.600 1.600 0 0 1 2.400 2.100L12.800 17.300"/>'],
  ['eraser', '消しゴム', 'E', '<path d="M4 15.500 13.500 6l6 6-8 8H8z"/><path d="M9.500 10l6 6M8 20h12"/>'],
  ['fill', 'バケツ', 'G', '<path d="M5 12.500 12 5.500l7 7-6 6a2 2 0 0 1-2.800 0L5 13.300z"/><path d="M9 3l3 3M5 12.800h13.500"/><path d="M20 16.500c1 1.600 1.400 2.300 1.400 3a1.400 1.400 0 0 1-2.800 0c0-.7.4-1.400 1.400-3z" fill="currentColor" stroke="none"/>'],
];

// トップバーとサイドバーに置けるもの(レイアウトで自由に並べる): 上のボタンぜんぶ + 左のバーのツール + ここの部品。
//   side = ブラシ・消しゴム・バケツ(もう一度押すと一覧 / 設定)、pop = 押すと出るウィンドウ、part = 1つだけある部品(バー)の id、
//   sideOnly = サイドバーにだけ置ける(縦のバー)、gap = すきま(残りの幅や高さを埋める)、action = 押したときのアクション(id とちがうとき)
export const ITEMS = {
  ...ACTIONS,
  ...Object.fromEntries(SIDE_TOOLS.map(([id, label, key, icon]) => [id, { label, hint: `${key}。もう一度押す(か長押し)で、${id === 'fill' ? '設定' : id === 'brush' ? 'ブラシの切り替えとスポイト' : '消しゴムの切り替え'}`, icon, side: true }])),
  layers: { label: 'レイヤー', pop: 'pop-layers', icon: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 20h10a2 2 0 0 0 2-2V8"/>' },
  color: { label: 'カラー', pop: 'pop-color', icon: '<circle cx="12" cy="12" r="8" fill="currentColor"/>' },
  size: { label: 'ブラシのサイズのバー', part: 'vs-size', sideOnly: true, icon: '<rect x="8" y="3" width="8" height="18" rx="4"/><path d="M9.500 9h5"/>' },
  opacity: { label: 'ブラシの不透明度のバー', part: 'vs-opacity', sideOnly: true, icon: '<rect x="8" y="3" width="8" height="18" rx="4"/><path d="M9.500 15h5"/>' },
  zoom: { label: 'キャンバスの拡大率', hint: '押すと、全体を表示(回転も元に戻る)', action: 'fit', text: '%' },
  more: { label: 'そのほかの機能', pop: 'pop-more', icon: '<circle cx="5.500" cy="12" r="1.600" fill="currentColor"/><circle cx="12" cy="12" r="1.600" fill="currentColor"/><circle cx="18.500" cy="12" r="1.600" fill="currentColor"/>' },
  gap: { label: 'すきま(のびる)', gap: true },
};

// ボタンの絵(Kodai で描いた png があれば、それを型にして文字の色で塗る。なければ SVG)
export const iconHtml = (a, size = 22) => (a.png ? `<i class="png-icon" style="--icon:url('${a.png}');width:${size}px;height:${size}px"></i>` : svg(a.icon, size));
export const svg = (icon, size = 22) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`;
