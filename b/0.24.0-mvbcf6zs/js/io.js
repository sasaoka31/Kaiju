// ファイル入出力。Electron では preload の window.native を使い、
// ブラウザ(iPad の Web 版)で開いた場合はダウンロード / ファイル選択で代用する。
//   保存の形式は2つ(設定で選ぶ。はじめは PSD):
//   .psd   = Photoshop の形式(psd.js)。Photoshop・クリスタなどで開ける
//   .kaiju = Kaiju のプロジェクト(JSON。レイヤーの絵は PNG)。名前を変える前の .kpaint(KODAI paint)も開ける
import { state, emit } from './state.js';
import { Doc, Layer, Group, flatten, createCanvas } from './doc.js';
import { parseAbr } from './abr.js';
import { settingsObject, storeSettings } from './prefs.js';
import { newLayerWith } from './select.js';
import { openModal, escapeHtml } from './modal.js';
import { writePsd, readPsd } from './psd.js';
import { say } from './messages.js';
import { kfolder, openFromFolder, exportFile, fileBlob } from './files.js';

const native = window.native || null;
const FILTERS = { psd: { name: 'Photoshop (PSD)', extensions: ['psd'] }, kaiju: { name: 'Kaiju プロジェクト', extensions: ['kaiju'] } };
// .json は、iPad の Safari が名前の後ろに足したもの(「名前.kaiju.json」)と、共有パック。中身で見分けるので、すべてのファイルも選べる
const OPEN_FILTER = [{ name: 'PSD / Kaiju プロジェクト', extensions: ['psd', 'kaiju', 'kpaint', 'json'] }, { name: 'すべてのファイル', extensions: ['*'] }];
const formatOf = (path) => (/\.psd$/i.test(path || '') ? 'psd' : /\.kaiju$/i.test(path || '') ? 'kaiju' : null);

export function fileName() {
  return state.filePath ? state.filePath.split(/[\\/]/).pop() : '無題';
}
const baseName = () => (state.filePath ? fileName().replace(/\.[^.]+$/, '') : '無題');

export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

const toBlob = (canvas) => new Promise((r) => canvas.toBlob(r, 'image/png'));

async function loadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

// レイヤーとグループを、保存する形に(グループは children を持つ)
function packNode(n, active) {
  const o = { name: n.name, opacity: n.opacity, blend: n.blend, visible: n.visible, clip: n.clip };
  if (n === active) o.active = true;
  if (n.isGroup) return { ...o, group: true, open: n.open, children: n.children.map((c) => packNode(c, active)) };
  return { ...o, lockAlpha: n.lockAlpha, paper: n.paper, locked: n.locked, text: n.text, png: n.canvas.toDataURL('image/png') };
}

async function unpackNode(d, doc, found) {
  let n;
  if (d.group) {
    n = new Group(d.name);
    n.open = d.open !== false;
    for (const c of d.children || []) n.children.push(await unpackNode(c, doc, found));
  } else {
    n = new Layer(doc.w, doc.h, d.name);
    n.lockAlpha = !!d.lockAlpha;
    n.paper = !!d.paper;
    n.locked = !!d.locked;
    n.text = d.text || null;
    n.ctx.drawImage(await loadImage(d.png), 0, 0);
  }
  Object.assign(n, { opacity: d.opacity ?? 1, blend: d.blend || 'normal', visible: d.visible !== false, clip: !!d.clip });
  if (d.active) found.active = n;
  return n;
}

// ドキュメントを、.kaiju の中身(JSON にできる形)に。共有パック(share.js)も使う
export function packDoc(doc) {
  return { app: 'Kaiju', format: 2, w: doc.w, h: doc.h, guides: doc.guides, layers: doc.layers.map((l) => packNode(l, doc.active)) };
}

// .kaiju の中身から、ドキュメントを作る。共有パック(share.js)も使う
export async function docFromProject(obj) {
  if (!obj || !['Kaiju', 'KODAI paint'].includes(obj.app) || !Array.isArray(obj.layers)) throw new Error('Kaiju のプロジェクトではありません');
  const doc = new Doc(obj.w, obj.h, { empty: true });
  const found = {};
  for (const d of obj.layers) doc.layers.push(await unpackNode(d, doc, found));
  if (Array.isArray(obj.guides)) doc.guides = obj.guides.filter((g) => (g.axis === 'x' || g.axis === 'y') && Number.isFinite(g.pos));
  doc.activeId = (found.active || doc.layers[obj.activeIndex] || doc.layers[doc.layers.length - 1]).id;
  markPaper(doc);
  return doc;
}

// 用紙の印がないファイル(PSD・前の版): いちばん下の「用紙」を用紙として扱う
function markPaper(doc) {
  if (!doc.layers.some((l) => l.paper) && doc.layers[0]?.name === '用紙' && !doc.layers[0].isGroup) doc.layers[0].paper = true;
}

// 設定の書き出し / 読み込み: バーの並び・ブラシ・よく使う色・メッセージの文言などを、1つのファイルにする。
// (取っておく用。iPad の Safari は、長く開かないと設定を消すことがある。Windows と iPad の間で、設定を移すのにも使える)
export async function exportSettings() {
  const text = JSON.stringify(settingsObject());
  if (native) {
    const p = await native.saveDialog({ title: '設定を書き出す', defaultPath: 'Kaiju の設定.json', filters: [{ name: 'Kaiju の設定', extensions: ['json'] }] });
    if (!p) return false;
    await native.writeText(p, text);
  } else {
    download('Kaiju の設定.json', new Blob([text], { type: 'application/json' }));
  }
  say('settingsExported');
  return true;
}

export async function importSettings() {
  const file = await readFile('設定を読み込む', ['json'], '.json,application/json');
  if (!file) return false;
  let s;
  try { s = JSON.parse(new TextDecoder().decode(file.bytes)); } catch { throw new Error('ファイルが壊れているか、形式が正しくありません'); }
  storeSettings(s);
  say('settingsImported');
  return true;
}

// 保存する名前と形式を聞く(ブラウザ版)。やめたら null
async function askName(name, format) {
  const body = document.createElement('div');
  body.className = 'form';
  body.innerHTML = `<label>名前 <input type="text" id="sv-name" value="${escapeHtml(name)}" maxlength="80"></label>
    <label>形式 <select id="sv-format"><option value="psd"${format === 'psd' ? ' selected' : ''}>PSD(Photoshop・クリスタなどで開ける)</option><option value="kaiju"${format === 'kaiju' ? ' selected' : ''}>Kaiju の形式(.kaiju)</option></select></label>
    <label>保存する所 <select id="sv-dest"><option value="folder"${state.webDest !== 'file' ? ' selected' : ''}>Kaiju フォルダ(iPad の中)</option><option value="file"${state.webDest === 'file' ? ' selected' : ''}>ファイルに書き出す</option></select></label>`;
  const { value } = await openModal({ title: '名前を付けて保存', body, width: 420, buttons: [{ label: 'キャンセル', value: null }, { label: '保存', value: 'ok', primary: true }] });
  if (value !== 'ok') return null;
  const clean = body.querySelector('#sv-name').value.trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\.(psd|kaiju)$/i, '');
  return { name: clean || name, format: body.querySelector('#sv-format').value, dest: body.querySelector('#sv-dest').value };
}

// ファイルを1つ選んで、中身を読む。→ { name, bytes } / やめたら null
async function readFile(title, extensions, accept) {
  if (native) {
    const path = await native.openDialog({ title, filters: [{ name: title, extensions }] });
    return path ? { name: path.split(/[\\/]/).pop(), bytes: await native.readBinary(path) } : null;
  }
  const file = await pickFile(accept);
  return file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null;
}

async function imageOf(file) {
  const type = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[file.name.split('.').pop().toLowerCase()] || 'image/png';
  const url = URL.createObjectURL(new Blob([file.bytes], { type }));
  try { return await loadImage(url); } catch { throw new Error('画像を読めませんでした'); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

// 画像を埋め込む: 画像のファイルを、新しいレイヤーとして置く(キャンバスより大きければ、収まるように小さくして、まん中に)。
// 置いたあとは、移動・変形のツールで、位置と大きさを決める
export async function placeImage() {
  const file = await readFile('画像を埋め込む', ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'], 'image/*');
  if (!file) return false;
  const img = await imageOf(file), doc = state.doc;
  const k = Math.min(1, doc.w / img.naturalWidth, doc.h / img.naturalHeight), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  newLayerWith(file.name.replace(/\.[^.]+$/, '').slice(0, 24) || '画像', (ctx) => ctx.drawImage(img, Math.round((doc.w - w) / 2), Math.round((doc.h - h) / 2), w, h), '画像を埋め込む');
  emit('request-tool', 'move');
  say('placed');
  return true;
}

// ブラシの形(濃さの並び)を、正方形の PNG(data URL)にする。大きいものは TIP px に縮める
const TIP = 256;
function tipUrl(gray, w, h) {
  const src = createCanvas(w, h), img = new ImageData(w, h);
  for (let i = 0; i < gray.length; i++) img.data[i * 4 + 3] = gray[i];
  src.getContext('2d').putImageData(img, 0, 0);
  const side = Math.min(TIP, Math.max(w, h)), k = side / Math.max(w, h);
  const c = createCanvas(side, side), x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, (side - w * k) / 2, (side - h * k) / 2, w * k, h * k);
  return c.toDataURL('image/png');
}

// ブラシを読み込む: Photoshop のブラシ(.abr)か、画像(暗い所ほど濃い形になる)。読み込んだブラシは、ブラシの一覧に足される
export async function importBrushes() {
  const file = await readFile('ブラシを読み込む', ['abr', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'], '.abr,image/*');
  if (!file) return 0;
  const base = file.name.replace(/\.[^.]+$/, '').slice(0, 16) || 'ブラシ';
  let tips;
  if (/\.abr$/i.test(file.name)) {
    tips = parseAbr(file.bytes, base).slice(0, 40);
    if (!tips.length) throw new Error('このファイルには、形を絵で持っているブラシがありませんでした(Photoshop の中で計算して作るブラシは、読み込めません)');
  } else {
    // 画像: 暗い所ほど濃い(白い紙に黒で描いた絵を、そのままブラシの形にできる)
    const img = await imageOf(file), k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = createCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round((255 - (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114)) * (d[i * 4 + 3] / 255));
    tips = [{ name: base, w, h, gray }];
  }
  const stamp = Date.now().toString(36);
  let last = null;
  tips.forEach((t, i) => {
    last = {
      id: `tip-${stamp}-${i}`, name: t.name.slice(0, 20), size: Math.min(200, Math.max(8, Math.max(t.w, t.h))), minSize: 0.5, opacity: 1, flow: 1, hardness: 1,
      spacing: 0.25, pSize: true, pFlow: false, grain: 0, smooth: 2, custom: true, marks: [], tip: tipUrl(t.gray, t.w, t.h),
    };
    state.brushes.push(last);
  });
  state.brushId.brush = last.id;
  emit('request-tool', 'brush');
  emit('brush');
  say('brushImported', { count: tips.length });
  return tips.length;
}

// 保存。前に保存した(か開いた)ファイルがあれば、同じ形式で上書き。なければ、設定の形式(はじめは PSD)で保存する
export async function saveProject(saveAs = false) {
  const doc = state.doc;
  let p = state.filePath;
  let format = (!saveAs && formatOf(p)) || state.saveFormat;
  let auto = false;
  if (native) {
    // 新しい絵の「保存」: 画面を出さずに、保存のフォルダ(設定で変えられる。lib/savedir.js)へ「無題_日付-時刻」の名前で
    if (!p && !saveAs && native.saveDir) {
      const d = new Date(), z = (n) => String(n).padStart(2, '0');
      p = await native.saveDir.autoPath(`無題_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`, format);
      auto = true;
    }
    if (!p || saveAs || !formatOf(p)) {
      const other = format === 'psd' ? 'kaiju' : 'psd';
      p = await native.saveDialog({ title: '保存', defaultPath: baseName() + '.' + format, filters: [FILTERS[format], FILTERS[other]] });
      if (!p) return false;
      format = formatOf(p) || format;
    }
  } else if (!p || saveAs) {
    // ブラウザ版(iPad など): 名前と形式を聞く(聞かないと、いつも同じ名前のファイルになってしまう)
    const asked = await askName(baseName(), format);
    if (!asked) return false;
    format = asked.format;
    p = asked.name + '.' + format;
    state.webDest = asked.dest; // 次の「保存」も、同じ所へ
  } else {
    p = baseName() + '.' + format;
  }
  let toFolder = false;
  if (format === 'psd') {
    const bytes = writePsd(doc);
    if (native) await native.writeBinary(p, bytes);
    else toFolder = await webSave(p, bytes);
  } else {
    const text = JSON.stringify(packDoc(doc));
    if (native) await native.writeText(p, text);
    else toFolder = await webSave(p, text);
  }
  state.filePath = p;
  state.dirty = false;
  emit('title');
  say(toFolder ? 'savedFolder' : auto ? 'savedAuto' : format === 'psd' ? 'savedPsdNote' : 'saved', { file: p });
  return true;
}

// iPad(ブラウザ)の保存: はじめは Kaiju フォルダ(files.js)へ。「ファイルに書き出す」を選んだときは、共有シート / ダウンロード。→ Kaiju フォルダに入れたら true
async function webSave(name, data) {
  if (state.webDest === 'file') {
    await exportFile(name, fileBlob(name, data), { download });
    return false;
  }
  await kfolder.write(name, data instanceof Uint8Array ? new Blob([data]) : data);
  return true;
}

// 読み込んだドキュメントとパスを返す(キャンセルなら null)
export async function openProject() {
  let bytes, path;
  if (native) {
    path = await native.openDialog({ title: '開く', filters: OPEN_FILTER });
    if (!path) return null;
    bytes = await native.readBinary(path);
  } else {
    // iPad: Kaiju フォルダの一覧から(「ファイルから開く…」で、「ファイル」アプリのものも。選べるファイルはしぼらない)
    const got = await openFromFolder({ pickFile, download });
    if (!got) return null;
    bytes = got.bytes;
    path = got.name.replace(/\.json$/i, ''); // Safari が足した .json は外す(次の保存の名前・形式のため)
  }
  let doc;
  if (String.fromCharCode(...bytes.subarray(0, 4)) === '8BPS') {
    doc = readPsd(bytes);
    doc.activeId = doc.layers[doc.layers.length - 1].id;
  } else {
    let obj;
    try { obj = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('PSD でも Kaiju のプロジェクトでもないか、ファイルが壊れています'); }
    // 共有パックを「開く」で開いたとき: 中の絵を開く(設定は入れない。設定も入れるときは「共有パックを開く」)
    if (obj && obj.app === 'Kaiju' && obj.kind === 'share') {
      if (!obj.project) throw new Error('この共有パックには、絵が入っていません(設定だけ)。「共有パックを開く」から入れてください');
      obj = obj.project;
      path = null;
    }
    doc = await docFromProject(obj);
  }
  markPaper(doc);
  return { doc, path };
}

export async function exportPng() {
  const blob = await toBlob(flatten(state.doc));
  const name = baseName() + '.png';
  if (native) {
    const p = await native.saveDialog({ title: 'PNG で書き出し', defaultPath: name, filters: [{ name: 'PNG 画像', extensions: ['png'] }] });
    if (!p) return false;
    await native.writeBinary(p, new Uint8Array(await blob.arrayBuffer()));
  } else {
    download(name, blob);
  }
  say('exported');
  return true;
}
