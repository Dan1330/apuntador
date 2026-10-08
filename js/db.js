'use strict';
/* Almacenamiento local (IndexedDB, con respaldo en localStorage) */

const DB = (() => {
  let dbp = null;
  const hasIDB = typeof indexedDB !== 'undefined';

  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        // Las versiones nuevas SOLO añaden almacenes: nunca se borra ni se vacía nada al actualizar la app
        const r = indexedDB.open('apuntador', 3);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('scripts')) db.createObjectStore('scripts', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio'); // voces generadas (v2)
          if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' }); // canciones (v3)
          if (!db.objectStoreNames.contains('songaudio')) db.createObjectStore('songaudio'); // audio de tus canciones (v3)
        };
        r.onsuccess = () => {
          const db = r.result;
          // si otra pestaña abre una versión más nueva, cerramos para no bloquearla
          db.onversionchange = () => { db.close(); dbp = null; };
          res(db);
        };
        r.onerror = () => rej(r.error);
        // Una ventana antigua de la app sigue abierta: se espera a que se cierre (no se da por vacía la biblioteca)
        r.onblocked = () => { try { toast('Cierra las otras ventanas de Apuntador para terminar de actualizar', 6000); } catch (e) { /* nada */ } };
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
    // Audios de las voces naturales (clave → Blob WAV)
    async audioGet(key) {
      if (!hasIDB) return null;
      try { return (await run('audio', 'readonly', (s) => s.get(key))) || null; } catch (e) { return null; }
    },
    async audioPut(key, blob) {
      if (!hasIDB) return;
      try { await run('audio', 'readwrite', (s) => s.put(blob, key)); } catch (e) { console.warn('audio', e); }
    },
    async audioKeys() {
      if (!hasIDB) return new Set();
      try { return new Set(await run('audio', 'readonly', (s) => s.getAllKeys())); } catch (e) { return new Set(); }
    },
    async audioClear() {
      if (!hasIDB) return;
      await run('audio', 'readwrite', (s) => s.clear());
    },
    // --- canciones ---
    async allSongs() {
      if (!hasIDB) { try { return JSON.parse(localStorage.getItem('apuntador.songs') || '[]'); } catch (e) { return []; } }
      try { return (await run('songs', 'readonly', (s) => s.getAll())) || []; } catch (e) { console.warn(e); return []; }
    },
    async putSong(song) {
      const clean = JSON.parse(JSON.stringify(song, (k, v) => (k.startsWith('_') ? undefined : v)));
      if (!hasIDB) {
        const a = JSON.parse(localStorage.getItem('apuntador.songs') || '[]').filter((x) => x.id !== clean.id);
        a.push(clean); localStorage.setItem('apuntador.songs', JSON.stringify(a)); return;
      }
      await run('songs', 'readwrite', (s) => s.put(clean));
    },
    async deleteSong(id) {
      if (!hasIDB) return;
      await run('songs', 'readwrite', (s) => s.delete(id));
    },
    async songAudioGet(key) {
      if (!hasIDB || !key) return null;
      try { return (await run('songaudio', 'readonly', (s) => s.get(key))) || null; } catch (e) { return null; }
    },
    async songAudioPut(key, blob) {
      if (!hasIDB) throw new Error('Este navegador no puede guardar audio');
      await run('songaudio', 'readwrite', (s) => s.put(blob, key));
    },
    async songAudioDelete(key) {
      if (!hasIDB || !key) return;
      try { await run('songaudio', 'readwrite', (s) => s.delete(key)); } catch (e) { /* nada */ }
    },
    async persist() {
      try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
      return false;
    },
    // ¿El navegador ha prometido no borrar nuestros datos aunque falte espacio?
    async persisted() {
      try { if (navigator.storage && navigator.storage.persisted) return await navigator.storage.persisted(); } catch (e) {}
      return false;
    },
    async estimate() {
      try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch (e) {}
      return null;
    },
  };
})();
