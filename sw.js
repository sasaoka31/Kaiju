// オフライン対応(iPad など、ブラウザで開く版)。scripts/build-web.js が、下の2行を書き換えて dist-web/sw.js にする。
//   ・中身(b/<版>-<時刻>/ の中)は、1回開いたら端末に取っておく。名前が毎回ちがうので、古いものと混ざらない
//   ・入口の index.html は、ネットがあれば毎回取りに行く(= 更新ボタンで新しい版になる)。ネットがなければ、取っておいたものを使う
const BUILD = "0.24.0-mvbcf6zs";
const FILES = ["b/0.24.0-mvbcf6zs/docs/manual/01-screen.png","b/0.24.0-mvbcf6zs/docs/manual/02-brush.png","b/0.24.0-mvbcf6zs/docs/manual/03-layers.png","b/0.24.0-mvbcf6zs/docs/manual/04-fill.png","b/0.24.0-mvbcf6zs/docs/manual/05-select.png","b/0.24.0-mvbcf6zs/docs/manual/06-settings.png","b/0.24.0-mvbcf6zs/docs/manual/07-float.png","b/0.24.0-mvbcf6zs/docs/manual/08-transform.png","b/0.24.0-mvbcf6zs/docs/manual/09-color.png","b/0.24.0-mvbcf6zs/docs/manual/10-layout.png","b/0.24.0-mvbcf6zs/docs/manual/11-more.png","b/0.24.0-mvbcf6zs/icon.png","b/0.24.0-mvbcf6zs/icons/blend.png","b/0.24.0-mvbcf6zs/icons/clip-down.png","b/0.24.0-mvbcf6zs/icons/close.png","b/0.24.0-mvbcf6zs/icons/cmyk.png","b/0.24.0-mvbcf6zs/icons/cursor-eyedropper.png","b/0.24.0-mvbcf6zs/icons/dock-right.png","b/0.24.0-mvbcf6zs/icons/dup.png","b/0.24.0-mvbcf6zs/icons/eyedropper.png","b/0.24.0-mvbcf6zs/icons/fill-bg.png","b/0.24.0-mvbcf6zs/icons/fill-fg.png","b/0.24.0-mvbcf6zs/icons/flip-h.png","b/0.24.0-mvbcf6zs/icons/flip-v.png","b/0.24.0-mvbcf6zs/icons/folder.png","b/0.24.0-mvbcf6zs/icons/invert.png","b/0.24.0-mvbcf6zs/icons/lock.png","b/0.24.0-mvbcf6zs/icons/merge.png","b/0.24.0-mvbcf6zs/icons/noise.png","b/0.24.0-mvbcf6zs/icons/palette.png","b/0.24.0-mvbcf6zs/icons/pattern-pen.png","b/0.24.0-mvbcf6zs/icons/ribbon.png","b/0.24.0-mvbcf6zs/icons/share-open.png","b/0.24.0-mvbcf6zs/icons/share-send.png","b/0.24.0-mvbcf6zs/icons/sharpen.png","b/0.24.0-mvbcf6zs/icons/trash.png","b/0.24.0-mvbcf6zs/icons/update.png","b/0.24.0-mvbcf6zs/icons/window.png","b/0.24.0-mvbcf6zs/js/abr.js","b/0.24.0-mvbcf6zs/js/actions.js","b/0.24.0-mvbcf6zs/js/adjust.js","b/0.24.0-mvbcf6zs/js/app.js","b/0.24.0-mvbcf6zs/js/brush.js","b/0.24.0-mvbcf6zs/js/claude.js","b/0.24.0-mvbcf6zs/js/doc.js","b/0.24.0-mvbcf6zs/js/files.js","b/0.24.0-mvbcf6zs/js/fill.js","b/0.24.0-mvbcf6zs/js/history.js","b/0.24.0-mvbcf6zs/js/idb.js","b/0.24.0-mvbcf6zs/js/io.js","b/0.24.0-mvbcf6zs/js/layers.js","b/0.24.0-mvbcf6zs/js/layout.js","b/0.24.0-mvbcf6zs/js/messages.js","b/0.24.0-mvbcf6zs/js/modal.js","b/0.24.0-mvbcf6zs/js/prefs.js","b/0.24.0-mvbcf6zs/js/protect.js","b/0.24.0-mvbcf6zs/js/psd.js","b/0.24.0-mvbcf6zs/js/select.js","b/0.24.0-mvbcf6zs/js/settingsdlg.js","b/0.24.0-mvbcf6zs/js/share.js","b/0.24.0-mvbcf6zs/js/state.js","b/0.24.0-mvbcf6zs/js/tools.js","b/0.24.0-mvbcf6zs/js/tools2.js","b/0.24.0-mvbcf6zs/js/transform.js","b/0.24.0-mvbcf6zs/js/ui.js","b/0.24.0-mvbcf6zs/js/update.js","b/0.24.0-mvbcf6zs/js/view.js","b/0.24.0-mvbcf6zs/manifest.webmanifest","b/0.24.0-mvbcf6zs/manual.html","b/0.24.0-mvbcf6zs/styles.css"];

const CACHE = 'kaiju-' + BUILD;
const ROOT = new URL('./', self.location).href; // 入口(…/Kaiju/)

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 入口と、中身ぜんぶを取っておく(ネットから取り直す。途中で失敗したら、この版は入れない)
    await cache.addAll([new Request(ROOT, { cache: 'reload' }), ...FILES.map((f) => new Request(new URL(f, ROOT).href, { cache: 'reload' }))]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 前の版の分は消す
    for (const k of await caches.keys()) if (k.startsWith('kaiju-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(ROOT)) return;
  const isEntry = req.mode === 'navigate' || req.url === ROOT || req.url === ROOT + 'index.html';
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (isEntry) {
      // 入口: ネットが先(新しい版があれば、それになる)。つながらなければ、取っておいたもの
      try {
        const res = await fetch(new Request(ROOT, { cache: 'no-store' }));
        if (res.ok) { cache.put(ROOT, res.clone()); return res; }
      } catch { /* オフライン */ }
      return (await cache.match(ROOT)) || (await caches.match(ROOT)) || Response.error();
    }
    // 中身: 取っておいたものが先(名前が版ごとにちがうので、古くならない)。なければネットから取って、取っておく
    const hit = (await cache.match(req)) || (await caches.match(req));
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  })());
});
