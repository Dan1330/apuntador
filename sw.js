/*
 * Apuntador · service worker: funciona sin conexión y recibe archivos compartidos.
 * Solo guarda en caché los ARCHIVOS de la app. Tus obras, canciones y audios viven en IndexedDB,
 * que este archivo no toca nunca: actualizar la app no borra nada.
 */
const VERSION = 'apuntador-v2.2.0';
const RUNTIME = 'apuntador-rt';
const CORE = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/util.js', 'js/db.js', 'js/parser.js', 'js/importers.js', 'js/speech.js', 'js/voices.js', 'js/model.js', 'js/covers.js', 'js/ui.js', 'js/sample.js',
  'js/app.js', 'js/reader.js', 'js/study.js', 'js/pitch.js', 'js/spotify.js', 'js/sing.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
  'art/hero-stage.jpg', 'art/prompter.jpg', 'art/poster-velvet.jpg', 'art/poster-spot.jpg', 'art/poster-masks.jpg',
  'art/poster-moon.jpg', 'art/poster-paper.jpg',
];
const LAZY = ['vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/mammoth.browser.min.js', 'vendor/jszip.min.js'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE);
    await Promise.allSettled(LAZY.map((u) => c.add(u)));
    // primera instalación: activarse ya. Si hay una versión anterior, esperar a que el usuario pulse «Actualizar»
    // (así no se recarga la app en mitad de un ensayo)
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('apuntador-v') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { e.respondWith(handleShare(req)); return; }
  if (req.method !== 'GET') return;
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || url.hostname === 'cdn.jsdelivr.net' || url.hostname.includes('tessdata')) {
    e.respondWith(cacheFirst(req));
  }
});

// Red primero (para recibir actualizaciones) y caché si no hay conexión
async function networkFirst(req) {
  const c = await caches.open(VERSION);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4500)),
    ]);
    // no se guardan direcciones con parámetros (p. ej. la vuelta de Spotify con ?code=…)
    if (res && res.ok && res.type === 'basic' && !new URL(req.url).search) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('index.html') : null);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(RUNTIME);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone());
  return res;
}

// "Compartir con Apuntador" desde otras apps (Android)
async function handleShare(req) {
  try {
    const fd = await req.formData();
    const file = fd.getAll('file').find((f) => f && f.size);
    const text = fd.get('text') || '';
    const title = fd.get('title') || 'Texto compartido';
    const c = await caches.open('apuntador-share');
    const key = new URL('__shared__', self.registration.scope).href;
    if (file) {
      await c.put(key, new Response(file, { headers: { 'x-name': encodeURIComponent(file.name || 'compartido'), 'content-type': file.type || 'application/octet-stream' } }));
    } else if (text) {
      await c.put(key, new Response(text, { headers: { 'x-name': encodeURIComponent(title + '.txt'), 'content-type': 'text/plain' } }));
    }
  } catch (e) { /* nada */ }
  return Response.redirect(new URL('./#/shared', self.registration.scope).href, 303);
}
