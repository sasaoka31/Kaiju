// 共有パック(0.22.0): 描いている絵(レイヤーごと)と設定(ブラシ・バーの並び・色など)を、1つのファイル(<名前>.kaijushare.json)にして、ほかの端末へ渡す。
//   アカウントやサーバーは使わない。ファイルは、iCloud Drive・OneDrive など、両方の端末から見えるフォルダや、AirDrop で運ぶ。
//   iPad(ブラウザ): 送る = Kaiju の中の共有フォルダに入れる + 共有シート(ファイルに保存・AirDrop など)/ 開く = Kaiju の中の共有フォルダの一覧。ファイルからも取り込める
//   Windows: 送る = 共有フォルダに入れる(はじめは、自動で作った「Kaiju 共有」)/ 開く = 共有フォルダの一覧(新しい順)から選ぶ。ほかの場所のファイルも開ける
//   中身は { app: 'Kaiju', kind: 'share', v: 1, name, from, at, version, project?(.kaiju と同じ形), settings?(設定の書き出しと同じ形) }
import { state, emit } from './state.js';
import { settingsObject, applySettings, saveSettings } from './prefs.js';
import { packDoc, docFromProject, fileName, download, pickFile } from './io.js';
import { openModal, escapeHtml } from './modal.js';
import { refreshUi } from './ui.js';
import { say } from './messages.js';
import { makeFolder, sizeText, when } from './idb.js';

export const EXT = '.kaijushare.json';
// 端末ごとにちがって当然の設定は、渡さない(小窓の位置・指で描くか)
const LOCAL_ONLY = ['win', 'fingerDraw'];
// 動作確認(tests/scenario-update220.js)が、差し替えて使う
export const env = {
  native: () => window.native || null,
  share: (data) => navigator.share(data),
  canShare: (data) => !!navigator.canShare?.(data),
  download: (name, blob) => download(name, blob),
  pickText: async () => { const f = await pickFile('.json,application/json'); return f ? { name: f.name, text: await f.text() } : null; },
};

const cleanName = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '無題';

export function buildPack({ drawing = true, settings = true, name = '無題' } = {}) {
  const doc = state.doc;
  const pack = { app: 'Kaiju', kind: 'share', v: 1, name: cleanName(name), from: env.native() ? 'Windows' : 'iPad', at: new Date().toISOString(), version: state.appVersion || '' };
  if (drawing && doc) pack.project = packDoc(doc);
  if (settings) {
    const s = settingsObject();
    for (const k of LOCAL_ONLY) delete s[k];
    pack.settings = s;
  }
  return pack;
}

export function parsePack(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('ファイルが壊れているか、共有パックではありません'); }
  if (!o || o.app !== 'Kaiju' || o.kind !== 'share') throw new Error('Kaiju の共有パックではありません');
  return o;
}

// 共有パックを入れる。drawing = 絵を開く(今の絵と入れ替え)/ settings = 設定を入れる(その場で効く)
export async function applyPack(pack, { drawing = true, settings = true } = {}) {
  let done = [];
  if (settings && pack.settings) {
    const s = { ...pack.settings };
    for (const k of LOCAL_ONLY) delete s[k];
    applySettings(s);
    refreshUi();
    for (const e of ['brush', 'color', 'tool', 'settings']) emit(e);
    saveSettings();
    done.push('設定');
  }
  if (drawing && pack.project) {
    const doc = await docFromProject(pack.project);
    emit('load-doc', { doc });
    done.push('絵');
  }
  return done;
}


// ---- 共有フォルダ ----
// Windows = 本物のフォルダ(main.js の share:*。はじめに使うときに、iCloud Drive / OneDrive / ドキュメントの中に「Kaiju 共有」を作る)。
// iPad(ブラウザ)= Kaiju の中の共有フォルダ(IndexedDB。0.22.1)。Safari は、「ファイル」アプリの中にフォルダを作れない・決まったフォルダを開けないので、
//   Kaiju の中に、はじめから共有パックをしまう所を用意して、「開く」で一覧を出す。送ったもの・ファイルから取り込んだものは、ここに入る。
//   「ファイル」アプリからは見えないので、ほかの端末とは、共有シート(送る)と「ファイルから取り込む」で、やりとりする
export const box = makeFolder('kaiju-share', 'packs', 'Kaiju の中の共有フォルダ');
// 端末の共有フォルダ(Windows = フォルダ / iPad = Kaiju の中)
function folder() {
  const n = env.native();
  if (!n) return box;
  return { where: () => n.shareGetDir(), write: (name, text) => n.shareWrite(name, text), read: (name) => n.shareRead(name), list: async () => (await n.shareList()) || [] };
}

// ---- 送る ----
export async function shareSend() {
  const native = env.native(), dir = folder();
  const where = await dir.where();
  const body = document.createElement('div');
  body.className = 'form share-form';
  body.innerHTML = `<label>名前 <input type="text" id="sh-name" value="${escapeHtml(fileName().replace(/\.[^.]+$/, ''))}" maxlength="80"></label>
    <label class="check"><input type="checkbox" id="sh-drawing" ${state.doc ? 'checked' : 'disabled'}>描いている絵(レイヤーごと)</label>
    <label class="check"><input type="checkbox" id="sh-settings" checked>設定(ブラシ・バーの並び・色・パレットなど)</label>
    ${native ? `<p class="note">入れる所: <span id="sh-dir">${escapeHtml(where || '')}</span> <button type="button" id="sh-pick">変える…</button><br>iCloud Drive や OneDrive の中のフォルダなら、iPad の「ファイル」からも見えます</p>`
    : '<p class="note">Kaiju の中の共有フォルダに入ります。そのあと、「ファイルに保存」(iCloud Drive など)か AirDrop で、ほかの端末へも送れます</p>'}`;
  if (native) body.querySelector('#sh-pick').onclick = async () => { const d = await native.sharePickDir(); if (d) body.querySelector('#sh-dir').textContent = d; };
  const r = await openModal({ title: '共有パックを送る', body, width: 460, buttons: [{ label: 'キャンセル', value: null }, { label: '送る', value: 'ok', primary: true }] });
  if (r.value !== 'ok') return false;
  const drawing = body.querySelector('#sh-drawing').checked, settings = body.querySelector('#sh-settings').checked;
  if (!drawing && !settings) { say('shareNothing'); return false; }
  const pack = buildPack({ drawing, settings, name: body.querySelector('#sh-name').value });
  const text = JSON.stringify(pack), file = pack.name + EXT;
  await dir.write(file, text);
  say('shareSent', { name: file });
  if (native) return true;
  // iPad: ほかの端末へも送る。共有シートは、ボタンを押したその場でしか開けない(準備に時間がかかると断られる)ので、もう一度押してもらう
  const blob = new File([text], file, { type: 'application/json' });
  const ready = document.createElement('div');
  ready.className = 'form share-form';
  ready.innerHTML = `<p>Kaiju の中の共有フォルダに「${escapeHtml(file)}」(${sizeText(text.length)})を入れました。</p>
    <p class="note">ほかの端末(Windows など)へも送るときは:</p>
    <button type="button" class="primary" id="sh-go">共有する(ファイルに保存・AirDrop など)</button>
    <button type="button" id="sh-dl">ダウンロードで保存</button>`;
  const finish = () => ready.closest('.modal')?.querySelector('.modal-foot button')?.click();
  ready.querySelector('#sh-dl').onclick = () => { env.download(file, blob); say('shareSaved', { name: file }); finish(); };
  ready.querySelector('#sh-go').onclick = () => {
    const data = { files: [blob], title: pack.name };
    if (!env.canShare(data)) { ready.querySelector('#sh-dl').click(); return; }
    env.share(data).then(() => { say('shareSaved', { name: file }); finish(); }).catch((e) => { if (e?.name !== 'AbortError') ready.querySelector('#sh-dl').click(); });
  };
  await openModal({ title: '共有パックを送る', body: ready, width: 460, buttons: [{ label: '閉じる', value: null }] });
  return true;
}

// ---- 開く ----
// 共有フォルダの一覧(新しい順)から選ぶ。Windows は「フォルダを選ぶ…」「ほかの場所から…」、iPad は「ファイルから取り込む…」(取り込んだものは、Kaiju の中の共有フォルダにも入る)「消す」
export async function shareOpen() {
  const native = env.native(), dir = folder();
  let got = null;
  for (;;) {
    const list = await dir.list(), where = await dir.where();
    const body = document.createElement('div');
    body.className = 'form share-form';
    body.innerHTML = `<p class="note">${escapeHtml(where || '')}</p>` + (list.length
      ? `<div class="share-list">${list.map((f, i) => `<label class="check"><input type="radio" name="sh-pick" value="${escapeHtml(f.name)}"${i ? '' : ' checked'}><span>${escapeHtml(f.name.endsWith(EXT) ? f.name.slice(0, -EXT.length) : f.name)}</span><em>${when(f.mtime)} ・ ${sizeText(f.size)}</em></label>`).join('')}</div>`
      : `<p class="note">共有パックが、まだありません。${native ? '' : '「ファイルから取り込む…」で、ほかの端末から送ったものを入れられます'}</p>`);
    const buttons = [{ label: 'キャンセル', value: null }];
    if (native) buttons.push({ label: 'フォルダを選ぶ…', value: 'dir' }, { label: 'ほかの場所から…', value: 'other' });
    else {
      buttons.push({ label: 'ファイルから取り込む…', value: 'file' });
      if (list.length) buttons.push({ label: '消す', value: 'del' });
    }
    if (list.length) buttons.push({ label: '開く', value: 'ok', primary: true });
    const r = await openModal({ title: '共有パックを開く', body, width: 480, buttons });
    const picked = body.querySelector('input[name="sh-pick"]:checked')?.value;
    if (r.value === 'dir') { await native.sharePickDir(); continue; }
    if (r.value === 'del') {
      if (picked) {
        const ok = await openModal({ title: '共有パックを消す', body: `「${escapeHtml(picked)}」を、Kaiju の中の共有フォルダから消します`, buttons: [{ label: 'やめる', value: false }, { label: '消す', value: true, primary: true }] });
        if (ok.value) await box.remove(picked);
      }
      continue;
    }
    if (r.value === 'other') {
      const p = await native.openDialog({ title: '共有パックを開く', filters: [{ name: 'Kaiju の共有パック', extensions: ['json'] }] });
      if (p) got = { name: p.split(/[\\/]/).pop(), text: await native.readText(p) };
    } else if (r.value === 'file') {
      got = await env.pickText();
      if (got) {
        parsePack(got.text); // 共有パックでなければ、しまう前に断る
        const name = got.name.endsWith(EXT) ? got.name : got.name.replace(/\.json$/i, '') + EXT;
        await box.write(name, got.text);
      }
    } else if (r.value === 'ok' && picked) got = { name: picked, text: await dir.read(picked) };
    break;
  }
  if (!got) return false;
  const pack = parsePack(got.text);
  // 何を入れるか
  const body = document.createElement('div');
  body.className = 'form share-form';
  body.innerHTML = `<p>「${escapeHtml(pack.name || got.name)}」(${escapeHtml(pack.from || '')}${pack.at ? ' ・ ' + when(pack.at) : ''}${pack.version ? ' ・ v' + escapeHtml(pack.version) : ''})</p>
    <label class="check"><input type="checkbox" id="sh-drawing" ${pack.project ? 'checked' : 'disabled'}>絵を開く${pack.project ? `(${pack.project.w} × ${pack.project.h})` : '(入っていません)'}</label>
    <label class="check"><input type="checkbox" id="sh-settings" ${pack.settings ? 'checked' : 'disabled'}>設定を入れる(ブラシ・バーの並び・色・パレットなど。今の設定と入れ替わります)${pack.settings ? '' : '(入っていません)'}</label>
    ${state.dirty && pack.project ? '<p class="note warn">今の絵は、保存していません。絵を開くと、今の絵は消えます</p>' : ''}`;
  const r = await openModal({ title: '共有パックを開く', body, width: 480, buttons: [{ label: 'キャンセル', value: null }, { label: '入れる', value: 'ok', primary: true }] });
  if (r.value !== 'ok') return false;
  const done = await applyPack(pack, { drawing: body.querySelector('#sh-drawing').checked, settings: body.querySelector('#sh-settings').checked });
  if (done.length) say('shareOpened', { name: pack.name || got.name, what: done.join('と') });
  return done.length > 0;
}
