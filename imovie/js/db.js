/* IndexedDB persistence (falls back to memory when unavailable) */
(function (IM) {
  'use strict';
  const DB_NAME = 'imovie-web';
  const DB_VERSION = 2;
  const STORES = ['kv', 'media', 'blobs', 'thumbs', 'peaks', 'projects', 'render'];

  const mem = {};
  STORES.forEach((s) => (mem[s] = new Map()));

  let dbp = null;
  IM.DB = {
    persistent: true,
    open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve) => {
        if (!window.indexedDB) { IM.DB.persistent = false; resolve(null); return; }
        let req;
        try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { IM.DB.persistent = false; resolve(null); return; }
        req.onupgradeneeded = () => {
          const db = req.result;
          STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { console.warn('IndexedDB unavailable', req.error); IM.DB.persistent = false; resolve(null); };
        req.onblocked = () => { console.warn('IndexedDB blocked'); };
      });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      return dbp;
    },
    async _tx(store, mode, fn) {
      const db = await IM.DB.open();
      if (!db) return fn(null);
      return new Promise((resolve, reject) => {
        let result;
        let tx;
        try { tx = db.transaction(store, mode); } catch (e) { reject(e); return; }
        const os = tx.objectStore(store);
        const r = fn(os);
        if (r && typeof r === 'object' && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('aborted'));
      });
    },
    async get(store, key) {
      const db = await IM.DB.open();
      if (!db) return mem[store].get(key);
      return IM.DB._tx(store, 'readonly', (os) => os.get(key)).catch((e) => { console.warn(e); return undefined; });
    },
    async put(store, key, value) {
      const db = await IM.DB.open();
      if (!db) { mem[store].set(key, value); return; }
      return IM.DB._tx(store, 'readwrite', (os) => os.put(value, key)).catch((e) => {
        console.warn('DB put failed', store, key, e);
        mem[store].set(key, value);
        if (e && e.name === 'QuotaExceededError') IM.bus.emit('storage-full');
      });
    },
    async del(store, key) {
      const db = await IM.DB.open();
      mem[store].delete(key);
      if (!db) return;
      return IM.DB._tx(store, 'readwrite', (os) => os.delete(key)).catch((e) => console.warn(e));
    },
    async all(store) {
      const db = await IM.DB.open();
      if (!db) return Array.from(mem[store].entries()).map(([k, v]) => ({ key: k, value: v }));
      return new Promise((resolve) => {
        const out = [];
        try {
          const tx = db.transaction(store, 'readonly');
          const req = tx.objectStore(store).openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (c) { out.push({ key: c.key, value: c.value }); c.continue(); }
          };
          tx.oncomplete = () => resolve(out);
          tx.onerror = () => resolve(out);
        } catch (e) { resolve(out); }
      });
    },
    async clearAll() {
      const db = await IM.DB.open();
      STORES.forEach((s) => mem[s].clear());
      if (!db) return;
      await Promise.all(STORES.map((s) => IM.DB._tx(s, 'readwrite', (os) => os.clear()).catch(() => {})));
    },
  };
})(window.IM = window.IM || {});
