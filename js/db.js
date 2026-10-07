'use strict';
/* Almacenamiento local (IndexedDB, con respaldo en localStorage) */

const DB = (() => {
  let dbp = null;
  const hasIDB = typeof indexedDB !== 'undefined';

  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('apuntador', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('scripts')) db.createObjectStore('scripts', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('Base de datos bloqueada'));
      });
    }
    return dbp;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Operación cancelada'));
    });
  }

  // --- respaldo localStorage ---
  const LS = {
    all() { try { return JSON.parse(localStorage.getItem('apuntador.scripts') || '[]'); } catch (e) { return []; } },
    saveAll(arr) { localStorage.setItem('apuntador.scripts', JSON.stringify(arr)); },
  };

  return {
    async allScripts() {
      if (!hasIDB) return LS.all();
      try { return (await run('scripts', 'readonly', (s) => s.getAll())) || []; } catch (e) { console.warn(e); return LS.all(); }
    },
    async putScript(script) {
      const clean = JSON.parse(JSON.stringify(script, (k, v) => (k.startsWith('_') ? undefined : v)));
      if (!hasIDB) { const a = LS.all().filter((x) => x.id !== clean.id); a.push(clean); LS.saveAll(a); return; }
      await run('scripts', 'readwrite', (s) => s.put(clean));
    },
    async deleteScript(id) {
      if (!hasIDB) { LS.saveAll(LS.all().filter((x) => x.id !== id)); return; }
      await run('scripts', 'readwrite', (s) => s.delete(id));
    },
    async get(key, def) {
      try {
        if (!hasIDB) { const v = localStorage.getItem('apuntador.kv.' + key); return v == null ? def : JSON.parse(v); }
        const v = await run('kv', 'readonly', (s) => s.get(key));
        return v === undefined ? def : v;
      } catch (e) { return def; }
    },
    async set(key, val) {
      try {
        if (!hasIDB) { localStorage.setItem('apuntador.kv.' + key, JSON.stringify(val)); return; }
        await run('kv', 'readwrite', (s) => s.put(val, key));
      } catch (e) { console.warn(e); }
    },
    async persist() {
      try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
      return false;
    },
  };
})();
