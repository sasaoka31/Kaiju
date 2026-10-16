// 新しい版を確かめる(メニュー・そのほかの機能の「新しい版を確かめる」。0.21.0)
//   iPad 版(ブラウザ): 入口(index.html)をネットから取り直して、中の版の印(data-build)を、今の版と比べる。
//     ちがえば、オフライン用の取っておき(service worker)も新しくしてから、読み込み直す(= ブラウザの更新ボタンと同じ)。
//     保存していない絵があるときは、読み込み直すと消えるので、先に確かめる
//   Windows 版: ネットからは取ってこない(新しい Kaiju.exe を開くと、新しい版になる)ので、そう知らせるだけ
import { state } from './state.js';
import { say } from './messages.js';
import { openModal } from './modal.js';

let busy = false;
// 動作確認(tests/scenario-update210.js)が、差し替えて使う
export const env = { native: () => !!window.native, fetch: (u, o) => fetch(u, o), reload: () => location.reload() };

export async function checkUpdate() {
  const version = state.appVersion || '?';
  const now = document.documentElement.dataset.build;
  if (env.native() || !now) { say('updateDesktop', { version }); return; }
  if (busy) return;
  busy = true;
  try {
    say('updateChecking');
    let html;
    try {
      const res = await env.fetch(new URL('./', location.href).href, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      html = await res.text();
    } catch {
      say('updateOffline');
      return;
    }
    const build = html.match(/data-build="([^"]+)"/)?.[1];
    const next = html.match(/data-version="([^"]+)"/)?.[1] || '';
    if (!build || build === now) { say('updateLatest', { version }); return; }
    if (state.dirty) {
      const r = await openModal({
        title: '新しい版があります',
        body: `新しい版(${next})を入れると、画面を読み込み直します。<br>保存していない絵は、消えます。先に保存してから、もう一度押すこともできます。`,
        buttons: [{ label: 'やめる', value: false }, { label: '保存せずに入れる', value: true, primary: true }],
      });
      if (!r.value) return;
    }
    say('updateFound', { version: next });
    // オフライン用の取っておきも、新しい版に(待つのは 8 秒まで。間に合わなくても、読み込み直せば新しい版になる)
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await Promise.race([reg.update(), new Promise((r) => setTimeout(r, 8000))]);
    } catch { /* 取っておけなくても、読み込み直す */ }
    state.dirty = false; // 確かめたので、「閉じてよいか」は聞かない
    env.reload();
  } finally {
    busy = false;
  }
}
