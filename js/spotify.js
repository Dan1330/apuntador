'use strict';
/*
 * Spotify con la app de desarrollador de cada usuario (su propio «Client ID»).
 * Inicio de sesión PKCE: no hace falta servidor ni clave secreta. Los permisos se guardan solo en este dispositivo.
 * Spotify no da letras ni deja descargar audio: las letras vienen de LRCLIB (gratis, sincronizadas)
 * y Spotify se usa para buscar canciones y controlar la reproducción en tu app de Spotify.
 */
const Spotify = (() => {
  const AUTH = 'https://accounts.spotify.com/authorize';
  const TOKEN = 'https://accounts.spotify.com/api/token';
  const API = 'https://api.spotify.com/v1';
  const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
  const PKCE_KEY = 'apuntador.spPkce';
  let tok = null, loaded = null, refreshing = null;

  // Dirección exacta que hay que copiar en el panel de Spotify («Redirect URI»)
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
  const clientId = () => ((App.settings && App.settings.spotifyClientId) || '').trim();

  function load() {
    if (!loaded) loaded = DB.get('spotify', null).then((t) => { tok = t; });
    return loaded;
  }
  // Otra ventana (la del inicio de sesión) puede haber guardado el permiso: se vuelve a leer
  async function reload() { loaded = null; await load(); }
  function connected() { return !!(tok && tok.refresh && tok.clientId === clientId()); }

  const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function randomStr(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n); }

  async function login() {
    const id = clientId();
    if (!id) throw new Error('Pega primero tu Client ID de Spotify');
    if (!window.crypto || !crypto.subtle) throw new Error('Para conectar Spotify la app tiene que estar publicada en https');
    const verifier = randomStr(64);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = randomStr(16);
    // localStorage (no sessionStorage): en Android la vuelta puede abrirse en otra ventana de la app
    localStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, id, back: location.hash || '#/settings' }));
    const q = new URLSearchParams({ client_id: id, response_type: 'code', redirect_uri: redirectUri(), code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES });
    location.assign(AUTH + '?' + q);
  }

  // Al arrancar: si venimos de Spotify con ?code=…, se cambia por el permiso y se limpia la dirección
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return null;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PKCE_KEY) || 'null'); } catch (e) { /* nada */ }
    history.replaceState(null, '', location.pathname + ((saved && saved.back) || '#/settings'));
    if (q.get('error')) return { ok: false, msg: q.get('error') === 'access_denied' ? 'Has cancelado la conexión con Spotify.' : 'Spotify: ' + q.get('error') };
    if (!saved || saved.state !== q.get('state')) return { ok: false, msg: 'La conexión con Spotify ha caducado. Vuelve a pulsar «Conectar».' };
    localStorage.removeItem(PKCE_KEY);
    try {
      await tokenReq({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), client_id: saved.id, code_verifier: saved.verifier }, saved.id);
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  async function tokenReq(params, id) {
    let r;
    try { r = await fetch(TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) }); }
    catch (e) { throw new Error('Sin conexión con Spotify'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'invalid_grant' && params.grant_type === 'refresh_token') { await logout(); throw new Error('El permiso de Spotify ha caducado: vuelve a conectar en Ajustes.'); }
      if (j.error === 'invalid_client') throw new Error('Spotify no reconoce ese Client ID. Revísalo en Ajustes.');
      if (/redirect/i.test(j.error_description || '')) throw new Error('La «Redirect URI» de tu app de Spotify no coincide. Copia la de Ajustes exactamente.');
      throw new Error(j.error_description || j.error || 'Spotify no responde');
    }
    tok = { clientId: id, access: j.access_token, refresh: j.refresh_token || (tok && tok.refresh), exp: Date.now() + (j.expires_in - 60) * 1000 };
    await DB.set('spotify', tok);
    return tok;
  }

  async function token() {
    await load();
    if (!connected()) { const e = new Error('Conecta Spotify en Ajustes'); e.code = 'auth'; throw e; }
    if (Date.now() < tok.exp) return tok.access;
    if (!refreshing) refreshing = tokenReq({ grant_type: 'refresh_token', refresh_token: tok.refresh, client_id: tok.clientId }, tok.clientId).finally(() => { refreshing = null; });
    return (await refreshing).access;
  }

  async function logout() { tok = null; await DB.set('spotify', null); }

  async function api(path, { method = 'GET', body, query, retried = false } = {}) {
    const t = await token();
    const url = API + path + (query ? '?' + new URLSearchParams(query) : '');
    let r;
    try {
      r = await fetch(url, { method, headers: { Authorization: 'Bearer ' + t, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new Error('Sin conexión con Spotify'); }
    if (r.status === 401 && !retried) { tok.exp = 0; return api(path, { method, body, query, retried: true }); }
    if (r.status === 204 || r.status === 202) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      const reason = j && j.error && j.error.reason;
      let msg = (j && j.error && (j.error.message || j.error)) || 'Error de Spotify';
      if (r.status === 404 && (reason === 'NO_ACTIVE_DEVICE' || /device/i.test(msg))) msg = 'Abre Spotify en el móvil y pon cualquier canción un segundo; luego vuelve.';
      else if (r.status === 403) msg = 'Spotify no lo permite: hace falta Premium y que tu cuenta esté en «User Management» de tu app de Spotify.';
      else if (r.status === 429) msg = 'Spotify pide esperar un poco: demasiadas peticiones.';
      const err = new Error(msg);
      err.status = r.status;
      err.code = r.status === 404 && /device/i.test(msg + (reason || '')) ? 'nodevice' : r.status === 403 ? 'forbidden' : '';
      throw err;
    }
    return j;
  }

  function mapTrack(t) {
    const imgs = (t.album && t.album.images) || [];
    const img = (imgs.find((i) => i.width && i.width <= 640 && i.width >= 250) || imgs[0] || {}).url || null;
    return {
      id: t.id, uri: t.uri, url: (t.external_urls && t.external_urls.spotify) || `https://open.spotify.com/track/${t.id}`,
      title: t.name, artist: (t.artists || []).map((a) => a.name).join(', '), firstArtist: ((t.artists || [])[0] || {}).name || '',
      album: (t.album && t.album.name) || '', durationMs: t.duration_ms || 0, img,
    };
  }

  // La API para apps de desarrollo devuelve como máximo 10 resultados
  async function search(q) {
    const j = await api('/search', { query: { q, type: 'track', limit: 10 } });
    return ((j && j.tracks && j.tracks.items) || []).filter(Boolean).map(mapTrack);
  }

  async function track(id) { return mapTrack(await api('/tracks/' + encodeURIComponent(id))); }

  // Estado del reproductor de Spotify (en cualquier dispositivo)
  async function state() {
    const j = await api('/me/player');
    if (!j) return null;
    return { track: j.item && j.item.type === 'track' ? mapTrack(j.item) : null, progress: j.progress_ms || 0, playing: !!j.is_playing, at: performance.now(), device: j.device && j.device.name };
  }

  async function play(uri, positionMs = 0) {
    const body = { uris: [uri], position_ms: Math.max(0, Math.round(positionMs)) };
    try { await api('/me/player/play', { method: 'PUT', body }); }
    catch (e) {
      if (e.code !== 'nodevice') throw e;
      // ningún dispositivo activo: probar con el primero disponible
      const d = await api('/me/player/devices');
      const dev = d && d.devices && d.devices[0];
      if (!dev) throw e;
      await api('/me/player/play', { method: 'PUT', body, query: { device_id: dev.id } });
    }
  }
  const resume = () => api('/me/player/play', { method: 'PUT' });
  const pause = () => api('/me/player/pause', { method: 'PUT' });
  const seek = (ms) => api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.max(0, Math.round(ms)) } });

  return { redirectUri, load, reload, connected, login, logout, handleRedirect, search, track, state, play, resume, pause, seek };
})();

/* ---------- Letras (LRCLIB: base de datos abierta de letras, muchas con tiempos) ---------- */
const Lyrics = (() => {
  const BASE = 'https://lrclib.net/api';

  // «Canción - Remastered 2011», «(feat. X)»… estorban al buscar la letra
  const cleanTitle = (t) => String(t || '')
    .replace(/\s*[-–]\s*(\d{4}\s*)?(remaster(ed)?|live|en vivo|en directo|versi[oó]n|version|radio edit|mono|stereo|acoustic|ac[uú]stic[oa]).*$/i, '')
    .replace(/\s*[([](feat|ft|with|con)\.?[^)\]]*[)\]]/ig, '').trim();

  function parseLRC(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const tags = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.,]\d{1,3})?)\]/g)];
      if (!tags.length) { if (/^\s*\[[a-z]+:/i.test(raw)) continue; const s = raw.trim(); if (s) out.push({ t: null, text: s }); continue; }
      const text = raw.replace(/\[[^\]]*\]/g, '').trim();
      for (const m of tags) out.push({ t: Math.round((Number(m[1]) * 60 + Number(m[2].replace(',', '.'))) * 1000), text });
    }
    const timed = out.filter((l) => l.t != null);
    if (timed.length >= Math.max(2, out.length * 0.6)) return { lines: timed.sort((a, b) => a.t - b.t), synced: true };
    return { lines: out.map((l) => ({ t: null, text: l.text })), synced: false };
  }

  function plainLines(text) {
    const lines = String(text || '').split(/\r?\n/).map((s) => s.trim());
    // conserva una línea en blanco entre estrofas
    const out = [];
    for (const s of lines) { if (s || (out.length && out[out.length - 1].text)) out.push({ t: null, text: s }); }
    while (out.length && !out[out.length - 1].text) out.pop();
    return out;
  }

  // Texto pegado por el usuario: si trae tiempos [mm:ss] se usan
  function fromText(text) {
    if (/\[\d{1,3}:\d{1,2}/.test(text)) { const r = parseLRC(text); if (r.synced) return { ...r, source: 'Pegada' }; }
    return { lines: plainLines(text), synced: false, source: 'Pegada' };
  }

  function toLRC(lines) {
    const ts = (ms) => { const s = ms / 1000; return `[${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}]`; };
    return lines.map((l) => (l.t != null ? ts(l.t) : '') + l.text).join('\n');
  }

  function fromEntry(j) {
    if (j.instrumental) return { lines: [], synced: false, source: 'LRCLIB', instrumental: true };
    if (j.syncedLyrics) { const r = parseLRC(j.syncedLyrics); if (r.synced) return { ...r, source: 'LRCLIB' }; }
    return { lines: plainLines(j.plainLyrics || ''), synced: false, source: 'LRCLIB' };
  }

  async function getJSON(url) {
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('El buscador de letras no responde');
    return r.json();
  }

  async function search(params) {
    return (await getJSON(BASE + '/search?' + new URLSearchParams(params))) || [];
  }

  // Busca la mejor letra: preferimos la sincronizada y con la duración más parecida
  async function find({ title, artist, album, durationMs }) {
    const t = cleanTitle(title);
    const a = String(artist || '').split(/,|&| feat\.? | ft\.? /i)[0].trim();
    const dur = durationMs ? durationMs / 1000 : 0;
    if (t && a && album && dur) {
      try {
        const j = await getJSON(BASE + '/get?' + new URLSearchParams({ track_name: t, artist_name: a, album_name: album, duration: Math.round(dur) }));
        if (j && (j.syncedLyrics || j.plainLyrics || j.instrumental)) return fromEntry(j);
      } catch (e) { /* se intenta con la búsqueda */ }
    }
    let list = [];
    if (t && a) list = await search({ track_name: t, artist_name: a });
    if (!list.length) list = await search({ q: [t, a].filter(Boolean).join(' ') });
    // solo letras de ESTA canción: antes se cogía el primer resultado aunque fuera de otra
    const norm = (s) => deaccent(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
    const nt = norm(t), na = norm(a);
    const sameTitle = (x) => { const y = norm(cleanTitle(x.trackName)); return y === nt || (nt.length >= 4 && y.length >= 4 && (y.startsWith(nt) || nt.startsWith(y))); };
    const sameArtist = (x) => {
      if (!na) return true;
      const y = norm(x.artistName);
      if (y.includes(na) || na.includes(y)) return true;
      const ws = na.split(' ').filter((w) => w.length > 2);
      return ws.length > 0 && ws.filter((w) => y.split(' ').includes(w)).length >= Math.ceil(ws.length / 2);
    };
    const sameLength = (x) => !dur || !x.duration || Math.abs(x.duration - dur) <= 20;
    list = list.filter((x) => (x.syncedLyrics || x.plainLyrics || x.instrumental) && sameTitle(x) && sameArtist(x) && sameLength(x));
    if (!list.length) return null;
    const score = (x) => (x.syncedLyrics ? 10 : 0) - (dur && x.duration ? Math.min(10, Math.abs(x.duration - dur)) : 3)
      + (deaccent(String(x.trackName).toLowerCase()) === deaccent(t.toLowerCase()) ? 4 : 0);
    list.sort((x, y) => score(y) - score(x));
    return fromEntry(list[0]);
  }

  return { find, search, fromEntry, fromText, parseLRC, plainLines, toLRC, cleanTitle };
})();
