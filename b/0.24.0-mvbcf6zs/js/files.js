// iPad(ブラウザ)版の「Kaiju フォルダ」(0.24.0。ユーザー「iPad 内の Kaiju フォルダも作成して、そこをデフォルトに」)。
//   Safari は、iPad の「ファイル」アプリの中にフォルダを作れないので、Kaiju の中(IndexedDB の kaiju-files)に、保存した絵をしまう所を、はじめから用意する。
//   保存(io.js の saveProject)= ここに入れる(名前を付けて保存で「ファイルに書き出す」も選べる)/ 開く = ここの一覧(新しい順)。「ファイルから開く…」「書き出す」「消す」もある
//   Windows 版は使わない(保存のフォルダ = lib/savedir.js)
import { makeFolder, sizeText, when } from './idb.js';
import { openModal, escapeHtml } from './modal.js';
import { say } from './messages.js';

export const kfolder = makeFolder('kaiju-files', 'files', 'Kaiju フォルダ(この iPad の中)');

// 書き出すときの形(Safari が名前の後ろに .json などを足さないよう、.kaiju は octet-stream で)
export function fileBlob(name, data) {
  const type = /\.psd$/i.test(name) ? 'image/vnd.adobe.photoshop' : 'application/octet-stream';
  return data instanceof Blob ? new Blob([data], { type }) : new Blob([data], { type });
}

// ファイルにして、ほかへ出す(共有シート: ファイルに保存・AirDrop など / ダウンロード)。共有シートは、ボタンを押したその場でしか開けないので、ボタンを出して押してもらう
export async function exportFile(name, blob, { download, share = (d) => navigator.share(d), canShare = (d) => !!navigator.canShare?.(d) }) {
  const file = new File([blob], name, { type: blob.type });
  const ready = document.createElement('div');
  ready.className = 'form share-form';
  ready.innerHTML = `<p>「${escapeHtml(name)}」(${sizeText(blob.size)})を、ファイルにして出します。</p>
    <button type="button" class="primary" id="fx-go">共有する(ファイルに保存・AirDrop など)</button>
    <button type="button" id="fx-dl">ダウンロードで保存</button>`;
  let done = false;
  const finish = () => ready.closest('.modal')?.querySelector('.modal-foot button')?.click();
  ready.querySelector('#fx-dl').onclick = () => { download(name, blob); done = true; say('exportedFile', { name }); finish(); };
  ready.querySelector('#fx-go').onclick = () => {
    const data = { files: [file], title: name };
    if (!canShare(data)) { ready.querySelector('#fx-dl').click(); return; }
    share(data).then(() => { done = true; say('exportedFile', { name }); finish(); }).catch((e) => { if (e?.name !== 'AbortError') ready.querySelector('#fx-dl').click(); });
  };
  await openModal({ title: 'ファイルに書き出す', body: ready, width: 460, buttons: [{ label: '閉じる', value: null }] });
  return done;
}

// 「開く」(iPad): Kaiju フォルダの一覧から選ぶ。→ { name, bytes } / やめたら null
//   io = { pickFile, download }(io.js から渡す。io.js がこのファイルを読むので、ここからは読まない)
export async function openFromFolder(io) {
  for (;;) {
    const list = await kfolder.list();
    const body = document.createElement('div');
    body.className = 'form share-form';
    body.innerHTML = `<p class="note">${escapeHtml(kfolder.where())}</p>` + (list.length
      ? `<div class="share-list">${list.map((f, i) => `<label class="check"><input type="radio" name="kf-pick" value="${escapeHtml(f.name)}"${i ? '' : ' checked'}><span>${escapeHtml(f.name)}</span><em>${when(f.mtime)} ・ ${sizeText(f.size)}</em></label>`).join('')}</div>`
      : '<p class="note">保存した絵が、まだありません。「ファイルから開く…」で、「ファイル」アプリの PSD・.kaiju も開けます</p>');
    const buttons = [{ label: 'キャンセル', value: null }, { label: 'ファイルから開く…', value: 'file' }];
    if (list.length) buttons.push({ label: '書き出す', value: 'export' }, { label: '消す', value: 'del' }, { label: '開く', value: 'ok', primary: true });
    const r = await openModal({ title: '開く', body, width: 500, buttons });
    const picked = body.querySelector('input[name="kf-pick"]:checked')?.value;
    if (r.value === 'file') {
      // 選べるファイルをしぼらない(iPad は、.kaiju が何のファイルか知らないので、しぼると選べなくなる。中身で見分ける)
      const f = await io.pickFile('');
      return f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    }
    if (r.value === 'export' && picked) { await exportFile(picked, fileBlob(picked, await kfolder.read(picked)), io); continue; }
    if (r.value === 'del' && picked) {
      const ok = await openModal({ title: '消す', body: `「${escapeHtml(picked)}」を、Kaiju フォルダから消します(元に戻せません)`, buttons: [{ label: 'やめる', value: false }, { label: '消す', value: true, primary: true }] });
      if (ok.value) await kfolder.remove(picked);
      continue;
    }
    if (r.value === 'ok' && picked) {
      const data = await kfolder.read(picked);
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await new Blob([data]).arrayBuffer());
      return { name: picked, bytes, fromFolder: true };
    }
    return null;
  }
}
