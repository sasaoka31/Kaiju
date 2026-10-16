// 設定のダイアログ: 保存の形式、レイヤーのパネルに出すもの、操作(指で描く・回転)、メッセージの文言
import { state, emit } from './state.js';
import { MESSAGES } from './messages.js';
import { BLENDS } from './doc.js';
import { openModal, escapeHtml, alertModal } from './modal.js';
import { refreshUi } from './ui.js';
import { exportSettings, importSettings } from './io.js';


// 画像を選んで、小さくして、data URL にする(max = 長い辺の px。type = 'image/png'(透明を残す)| 'image/jpeg')。
// 戻り値 { url, tone(平均の色) }。選ばなければ null
function pickImage(max, type) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const one = document.createElement('canvas');
        one.width = one.height = 1;
        const o = one.getContext('2d');
        o.fillStyle = '#808080'; o.fillRect(0, 0, 1, 1);
        o.drawImage(c, 0, 0, 1, 1);
        const d = o.getImageData(0, 0, 1, 1).data;
        URL.revokeObjectURL(img.src);
        resolve({ url: c.toDataURL(type, 0.86), tone: '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('') });
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    };
    input.click();
  });
}

export async function settingsDialog() {
  const body = document.createElement('div');
  body.className = 'settings';

  // ---- ボタンの並び(レイアウトで変える) ----
  const secBar = document.createElement('section');
  secBar.innerHTML = `<h4>ボタンの並びと、設定の控え</h4>
    <div class="opt-hint">トップバーとサイドバーのボタンの位置は、メニュー →「レイアウト」で、持って動かして変えられます。自分で変えた並びは、アップデートしても、そのまま残ります。</div>
    <div class="two"><button type="button" id="st-export">設定を書き出す</button><button type="button" id="st-import">設定を読み込む</button></div>
    <div class="opt-hint">書き出したファイルには、ボタンの並び・ブラシ・よく使う色・メッセージの文言などが入ります。控えにしたり、ほかの端末に移したりできます。</div>`;
  secBar.querySelector('#st-export').onclick = () => exportSettings().catch((e) => alertModal('エラー', e.message));
  secBar.querySelector('#st-import').onclick = () => importSettings().catch((e) => alertModal('エラー', e.message));

  // ---- レイヤー ----
  const u = state.layerUi;
  const blendOptions = (cur) => BLENDS.map(([id, label]) => `<option value="${id}"${id === cur ? ' selected' : ''}>${label}</option>`).join('');
  const secLayer = document.createElement('section');
  secLayer.innerHTML = `<h4>レイヤーのパネル</h4>
    <div class="two" title="パネルの重ね方(合成モード)のボタンを押すたびに切り替わる、2つ">重ね方のボタンで切り替える2つ <select id="st-fav0">${blendOptions(state.blendFav[0])}</select><select id="st-fav1">${blendOptions(state.blendFav[1])}</select></div>
    <label class="check"><input type="checkbox" id="st-allBlends"${u.allBlends ? ' checked' : ''}>ほかの重ね方も、一覧から選べるようにする</label>
    <label class="check"><input type="checkbox" id="st-alphaLock"${u.alphaLock ? ' checked' : ''}>「アルファロック」を出す</label>
    <label class="check"><input type="checkbox" id="st-rename"${u.rename ? ' checked' : ''}>「名前」ボタンを出す(一覧をすばやく2回押しても変えられます)</label>
    <label class="check"><input type="checkbox" id="st-upDown"${u.upDown ? ' checked' : ''}>「▲ ▼」ボタンを出す(レイヤーを持って動かしても並べ替えられます)</label>
    <label class="check"><input type="checkbox" id="st-ungroup"${u.ungroup ? ' checked' : ''}>グループの「解除」ボタンを出す</label>`;

  // ---- 操作 ----
  const secTouch = document.createElement('section');
  secTouch.innerHTML = `<h4>操作</h4>
    <label class="check"><input type="checkbox" id="st-holdPick"${state.holdPick ? ' checked' : ''}>ブラシのボタンの長押しで、スポイトにする(ポインターがスポイトの形になる)</label>
    <label class="check"><input type="checkbox" id="st-canvasPick"${state.canvasHoldPick ? ' checked' : ''}>キャンバスの長押しで、スポイトにする(ブラシ・模様ペンのとき。押したまま動かさずに、少し待つ)</label>
    <label class="check"><input type="checkbox" id="st-selMove"${state.selectToMove ? ' checked' : ''}>囲み終わったら、そのまま移動・変形にする(囲んだ中に絵があるとき)</label>
    <label class="check"><input type="checkbox" id="st-finger"${state.fingerDraw ? ' checked' : ''}>指で描く(オフにすると、指1本は画面の移動。ペンだけで描く)</label>
    <label class="opt" title="全部のブラシの「手ぶれ補正」に掛ける倍率。大きいほど、線がなめらかになる(その分、遅れてついてくる)。0 にすると、補正なし"><span>手ぶれ補正の強さ</span><input type="range" id="st-smooth" min="0" max="20" value="${Math.round((state.smoothGain ?? 3) * 2)}"><em id="st-smooth-val"></em></label>
    <label class="opt" title="2本指で画面を回しているとき、0° からこの角度以内なら、自動で 0° に戻る。0 にすると戻らない"><span>回転が 0° に戻る角度</span><input type="range" id="st-snap" min="0" max="30" value="${state.rotSnap}"><em id="st-snap-val"></em></label>`;
  const snap = secTouch.querySelector('#st-snap'), snapVal = secTouch.querySelector('#st-snap-val');
  const showSnap = () => { snapVal.textContent = Number(snap.value) ? snap.value + '°' : 'なし'; };
  snap.oninput = showSnap;
  showSnap();
  const smooth = secTouch.querySelector('#st-smooth'), smoothVal = secTouch.querySelector('#st-smooth-val');
  const showSmooth = () => { smoothVal.textContent = Number(smooth.value) ? '×' + Number(smooth.value) / 2 : 'なし'; };
  smooth.oninput = showSmooth;
  showSmooth();

  // ---- 保存 ----
  const secSave = document.createElement('section');
  secSave.innerHTML = `<h4>保存</h4>
    <div class="two" title="保存ボタンを押したときの形式。前に保存した(か開いた)ファイルがあるときは、そのファイルの形式で上書きします">保存の形式 <select id="st-format">
      <option value="psd"${state.saveFormat === 'psd' ? ' selected' : ''}>PSD(Photoshop・クリスタなどで開ける)</option>
      <option value="kaiju"${state.saveFormat === 'kaiju' ? ' selected' : ''}>Kaiju の形式(.kaiju)</option></select></div>`;

  // 保存のフォルダ(lib/savedir.js。Windows 版だけ)。フォルダを変える・戻すは、その場で決まる(OK を待たない)
  const sv = window.native?.saveDir;
  if (sv) {
    secSave.innerHTML += `<div class="two save-dir-row" title="新しい絵の保存は、このフォルダに「無題_日付-時刻」の名前ですぐ保存します。書き出し・開くの画面も、このフォルダから始まります">保存のフォルダ <code id="st-saveDir" class="save-dir"></code></div>
      <div class="two"><span></span><span><button type="button" id="st-saveDirPick">フォルダを変える…</button><button type="button" id="st-saveDirReset">はじめのフォルダに戻す</button><button type="button" id="st-saveDirOpen">フォルダを開く</button></span></div>
      <div class="two" title="「開く」の画面で、はじめに見る場所">「開く」で、まず見る所 <select id="st-openFrom"><option value="saveDir">保存のフォルダ</option><option value="last">前に開いた所</option></select></div>`;
  }
  secSave.innerHTML += `<div class="two" title="Kaiju を起動したときに開く、新しいキャンバスの大きさ(新規作成のはじめの値にもなります)">起動したときのキャンバス 幅 <input type="number" id="st-startW" min="1" max="8000" value="${state.startSize.w}"> 高さ <input type="number" id="st-startH" min="1" max="8000" value="${state.startSize.h}"> px</div>`;

  // ---- メッセージ(画面の下に出る文言) ----
  const secMsg = document.createElement('section');
  secMsg.innerHTML = '<h4>メッセージ(画面の下に出る文言)</h4><details><summary>文言を変える(空のままなら、はじめの文言)</summary><div class="msgs"></div></details>';
  const msgs = secMsg.querySelector('.msgs');
  for (const [id, [label, text]] of Object.entries(MESSAGES)) {
    const row = document.createElement('label');
    row.className = 'msg';
    row.innerHTML = `<span>${escapeHtml(label)}</span><input type="text" data-msg="${id}" maxlength="80" placeholder="${escapeHtml(text)}" value="${escapeHtml(state.messages[id] || '')}">`;
    msgs.append(row);
  }

  // ---- 見た目 ----
  const opt = (list, cur) => list.map(([id, label]) => `<option value="${id}"${id === cur ? ' selected' : ''}>${label}</option>`).join('');
  const secLook = document.createElement('section');
  secLook.innerHTML = `<h4>見た目</h4>
    <div class="two" title="画面ぜんたいの色合い">画面の色合い <select id="st-theme">${opt([['standard', '標準'], ['dark', '暗い'], ['black', 'もっと暗い(黒)']], state.theme)}</select></div>
    <label class="check" title="サイドバー(ブラシ・サイズ・不透明度など)を右の端に、右に固めたウィンドウを左の端にする"><input type="checkbox" id="st-left"${state.leftHanded ? ' checked' : ''}>左利きモード(サイドバーを右に)</label>
    <div class="two" title="左のバーのボタン(ブラシ・消しゴムなど)の大きさ">左のバーのボタン <select id="st-icons">${opt([['s', '小'], ['m', '中'], ['l', '大']], state.iconSize)}</select></div>
    <div class="two" title="色のパネルの、色の選び方の形">色の選び方 <select id="st-wheel">${opt([['square', '四角'], ['circle', '丸(サークル)']], state.colorWheel)}</select></div>
    <label class="check"><input type="checkbox" id="st-colorExtra"${state.colorUi.extras ? ' checked' : ''}>色のパネルに、入れ替え(⇄)・初期・色のコード(#)・CMYK の数字を出す</label>
    <label class="check"><input type="checkbox" id="st-outline"${state.colorUi.outline ? ' checked' : ''}>色のパネルの、描画色・背景色の四角に、白いふちを付ける</label>
    <label class="opt" title="レイヤーを左にスライドしたときに出る、大きい絵の幅"><span>レイヤーの大きい絵</span><input type="range" id="st-thumb" min="48" max="220" value="${state.layerUi.thumb || 96}"><em id="st-thumb-val"></em></label>
    <h4>色とデザイン</h4>
    <div class="opt-hint">バー(上と左右)と、タブ(押すと出るパネル)の色を変えられます。タブは、決めなければバーと同じ色・同じ素材になります。素材は、用意した画像を敷きつめます(小さな柄の画像が向いています)。</div>
    <div class="look-rows"></div>
    <div class="two" title="サイズと不透明度のバーの形">バーの形 <select id="st-bar">${opt([['pill', '角丸のつまみ'], ['dango', '串団子(細い棒に、丸い玉)']], state.barStyle)}</select></div>
    <div class="two" title="バーのつまみ(玉)の代わりに出す絵。透明な所のある PNG が向いています">チャーム(つまみの絵) <button type="button" id="st-charm">画像を選ぶ</button><button type="button" id="st-charm-off">外す</button><i class="charm-view" id="st-charm-view"></i></div>`;
  // 色とデザインの控え(OK を押すまで、画面には入れない)
  const look = { ...state.look };
  let charm = state.barCharm;
  const rows = secLook.querySelector('.look-rows');
  const drawLook = () => {
    rows.textContent = '';
    const colorRow = (key, label, base) => {
      const r = document.createElement('div');
      r.className = 'two';
      r.innerHTML = `<label class="check"><input type="checkbox"${look[key] ? ' checked' : ''}>${label}</label><input type="color" value="${look[key] || base}"${look[key] ? '' : ' disabled'}>`;
      const [cb, col] = r.querySelectorAll('input');
      cb.onchange = () => { look[key] = cb.checked ? col.value : null; col.disabled = !cb.checked; };
      col.oninput = () => { look[key] = col.value; };
      rows.append(r);
    };
    const imgRow = (key, label) => {
      const r = document.createElement('div');
      r.className = 'two';
      r.innerHTML = `${label} <button type="button">画像を選ぶ</button><button type="button">外す</button><i class="charm-view"></i>`;
      const [pick, off] = r.querySelectorAll('button');
      r.querySelector('i').style.backgroundImage = look[key] ? `url("${look[key]}")` : 'none';
      pick.onclick = async () => { const im = await pickImage(512, 'image/jpeg'); if (im) { look[key] = im.url; look[key === 'barImg' ? 'barTone' : 'popTone'] = im.tone; drawLook(); } };
      off.onclick = () => { look[key] = null; drawLook(); };
      rows.append(r);
    };
    colorRow('bar', '全体(バーとタブ)の色を決める', '#1b1c1f');
    colorRow('pop', 'タブだけ、別の色にする', '#2a2c31');
    colorRow('canvas', 'キャンバスのまわりの色を決める', '#2a2b2f');
    imgRow('barImg', '素材(バー)');
    imgRow('popImg', '素材(タブだけ)');
  };
  drawLook();
  const charmView = secLook.querySelector('#st-charm-view');
  const showCharm = () => { charmView.style.backgroundImage = charm ? `url("${charm}")` : 'none'; };
  showCharm();
  secLook.querySelector('#st-charm').onclick = async () => { const im = await pickImage(128, 'image/png'); if (im) { charm = im.url; showCharm(); } };
  secLook.querySelector('#st-charm-off').onclick = () => { charm = null; showCharm(); };
  const thumb = secLook.querySelector('#st-thumb'), thumbVal = secLook.querySelector('#st-thumb-val');
  const showThumb = () => { thumbVal.textContent = thumb.value + ' px'; };
  thumb.oninput = showThumb;
  showThumb();

  body.append(secSave, secBar, secLook, secLayer, secTouch, secMsg);
  if (sv) {
    const show = (c) => { if (!c) return; secSave.querySelector('#st-saveDir').textContent = c.dir + (c.isDefault ? '(はじめのフォルダ)' : ''); secSave.querySelector('#st-openFrom').value = c.openFrom; };
    sv.get().then(show);
    secSave.querySelector('#st-saveDirPick').onclick = async () => show(await sv.pick());
    secSave.querySelector('#st-saveDirReset').onclick = async () => show(await sv.set({ resetDir: true }));
    secSave.querySelector('#st-saveDirOpen').onclick = () => sv.reveal();
  }
  const { value } = await openModal({ title: '設定', body, buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (value !== 'ok') return;
  const on = (id) => body.querySelector('#' + id).checked;
  state.saveFormat = body.querySelector('#st-format').value;
  if (sv) await sv.set({ openFrom: body.querySelector('#st-openFrom').value });
  const size = (id, was) => Math.min(8000, Math.max(1, Math.round(Number(body.querySelector(id).value)) || was));
  state.startSize = { w: size('#st-startW', state.startSize.w), h: size('#st-startH', state.startSize.h) };
  state.messages = {};
  for (const i of msgs.querySelectorAll('input')) if (i.value.trim()) state.messages[i.dataset.msg] = i.value.trim();
  state.blendFav = [body.querySelector('#st-fav0').value, body.querySelector('#st-fav1').value];
  state.layerUi = { ...state.layerUi, allBlends: on('st-allBlends'), alphaLock: on('st-alphaLock'), rename: on('st-rename'), upDown: on('st-upDown'), ungroup: on('st-ungroup'), thumb: Number(thumb.value) };
  state.smoothGain = Number(smooth.value) / 2;
  state.colorWheel = body.querySelector('#st-wheel').value;
  state.colorUi.outline = on('st-outline');
  state.barStyle = body.querySelector('#st-bar').value;
  state.barCharm = charm;
  state.look = look;
  state.fingerDraw = on('st-finger');
  state.holdPick = on('st-holdPick');
  state.canvasHoldPick = on('st-canvasPick');
  state.selectToMove = on('st-selMove');
  state.theme = body.querySelector('#st-theme').value;
  state.iconSize = body.querySelector('#st-icons').value;
  state.leftHanded = body.querySelector('#st-left').checked;
  state.colorUi.extras = on('st-colorExtra');
  state.rotSnap = Number(snap.value);
  refreshUi();
  emit('settings');
}

// チャーム: ボタンの絵を、自分の好きな画像に変える(state.icons)。バーのつまみの絵(state.barCharm)も、ここで選べる
export async function charmDialog() {
  const { ITEMS } = await import('./actions.js');
  const { itemIcon } = await import('./ui.js');
  const icons = { ...state.icons };
  let charm = state.barCharm;
  const body = document.createElement('div');
  body.className = 'settings';
  body.innerHTML = `<section><h4>ボタンの絵</h4>
      <div class="opt-hint">「画像を選ぶ」で、そのボタンの絵を、用意した画像に変えられます(まわりが透明な PNG が向いています)。「戻す」で、はじめの絵に戻ります。絵は、小さくして(96 px まで)、この端末に覚えます。</div>
      <div class="charm-list"></div></section>
    <section><h4>バーのつまみ(サイズ・不透明度)</h4>
      <div class="two">つまみの絵 <button type="button" id="ch-bar">画像を選ぶ</button><button type="button" id="ch-bar-off">戻す</button><i class="charm-view" id="ch-bar-view"></i></div></section>`;
  const list = body.querySelector('.charm-list');
  const draw = () => {
    list.textContent = '';
    for (const [id, a] of Object.entries(ITEMS)) {
      if (a.sep || a.gap || a.part || id === 'zoom' || id === 'color') continue;
      const row = document.createElement('div');
      row.className = 'charm-row';
      const was = state.icons;
      state.icons = icons; // 控えの絵で、見本を作る
      const icon = a.icon || a.png || icons[id] ? itemIcon(id, 22) : '';
      state.icons = was;
      row.innerHTML = `<i class="ci">${icon}</i><span>${escapeHtml(a.label)}</span><button type="button">画像を選ぶ</button><button type="button"${icons[id] ? '' : ' disabled'}>戻す</button>`;
      const [pick, off] = row.querySelectorAll('button');
      row.dataset.charm = id;
      pick.onclick = async () => { const im = await pickImage(96, 'image/png'); if (im) { icons[id] = im.url; draw(); } };
      off.onclick = () => { delete icons[id]; draw(); };
      list.append(row);
    }
  };
  draw();
  const view = body.querySelector('#ch-bar-view');
  const show = () => { view.style.backgroundImage = charm ? `url("${charm}")` : 'none'; };
  show();
  body.querySelector('#ch-bar').onclick = async () => { const im = await pickImage(128, 'image/png'); if (im) { charm = im.url; show(); } };
  body.querySelector('#ch-bar-off').onclick = () => { charm = null; show(); };
  const { value } = await openModal({ title: 'チャーム', body, width: 620, buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (value !== 'ok') return;
  state.icons = icons;
  state.barCharm = charm;
  refreshUi();
  emit('settings');
}

// レイヤーの欄: レイヤーを選んだとき(か、左にスライドしたとき)に、その行に出るもの。出すものと、並びを決める(state.layerCtl)
const CTL_ITEMS = [['opacity', '不透明度のバー'], ['blend', '重ね方の切り替え(2つ)'], ['blendAll', '重ね方の一覧(ぜんぶ)'], ['alphaLock', 'アルファロック'], ['rename', '名前'],
  ['dup', '複製'], ['up', '上へ ▲'], ['down', '下へ ▼'], ['ungroup', 'グループの解除'], ['clip', 'マスクをクリップ'], ['merge', '下のレイヤーと結合'], ['clear', '消去'], ['lock', 'ロック'], ['delete', '削除(ゴミ箱)']];
export async function layerCtlDialog() {
  let on = state.layerCtl.filter((id) => CTL_ITEMS.some(([k]) => k === id));
  const body = document.createElement('div');
  body.className = 'settings';
  body.innerHTML = `<section><h4>レイヤーの欄</h4>
      <label class="check"><input type="checkbox" id="lc-select"${state.layerUi.onSelect !== false ? ' checked' : ''}>レイヤーを選ぶと、その行に欄を出す(オフにすると、左にスライドしたときだけ出る)</label>
      <div class="opt-hint">チェックを入れたものが、上から順に、欄に並びます。▲ ▼ で、順番を変えられます。不透明度のバーと、重ね方の一覧は、1行ぜんぶを使います。</div>
      <div class="ctl-list"></div>
      <div class="two"><button type="button" id="lc-reset">はじめに戻す</button></div></section>`;
  const box = body.querySelector('.ctl-list');
  const draw = () => {
    box.textContent = '';
    const order = [...on, ...CTL_ITEMS.map(([k]) => k).filter((k) => !on.includes(k))];
    for (const id of order) {
      const row = document.createElement('div'), i = on.indexOf(id);
      row.className = 'ctl-row';
      row.dataset.ctl = id;
      row.innerHTML = `<label class="check"><input type="checkbox"${i >= 0 ? ' checked' : ''}></label><span>${CTL_ITEMS.find(([k]) => k === id)[1]}</span><button type="button"${i > 0 ? '' : ' disabled'}>▲</button><button type="button"${i >= 0 && i < on.length - 1 ? '' : ' disabled'}>▼</button>`;
      const [up, down] = row.querySelectorAll('button');
      row.querySelector('input').onchange = (e) => { if (e.target.checked) on.push(id); else on = on.filter((k) => k !== id); draw(); };
      up.onclick = () => { [on[i - 1], on[i]] = [on[i], on[i - 1]]; draw(); };
      down.onclick = () => { [on[i + 1], on[i]] = [on[i], on[i + 1]]; draw(); };
      box.append(row);
    }
  };
  draw();
  body.querySelector('#lc-reset').onclick = () => { on = ['opacity', 'blend', 'dup', 'lock', 'delete']; draw(); };
  const { value } = await openModal({ title: 'レイヤーの欄', body, width: 440, buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (value !== 'ok') return;
  state.layerCtl = on;
  state.layerUi.onSelect = body.querySelector('#lc-select').checked;
  refreshUi();
  emit('settings');
}

// ガイド設定: ガイドを数字で足す・動かす・消す、グリッドの間隔、定規・グリッド・ガイドを見せるか
export async function guidesDialog() {
  const doc = state.doc;
  let list = doc.guides.map((g) => ({ ...g }));
  const body = document.createElement('div');
  body.className = 'settings guides';
  body.innerHTML = `<section><h4>表示</h4>
      <label class="check"><input type="checkbox" id="gd-rulers"${state.showRulers ? ' checked' : ''}>定規を表示する(定規から持ってくると、ガイドができます)</label>
      <label class="check"><input type="checkbox" id="gd-grid"${state.showGrid ? ' checked' : ''}>グリッドを表示する</label>
      <label class="check"><input type="checkbox" id="gd-guides"${state.showGuides ? ' checked' : ''}>ガイドを表示する</label>
      <div class="two">グリッドの間隔 <input type="number" id="gd-size" min="2" max="2000" value="${state.gridSize}"> px</div></section>
    <section><h4>ガイド(キャンバスの左上からの位置)</h4><div class="slots"></div>
      <div class="two"><button type="button" id="gd-addx">＋ 縦の線</button><button type="button" id="gd-addy">＋ 横の線</button><button type="button" id="gd-center">まん中に十字</button><button type="button" id="gd-clear">ぜんぶ消す</button></div></section>`;
  const slots = body.querySelector('.slots');
  const draw = () => {
    slots.textContent = '';
    if (!list.length) slots.innerHTML = '<div class="opt-hint">ガイドは、まだありません。</div>';
    list.forEach((g, i) => {
      const row = document.createElement('div');
      row.className = 'slot';
      row.innerHTML = `<span class="num">${i + 1}</span><select><option value="x"${g.axis === 'x' ? ' selected' : ''}>縦の線(左から)</option><option value="y"${g.axis === 'y' ? ' selected' : ''}>横の線(上から)</option></select>
        <input type="number" min="0" max="${Math.max(doc.w, doc.h)}" value="${g.pos}"> px <button type="button" class="icon-text" title="このガイドを消す">×</button>`;
      row.querySelector('select').onchange = (e) => { g.axis = e.target.value; };
      row.querySelector('input').onchange = (e) => { g.pos = Math.round(Number(e.target.value) || 0); };
      row.querySelector('button').onclick = () => { list.splice(i, 1); draw(); };
      slots.append(row);
    });
  };
  draw();
  body.querySelector('#gd-addx').onclick = () => { list.push({ axis: 'x', pos: Math.round(doc.w / 2) }); draw(); };
  body.querySelector('#gd-addy').onclick = () => { list.push({ axis: 'y', pos: Math.round(doc.h / 2) }); draw(); };
  body.querySelector('#gd-center').onclick = () => { list.push({ axis: 'x', pos: Math.round(doc.w / 2) }, { axis: 'y', pos: Math.round(doc.h / 2) }); draw(); };
  body.querySelector('#gd-clear').onclick = () => { list = []; draw(); };
  const { value } = await openModal({ title: 'ガイド設定', body, buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (value !== 'ok') return;
  state.showRulers = body.querySelector('#gd-rulers').checked;
  state.showGrid = body.querySelector('#gd-grid').checked;
  state.showGuides = body.querySelector('#gd-guides').checked;
  state.gridSize = Math.min(2000, Math.max(2, Math.round(Number(body.querySelector('#gd-size').value) || 100)));
  doc.guides = list.filter((g) => g.pos >= 0 && g.pos <= (g.axis === 'x' ? doc.w : doc.h));
  state.dirty = true;
  emit('title');
}
