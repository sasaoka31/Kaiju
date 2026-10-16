// iPad(ブラウザ)版の、Kaiju の中のフォルダ(IndexedDB)。名前ごとに、中身(文字か Blob)と時刻・大きさを持つ。
//   使っている所: share.js(共有フォルダ = kaiju-share)・files.js(Kaiju フォルダ = kaiju-files。保存した絵)
//   Safari は、ホーム画面に追加していないと、長く開かないあいだに、このデータを消すことがある(app.js で navigator.storage.persist() を頼んでいる)
export function makeFolder(dbName, storeName, label) {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName, { keyPath: 'name' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(`${label}を開けませんでした`));
  });
  const tx = async (mode, fn) => {
    const d = await open();
    try {
      return await new Promise((resolve, reject) => {
        const t = d.transaction(storeName, mode), req = fn(t.objectStore(storeName));
        t.oncomplete = () => resolve(req?.result);
        t.onerror = t.onabort = () => reject(new Error(t.error?.name === 'QuotaExceededError' ? 'iPad の空きが足りず、しまえませんでした' : `${label}に、読み書きできませんでした`));
      });
    } finally { d.close(); }
  };
  const sizeOf = (data) => (typeof data === 'string' ? data.length : data?.size ?? data?.byteLength ?? 0);
  return {
    where: () => label,
    write: (name, data) => tx('readwrite', (s) => s.put({ name, data, mtime: Date.now(), size: sizeOf(data) })),
    read: async (name) => { const r = await tx('readonly', (s) => s.get(name)); if (!r) throw new Error('見つかりません: ' + name); return r.data ?? r.text; },
    has: async (name) => !!(await tx('readonly', (s) => s.getKey(name))),
    list: async () => ((await tx('readonly', (s) => s.getAll())) || []).map(({ name, mtime, size }) => ({ name, mtime, size })).sort((a, b) => b.mtime - a.mtime),
    remove: (name) => tx('readwrite', (s) => s.delete(name)),
  };
}

export const sizeText = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
export const when = (t) => { const d = new Date(t); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
