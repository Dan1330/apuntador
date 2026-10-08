'use strict';
/* Canto: tus canciones (letra sincronizada, aprenderla de memoria, cantarla con afinador) y la clase de canto */

/* ============ DATOS ============ */
const _songSavers = new Map();
function saveSong(song, now = false) {
  if (!song) return;
  song.updated = Date.now();
  let f = _songSavers.get(song.id);
  if (!f) { f = debounce(() => DB.putSong(song).catch((e) => toast('No se pudo guardar: ' + e.message)), 500); _songSavers.set(song.id, f); }
  if (now) f.flush(); else f();
}
function flushSongs() { for (const f of _songSavers.values()) f.flush(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSongs(); });
window.addEventListener('pagehide', flushSongs);

const saveSing = debounce(() => DB.set('sing', App.sing), 300);
const SING_DEFAULT = () => ({ range: null, history: [], best: {} });

function newSong({ title, artist = '', album = '', durationMs = 0, spotify = null, cover = null, lyrics = null }) {
  return {
    id: uid(), kind: 'song', title: (title || 'Canción sin título').trim(), artist: (artist || '').trim(), album, durationMs,
    spotify, cover, lyrics: lyrics || { lines: [], synced: false, source: '' }, audio: null,
    prog: {}, log: { days: {}, secs: 0 }, ui: { level: 0, learnLevel: 3 },
    created: Date.now(), updated: Date.now(), opened: Date.now(),
  };
}

function normalizeSong(sg) {
  sg.lyrics = sg.lyrics || { lines: [], synced: false, source: '' };
  sg.lyrics.lines = sg.lyrics.lines || [];
  sg.prog = sg.prog || {};
  sg.log = sg.log || { days: {}, secs: 0 };
  sg.log.days = sg.log.days || {};
  sg.ui = Object.assign({ level: 0, learnLevel: 3 }, sg.ui || {});
  return sg;
}

const songLines = (sg) => sg.lyrics.lines;
const songSingable = (sg) => songLines(sg).map((l, i) => (l.text ? i : -1)).filter((i) => i >= 0);

function songMastery(sg) {
  const idx = songSingable(sg);
  if (!idx.length) return 0;
  const sum = idx.reduce((a, i) => a + ((sg.prog[i] && sg.prog[i].l) || 0), 0);
  return Math.round((sum / (5 * idx.length)) * 100);
}

// Línea que suena en `pos` (ms); -1 antes de la primera
function activeLine(lines, pos) {
  let k = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].t != null && lines[i].t <= pos + 150) k = i; else if (lines[i].t != null) break; }
  return k;
}
function lineEnd(lines, i) {
  for (let j = i + 1; j < lines.length; j++) if (lines[j].t != null) return lines[j].t;
  return lines[i].t + 6000;
}

const fmtTime = (ms) => { const s = Math.max(0, Math.round((ms || 0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function songCoverHTML(sg, cls = '') {
  return sg.cover && sg.cover.src
    ? `<div class="song-cover ${cls}"><img src="${esc(sg.cover.src)}" alt="" decoding="async"></div>`
    : `<div class="song-cover ${cls} blank">${icon('music', 'lg')}</div>`;
}

/* ============ REPRODUCTOR ============
 * Tres fuentes: un audio tuyo guardado en el móvil (funciona sin conexión, permite ir más lento),
 * Spotify (controla tu app de Spotify; necesita Premium) o ninguna (solo la letra).
 */
const SongPlayer = {
  song: null, kind: 'none', audio: null, url: null,
  sp: { pos: 0, at: 0, playing: false },
  loop: null, stopAt: null, onTick: null, _timer: null, _poll: null, _seeking: false,

  async attach(song) {
    this.detach();
    this.song = song;
    if (song.audio && song.audio.key) {
      const blob = await DB.songAudioGet(song.audio.key);
      if (blob && this.song === song) {
        const a = new Audio();
        a.preload = 'auto';
        this.url = URL.createObjectURL(blob);
        a.src = this.url;
        try { a.preservesPitch = true; a.webkitPreservesPitch = true; } catch (e) { /* nada */ }
        ['play', 'pause', 'ended'].forEach((ev) => a.addEventListener(ev, () => this._emit()));
        a.addEventListener('loadedmetadata', () => {
          if (isFinite(a.duration) && Math.abs(a.duration * 1000 - (song.durationMs || 0)) > 1500) { song.durationMs = Math.round(a.duration * 1000); saveSong(song); this._emit(); }
        });
        this.audio = a;
        this.kind = 'file';
      }
    }
    if (this.kind === 'none' && song.spotify && Spotify.connected()) { this.kind = 'spotify'; this._pollNow(); }
    this._timer = setInterval(() => this._tick(), 120);
  },

  detach() {
    clearInterval(this._timer);
    clearTimeout(this._poll);
    if (this.audio) { try { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); } catch (e) { /* nada */ } }
    if (this.url) URL.revokeObjectURL(this.url);
    Object.assign(this, { song: null, kind: 'none', audio: null, url: null, loop: null, stopAt: null, onTick: null, _seeking: false });
    this.sp = { pos: 0, at: 0, playing: false };
  },

  duration() {
    if (this.kind === 'file' && isFinite(this.audio.duration)) return this.audio.duration * 1000;
    return (this.song && this.song.durationMs) || 0;
  },
  position() {
    if (this.kind === 'file') return this.audio.currentTime * 1000;
    if (this.kind === 'spotify') return this.sp.playing ? this.sp.pos + (performance.now() - this.sp.at) : this.sp.pos;
    return 0;
  },
  playing() {
    if (this.kind === 'file') return !this.audio.paused && !this.audio.ended;
    return this.kind === 'spotify' && this.sp.playing;
  },

  async play(fromMs) {
    if (this.kind === 'file') {
      if (fromMs != null) this.audio.currentTime = fromMs / 1000;
      await this.audio.play();
    } else if (this.kind === 'spotify') {
      const from = fromMs != null ? fromMs : this.position();
      await Spotify.play(this.song.spotify.uri, from);
      this.sp = { pos: from, at: performance.now(), playing: true };
      this._schedulePoll(1800);
    } else return;
    this._emit();
  },
  async pause() {
    if (this.kind === 'file') this.audio.pause();
    else if (this.kind === 'spotify') {
      this.sp = { pos: this.position(), at: performance.now(), playing: false };
      this._emit();
      await Spotify.pause().catch(() => {});
    }
    this._emit();
  },
  async toggle() { if (this.playing()) await this.pause(); else await this.play(); },
  async seek(ms) {
    ms = clamp(ms, 0, Math.max(0, this.duration() - 500) || ms);
    if (this.kind === 'file') this.audio.currentTime = ms / 1000;
    else if (this.kind === 'spotify') {
      const was = this.sp.playing;
      this.sp = { pos: ms, at: performance.now(), playing: was };
      if (was) {
        this._seeking = true;
        try { await Spotify.seek(ms); } finally { this._seeking = false; }
        this.sp = { pos: ms, at: performance.now(), playing: true };
      }
    }
    this._emit();
  },
  setRate(r) { if (this.kind === 'file') this.audio.playbackRate = r; },
  rate() { return this.kind === 'file' ? this.audio.playbackRate : 1; },
  // reproduce un trozo y se para solo (escuchar una frase)
  playRange(a, b) { this.stopAt = b; return this.play(a); },

  _tick() {
    if (!this.song) return;
    const pos = this.position();
    if (this.playing() && !this._seeking) {
      if (this.loop && pos >= this.loop.b) { this.seek(this.loop.a); return; }
      if (this.stopAt != null && pos >= this.stopAt) { this.stopAt = null; this.pause(); return; }
    }
    this._emit(pos);
  },
  _emit(pos) { if (this.onTick) { try { this.onTick(pos != null ? pos : this.position()); } catch (e) { console.warn(e); } } },
  _schedulePoll(ms) { clearTimeout(this._poll); this._poll = setTimeout(() => this._pollNow(), ms); },
  async _pollNow() {
    if (this.kind !== 'spotify') return;
    if (document.visibilityState === 'hidden' || this._seeking) { this._schedulePoll(2500); return; }
    const song = this.song;
    try {
      const st = await Spotify.state();
      if (this.song !== song || this.kind !== 'spotify') return;
      const same = st && st.track && (st.track.id === song.spotify.id || (deaccent(st.track.title.toLowerCase()) === deaccent(song.title.toLowerCase())));
      if (same) this.sp = { pos: st.progress, at: st.at, playing: st.playing };
      else if (this.sp.playing) this.sp = { pos: this.position(), at: performance.now(), playing: false }; // suena otra cosa
      this._emit();
    } catch (e) { /* sin conexión: se reintenta */ }
    this._schedulePoll(this.sp.playing ? 2500 : 5000);
  },
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && SongPlayer.kind === 'spotify') SongPlayer._pollNow(); });

async function playerAction(fn) {
  try { await fn(); }
  catch (e) {
    if (e && e.code === 'nodevice' && SongPlayer.song && SongPlayer.song.spotify) {
      const ok = await confirmSheet({ title: 'Abre Spotify', text: 'No hay ningún Spotify abierto. Lo abro con esta canción: dale a reproducir un segundo y vuelve aquí.', ok: 'Abrir Spotify' });
      if (ok) window.open(SongPlayer.song.spotify.url, '_blank', 'noopener');
    } else if (e && e.name === 'NotAllowedError') toast('Toca otra vez para reproducir');
    else toast((e && e.message) || 'No se pudo reproducir', 4000);
  }
}

/* ============ CARTELERA: sección de canto ============ */
function songsSectionHTML() {
  const list = App.songs.slice().sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated));
  const R = App.sing.range;
  return `<div class="sec-head"><h2>Canto</h2><span class="muted">${list.length ? plural(list.length, 'canción', 'canciones') : ''}</span></div>
    <section class="coach-card" data-act="go" data-to="/canto" tabindex="0" aria-label="Clase de canto">
      <span class="coach-ic">${icon('mic', 'lg')}</span>
      <span class="grow"><span class="eyebrow">Clase de canto</span><b>${R ? `Eres ${esc(R.type)} · ${Pitch.nameOf(R.lo)}–${Pitch.nameOf(R.hi)}` : 'Descubre tu tipo de voz'}</b>
        <small>${coachTodayText()}</small></span><span class="chev">${icon('right')}</span></section>
    ${list.length ? `<div class="list mt-s">${list.map(songRowHTML).join('')}</div>` : ''}
    <button class="btn surface block mt-s" data-act="addSong">${icon('music', 'sm')} Añadir canción</button>`;
}

function songRowHTML(sg) {
  const n = songSingable(sg).length;
  const sub = [sg.artist, n ? `${songMastery(sg)}% aprendida` : 'sin letra'].filter(Boolean).join(' · ');
  return `<button class="row" data-act="openSong" data-id="${sg.id}">${songCoverHTML(sg, 'thumb')}
    <span class="grow"><b>${esc(sg.title)}</b><small>${esc(sub)}</small></span><span class="chev">${icon('right', 'sm')}</span></button>`;
}

function coachTodayText() {
  const today = todayKey();
  const done = new Set(App.sing.history.filter((h) => todayKey(new Date(h.t)) === today).map((h) => h.id));
  return done.size ? `Hoy: ${plural(done.size, 'ejercicio hecho', 'ejercicios hechos')}` : 'Calienta la voz con 10 minutos de ejercicios';
}

ACT.openSong = (el) => {
  const sg = App.songs.find((x) => x.id === el.dataset.id);
  if (!sg) return;
  sg.opened = Date.now();
  saveSong(sg);
  go(`/song/${sg.id}`);
};

/* ============ AÑADIR UNA CANCIÓN ============ */
ACT.addSong = async () => {
  if (Sheet.el) await Sheet.close();
  await Spotify.load();
  const sp = Spotify.connected();
  const el = Sheet.open(`<div class="sheet-body"><h3>Nueva canción</h3>
      <div class="cover-search"><input class="input" id="sgQ" type="search" placeholder="Canción y artista" autocomplete="off" enterkeyhint="search">
        <button class="btn primary sm" id="sgGo" aria-label="Buscar">${icon('search', 'sm')}</button></div>
      <p class="small muted mt-s">${sp ? 'Busco en Spotify y después su letra.' : 'Busco la letra (muchas vienen con los tiempos para cantar a la vez). Conecta Spotify en Ajustes para oírla aquí.'}</p></div>
    <div id="sgRes"></div>
    <div class="sheet-body" style="padding-bottom:4px"><h4>Otras formas</h4></div>
    <div class="list">
      ${sp ? rowHTML({ ic: 'music', title: 'Lo que suena ahora en Spotify', attrs: 'id="sgNow"' })
    : rowHTML({ ic: 'link', title: 'Conectar Spotify', sub: 'Con tu propia clave (gratis, 5 minutos)', attrs: 'id="sgSp"' })}
      ${rowHTML({ ic: 'upload', title: 'Subir el audio (mp3, m4a…)', sub: 'Se guarda en el móvil: sin conexión y a menos velocidad', attrs: 'id="sgFile"' })}
      ${rowHTML({ ic: 'paste', title: 'Pegar la letra a mano', attrs: 'id="sgPaste"' })}
    </div><div style="height:14px"></div>`);
  const res = el.querySelector('#sgRes');
  const q = el.querySelector('#sgQ');
  let list = [];
  const search = async () => {
    const text = q.value.trim();
    if (!text) return;
    res.innerHTML = '<p class="muted small sheet-body">Buscando…</p>';
    try {
      list = sp ? await Spotify.search(text) : (await Lyrics.search({ q: text })).slice(0, 15);
    } catch (e) { res.innerHTML = `<p class="small sheet-body" style="color:var(--bad)">${esc(e.message || 'No se pudo buscar')}</p>`; return; }
    if (!Sheet.el) return;
    res.innerHTML = list.length ? `<div class="list">${list.map((t, i) => sp
      ? `<button class="row" data-i="${i}">${t.img ? `<div class="song-cover thumb"><img src="${esc(t.img)}" alt="" loading="lazy"></div>` : `<div class="song-cover thumb blank">${icon('music')}</div>`}<span class="grow"><b>${esc(t.title)}</b><small>${esc(t.artist)} · ${fmtTime(t.durationMs)}</small></span></button>`
      : `<button class="row" data-i="${i}"><span class="ri">${icon('music')}</span><span class="grow"><b>${esc(t.trackName)}</b><small>${esc(t.artistName)}${t.duration ? ' · ' + fmtTime(t.duration * 1000) : ''}${t.syncedLyrics ? ' · con tiempos' : ''}</small></span></button>`).join('')}</div>`
      : '<p class="muted small sheet-body">No he encontrado nada. Prueba con otras palabras.</p>';
    res.querySelectorAll('[data-i]').forEach((b) => {
      b.onclick = async () => {
        const t = list[Number(b.dataset.i)];
        await Sheet.close();
        if (sp) await createFromTrack(t);
        else await saveNewSong(newSong({ title: t.trackName, artist: t.artistName, album: t.albumName, durationMs: Math.round((t.duration || 0) * 1000), lyrics: Lyrics.fromEntry(t) }));
      };
    });
  };
  el.querySelector('#sgGo').onclick = search;
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  setTimeout(() => q.focus(), 260);
  const now = el.querySelector('#sgNow');
  if (now) {
    now.onclick = async () => {
      try {
        const st = await Spotify.state();
        if (!st || !st.track) { toast('Ahora mismo no suena nada en Spotify'); return; }
        await Sheet.close();
        await createFromTrack(st.track);
      } catch (e) { toast(e.message, 4000); }
    };
  }
  const spBtn = el.querySelector('#sgSp');
  if (spBtn) spBtn.onclick = () => nav('/settings?sec=spotify');
  // el clic en el selector de archivos tiene que ocurrir dentro del toque
  el.querySelector('#sgFile').onclick = () => { App.audioTarget = null; $('#songAudioIn').click(); Sheet.close(); };
  el.querySelector('#sgPaste').onclick = async () => { await Sheet.close(); pasteSong(); };
};

async function createFromTrack(t) {
  Busy.show('Buscando la letra…');
  let lyrics = null;
  try { lyrics = await Lyrics.find({ title: t.title, artist: t.firstArtist || t.artist, album: t.album, durationMs: t.durationMs }); } catch (e) { console.warn(e); }
  let cover = t.img ? { src: t.img } : null;
  if (t.img) { try { const d = await Covers.toDataURL(t.img); cover = { src: d.src }; } catch (e) { /* se queda el enlace */ } }
  Busy.hide();
  const sg = newSong({ title: t.title, artist: t.artist, album: t.album, durationMs: t.durationMs, cover, lyrics,
    spotify: { id: t.id, uri: t.uri, url: t.url } });
  await saveNewSong(sg);
  if (!lyrics || !lyrics.lines.length) toast(lyrics && lyrics.instrumental ? 'Es instrumental: no tiene letra' : 'No he encontrado la letra: puedes pegarla desde ⋮', 4500);
}

async function saveNewSong(sg) {
  App.songs.push(sg);
  await DB.putSong(sg);
  DB.persist();
  go(`/song/${sg.id}`);
}

async function pasteSong() {
  const title = await promptSheet({ title: 'Título de la canción', placeholder: 'Ej.: Bésame mucho' });
  if (!title || !title.trim()) return;
  const artist = await promptSheet({ title: 'Artista (opcional)', placeholder: 'Ej.: Consuelo Velázquez' });
  const text = await promptSheet({ title: 'Letra', multiline: true, ok: 'Guardar', hint: 'Una frase por línea. Deja una línea en blanco entre estrofas. Si la copias con tiempos [01:23.45] se sincroniza sola.' });
  if (text == null || !text.trim()) return;
  await saveNewSong(newSong({ title, artist: artist || '', lyrics: Lyrics.fromText(text) }));
}

// Duración de un audio (sin reproducirlo)
function audioDuration(blob) {
  return new Promise((res) => {
    const a = new Audio();
    const u = URL.createObjectURL(blob);
    const done = (v) => { URL.revokeObjectURL(u); res(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
    a.onerror = () => done(-1);
    setTimeout(() => done(0), 6000);
    a.src = u;
  });
}

async function onSongAudioFile(file) {
  const target = App.audioTarget;
  App.audioTarget = null;
  if (!file) return;
  if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i.test(file.name)) { toast('Eso no parece un archivo de audio'); return; }
  Busy.show('Guardando el audio en el móvil…');
  try {
    const dur = await audioDuration(file);
    if (dur < 0) throw new Error('Este móvil no puede reproducir ese formato. Prueba con mp3 o m4a.');
    const key = 'sa-' + uid();
    await DB.songAudioPut(key, file);
    DB.persist();
    if (target) {
      if (target.audio) await DB.songAudioDelete(target.audio.key);
      target.audio = { key, name: file.name, type: file.type, size: file.size };
      if (dur) target.durationMs = dur;
      saveSong(target, true);
      Busy.hide();
      toast('Audio guardado');
      if (SongPlayer.song === target) await SongPlayer.attach(target);
      rerender();
      return;
    }
    // canción nueva: «Artista - Título.mp3»
    const base = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').replace(/^\d+[\s.-]+/, '').trim();
    const m = base.match(/^(.+?)\s+[-–]\s+(.+)$/);
    const sg = newSong({ title: m ? m[2] : base, artist: m ? m[1] : '', durationMs: dur });
    sg.audio = { key, name: file.name, type: file.type, size: file.size };
    Busy.show('Buscando la letra…');
    try { if (navigator.onLine !== false) sg.lyrics = (await Lyrics.find({ title: sg.title, artist: sg.artist, durationMs: dur })) || sg.lyrics; } catch (e) { /* sin letra */ }
    Busy.hide();
    await saveNewSong(sg);
    if (!sg.lyrics.lines.length) toast('No he encontrado la letra: pégala desde ⋮ o corrige el título', 4500);
  } catch (e) {
    Busy.hide();
    alertSheet('No se pudo guardar el audio', e.message || String(e));
  }
}

/* ============ PANTALLA DE UNA CANCIÓN ============ */
async function viewSongRoute(sg, tab, sub) {
  App.curSong = sg;
  if (SongPlayer.song !== sg) await SongPlayer.attach(sg);
  if (App.curSong !== sg) return;
  if (tab === 'learn') return sub === 'run' ? LearnSess.start(sg, parseHash().q.get('m') || 'all') : viewSongLearn(sg);
  if (tab === 'sing') return viewSongSing(sg);
  if (tab === 'sync') return SyncSess.start(sg);
  return viewSongLyrics(sg);
}

function songTabbarHTML(sg, active) {
  const tabs = [['lyrics', 'music', 'Letra'], ['learn', 'cards', 'Aprender'], ['sing', 'mic', 'Cantar']];
  return `<nav class="tabbar" aria-label="Secciones">${tabs.map(([k, ic, l]) =>
    `<button class="tab ${active === k ? 'on' : ''}" data-act="go" data-to="/song/${sg.id}/${k}" data-replace="1" ${active === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></button>`).join('')}</nav>`;
}

function songHeroHTML(sg) {
  const L = sg.lyrics;
  const src = SongPlayer.kind === 'file' ? 'Audio en el móvil' : SongPlayer.kind === 'spotify' ? 'Spotify' : sg.spotify ? 'Spotify (sin conectar)' : 'Sin audio';
  return `<header class="topbar float"><button class="icon-btn" data-act="go" data-to="/" aria-label="Volver a la cartelera">${icon('back')}</button>
      <span class="grow"></span><button class="icon-btn" data-act="songMenu" aria-label="Opciones de la canción">${icon('more')}</button></header>
    <section class="shero"><div class="shero-bg" style="${sg.cover && sg.cover.src ? `background-image:url('${esc(sg.cover.src)}')` : 'background:linear-gradient(135deg,#5a1020,#1c0b10)'}"></div>
      <div class="shero-in">${songCoverHTML(sg, 'hero')}
        <div class="grow"><h1>${esc(sg.title)}</h1>${sg.artist ? `<p class="sub">${esc(sg.artist)}</p>` : ''}
          <div class="pill-row"><span class="pill glass">${L.lines.length ? (L.synced ? 'Letra con tiempos' : 'Letra sin tiempos') : 'Sin letra'}</span><span class="pill glass">${esc(src)}</span></div></div></div></section>`;
}

function playerDockHTML(sg) {
  const k = SongPlayer.kind;
  if (k === 'none') {
    return `<div class="pdock"><div class="pd-none"><span class="grow small">${sg.spotify ? 'Conecta Spotify o sube el audio para oírla aquí.' : 'Sube el audio o enlázala con Spotify para oírla aquí.'}</span>
      <button class="btn sm primary" data-act="songAddAudio">${icon('upload', 'sm')} Audio</button>${sg.spotify && !Spotify.connected() ? `<button class="btn sm soft" data-act="go" data-to="/settings?sec=spotify">Spotify</button>` : ''}</div></div>`;
  }
  const dur = SongPlayer.duration();
  return `<div class="pdock">
    <div class="pd-bar"><span id="pdCur">0:00</span><input type="range" id="pdSeek" min="0" max="${Math.round(dur) || 1}" step="250" value="0" aria-label="Posición"><span id="pdDur">${fmtTime(dur)}</span></div>
    <div class="pd-btns">
      <button class="icon-btn" data-act="pdJump" data-d="-5000" aria-label="Atrás 5 segundos">${icon('rewind')}</button>
      <button class="pd-play" data-act="pdPlay" id="pdPlay" aria-label="Reproducir">${icon('play')}</button>
      <button class="icon-btn" data-act="pdJump" data-d="5000" aria-label="Adelante 5 segundos">${icon('forward')}</button>
      <button class="icon-btn pd-loop ${SongPlayer.loop ? 'on' : ''}" data-act="pdLoop" id="pdLoop" aria-label="Repetir esta frase">${icon('repeat')}</button>
      ${k === 'file' ? `<button class="pd-rate" data-act="pdRate" id="pdRate" aria-label="Velocidad">${SongPlayer.rate()}×</button>`
    : `<button class="icon-btn" data-act="songOpenSpotify" aria-label="Abrir en Spotify">${icon('link')}</button>`}
    </div></div>`;
}

// Enlaza la barra del reproductor con la pantalla; extra(pos) se llama en cada actualización
function bindDock(extra) {
  const seek = $('#pdSeek');
  let dragging = false;
  if (seek) {
    seek.addEventListener('input', () => { dragging = true; const c = $('#pdCur'); if (c) c.textContent = fmtTime(Number(seek.value)); });
    seek.addEventListener('change', () => { dragging = false; playerAction(() => SongPlayer.seek(Number(seek.value))); });
  }
  let wasPlaying = null;
  SongPlayer.onTick = (pos) => {
    const p = SongPlayer.playing();
    if (p !== wasPlaying) { wasPlaying = p; const b = $('#pdPlay'); if (b) { b.innerHTML = icon(p ? 'pause' : 'play'); b.setAttribute('aria-label', p ? 'Pausa' : 'Reproducir'); } }
    if (seek && !dragging) {
      const dur = SongPlayer.duration();
      if (dur && Number(seek.max) !== Math.round(dur)) { seek.max = Math.round(dur); const d = $('#pdDur'); if (d) d.textContent = fmtTime(dur); }
      seek.value = pos;
      const c = $('#pdCur'); if (c) c.textContent = fmtTime(pos);
    }
    if (extra) extra(pos);
  };
  App.cleanup = () => { SongPlayer.onTick = null; };
}

ACT.pdPlay = () => playerAction(() => SongPlayer.toggle());
ACT.pdJump = (el) => playerAction(() => SongPlayer.seek(SongPlayer.position() + Number(el.dataset.d)));
ACT.pdRate = (el) => {
  const rates = [1, 0.85, 0.7, 0.5];
  const r = rates[(rates.indexOf(SongPlayer.rate()) + 1) % rates.length];
  SongPlayer.setRate(r);
  el.textContent = r + '×';
  toast(r === 1 ? 'Velocidad normal' : `Más despacio (${r}×), sin cambiar el tono`);
};
ACT.pdLoop = (el) => {
  const sg = SongPlayer.song;
  if (!sg) return;
  if (SongPlayer.loop) { SongPlayer.loop = null; el.classList.remove('on'); toast('Repetición desactivada'); return; }
  const lines = songLines(sg);
  if (!sg.lyrics.synced) { toast('Para repetir una frase la letra necesita tiempos (⋮ → Sincronizar)', 4000); return; }
  let i = activeLine(lines, SongPlayer.position());
  if (i < 0) i = lines.findIndex((l) => l.text);
  if (i < 0) return;
  SongPlayer.loop = { a: Math.max(0, lines[i].t - 300), b: lineEnd(lines, i) };
  el.classList.add('on');
  toast('Repitiendo: «' + lines[i].text.slice(0, 40) + '»');
  if (!SongPlayer.playing()) playerAction(() => SongPlayer.play(SongPlayer.loop.a));
};
ACT.songOpenSpotify = () => { const sg = SongPlayer.song; if (sg && sg.spotify) window.open(sg.spotify.url, '_blank', 'noopener'); };
ACT.songAddAudio = () => { App.audioTarget = App.curSong; $('#songAudioIn').click(); };

/* ---------- Letra (karaoke) ---------- */
const LY_LEVELS = [['0', 'Todo'], ['1', 'Algo'], ['2', 'Mitad'], ['3', 'Iniciales'], ['4', 'Nada']];

function lyricsHTML(sg) {
  const lines = songLines(sg), lvl = Number(sg.ui.level) || 0;
  return lines.map((l, i) => (l.text
    ? `<p class="ly" id="ly-${i}" data-act="lyLine" data-i="${i}">${renderSpeech(l.text, { level: lvl, seed: i + 1 })}</p>`
    : sg.lyrics.synced ? `<p class="ly gap" id="ly-${i}">♪</p>` : '<div class="ly-sep"></div>')).join('');
}

function viewSongLyrics(sg) {
  const L = sg.lyrics;
  const hasPlayer = SongPlayer.kind !== 'none';
  let notice = '';
  if (!L.lines.length) {
    notice = `<div class="empty">${icon('music')}<p>${L.instrumental ? 'Esta canción es instrumental.' : 'Todavía no tiene letra.'}</p>
      <div class="btn-row mt" style="max-width:420px;margin-left:auto;margin-right:auto"><button class="btn primary" data-act="songFindLyrics">${icon('search', 'sm')} Buscarla</button><button class="btn surface" data-act="songEditLyrics">${icon('paste', 'sm')} Pegarla</button></div></div>`;
  } else if (!L.synced && hasPlayer) {
    notice = `<div class="banner">${icon('clock')}<span class="grow">Esta letra no tiene tiempos. Sincronízala tocando la pantalla al ritmo de la canción.</span><button class="btn sm primary" data-act="go" data-to="/song/${sg.id}/sync">Sincronizar</button></div>`;
  }
  mount(`${songHeroHTML(sg)}
  <main class="page song-page">
    ${notice}
    ${L.lines.length ? `<div class="field mt-s"><span>Para aprenderla de memoria: esconder palabras</span>${segHTML('lyLevel', sg.ui.level || 0, LY_LEVELS)}</div>
    <p class="hint">${L.synced && hasPlayer ? 'Toca una frase para ir a ella. Las palabras escondidas aparecen cuando la frase ya ha sonado.' : 'Toca una palabra escondida para verla.'}</p>
    <div class="lyrics" id="lyrics">${lyricsHTML(sg)}</div>
    ${L.source ? `<p class="small muted mt">Letra: ${esc(L.source)}</p>` : ''}` : ''}
  </main>
  ${playerDockHTML(sg)}
  ${songTabbarHTML(sg, 'lyrics')}`);

  let cur = -2, userScroll = 0;
  App.lyricsRepaint = () => { cur = -2; SongPlayer._emit(); };
  const mark = () => { userScroll = Date.now(); };
  window.addEventListener('touchmove', mark, { passive: true });
  window.addEventListener('wheel', mark, { passive: true });
  const lines = songLines(sg);
  bindDock((pos) => {
    if (!L.synced) return;
    const i = activeLine(lines, pos);
    if (i === cur) return;
    cur = i;
    $$('#lyrics .ly').forEach((p) => {
      const k = Number(p.id.slice(3));
      p.classList.toggle('on', k === i);
      p.classList.toggle('past', k < i);
    });
    const el = i >= 0 && document.getElementById('ly-' + i);
    if (el && SongPlayer.playing() && Date.now() - userScroll > 2500) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  const prevClean = App.cleanup;
  App.cleanup = () => { prevClean && prevClean(); window.removeEventListener('touchmove', mark); window.removeEventListener('wheel', mark); };
}

ACT.lyLevel = (el) => {
  const sg = App.curSong;
  sg.ui.level = Number(el.dataset.v);
  saveSong(sg);
  el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
  const box = $('#lyrics');
  if (box) box.innerHTML = lyricsHTML(sg);
  if (App.lyricsRepaint) App.lyricsRepaint(); // volver a marcar la frase que suena
};

ACT.lyLine = (el, e) => {
  const sg = App.curSong;
  const w = e.target.closest('.w.ini, .w.hid');
  if (w && !w.closest('.ly.past')) { w.classList.add('rev', 'just'); return; }
  const l = songLines(sg)[Number(el.dataset.i)];
  if (!l || l.t == null || SongPlayer.kind === 'none') return;
  if (SongPlayer.loop) { SongPlayer.loop = null; const lb = $('#pdLoop'); if (lb) lb.classList.remove('on'); }
  playerAction(() => SongPlayer.play(Math.max(0, l.t - 250)));
};

/* ---------- Menú de la canción ---------- */
ACT.songMenu = async () => {
  const sg = App.curSong;
  if (!sg) return;
  const opts = [
    { value: 'find', label: 'Buscar la letra otra vez', icon: 'search' },
    { value: 'edit', label: 'Editar o pegar la letra', icon: 'edit' },
  ];
  if (sg.lyrics.lines.length && SongPlayer.kind !== 'none') opts.push({ value: 'sync', label: 'Sincronizar tocando', sub: 'Marca cuándo empieza cada frase', icon: 'clock' });
  opts.push({ value: 'audio', label: sg.audio ? 'Cambiar el audio' : 'Añadir el audio (mp3, m4a…)', sub: 'Se guarda en el móvil y funciona sin conexión', icon: 'upload' });
  if (sg.audio) opts.push({ value: 'noaudio', label: 'Quitar el audio', icon: 'close' });
  opts.push({ value: 'spotify', label: sg.spotify ? 'Cambiar la canción de Spotify' : 'Enlazar con Spotify', icon: 'link' });
  if (sg.spotify) opts.push({ value: 'open', label: 'Abrir en Spotify', icon: 'music' });
  opts.push({ value: 'rename', label: 'Título y artista', icon: 'edit' },
    { value: 'reset', label: 'Reiniciar lo aprendido', icon: 'reset' },
    { value: 'delete', label: 'Eliminar canción', icon: 'trash', danger: true });
  const v = await chooseSheet({ title: sg.title, options: opts });
  if (v === 'find') return ACT.songFindLyrics();
  if (v === 'edit') return ACT.songEditLyrics();
  if (v === 'sync') return go(`/song/${sg.id}/sync`);
  if (v === 'audio') return ACT.songAddAudio();
  if (v === 'open') return ACT.songOpenSpotify();
  if (v === 'noaudio') {
    if (!(await confirmSheet({ title: '¿Quitar el audio?', text: 'Se borrará del móvil. La letra y tu progreso se mantienen.', ok: 'Quitar', danger: true }))) return;
    await DB.songAudioDelete(sg.audio.key);
    sg.audio = null;
    saveSong(sg, true);
    await SongPlayer.attach(sg);
    return rerender();
  }
  if (v === 'spotify') return linkSpotify(sg);
  if (v === 'rename') {
    const t = await promptSheet({ title: 'Título', value: sg.title });
    if (t && t.trim()) sg.title = t.trim();
    const a = await promptSheet({ title: 'Artista', value: sg.artist || '' });
    if (a != null) sg.artist = a.trim();
    saveSong(sg);
    return rerender();
  }
  if (v === 'reset') {
    if (!(await confirmSheet({ title: '¿Reiniciar lo aprendido?', text: 'Se borra tu progreso con esta letra.', ok: 'Reiniciar', danger: true }))) return;
    sg.prog = {};
    saveSong(sg, true);
    return rerender();
  }
  if (v === 'delete') {
    if (!(await confirmSheet({ title: '¿Eliminar esta canción?', text: `Se borrarán «${esc(sg.title)}», su letra, su audio y tu progreso.`, ok: 'Eliminar', danger: true }))) return;
    SongPlayer.detach();
    if (sg.audio) await DB.songAudioDelete(sg.audio.key);
    await DB.deleteSong(sg.id);
    App.songs = App.songs.filter((x) => x.id !== sg.id);
    toast('Canción eliminada');
    go('/', true);
  }
};

ACT.songFindLyrics = async () => {
  const sg = App.curSong;
  Busy.show('Buscando la letra…');
  let r = null;
  try { r = await Lyrics.find({ title: sg.title, artist: sg.artist, album: sg.album, durationMs: sg.durationMs }); }
  catch (e) { Busy.hide(); toast(e.message || 'Sin conexión', 4000); return; }
  Busy.hide();
  if (!r || (!r.lines.length && !r.instrumental)) { toast('No la he encontrado. Revisa título y artista, o pégala a mano.', 4500); return; }
  if (sg.lyrics.lines.length && !(await confirmSheet({ title: 'Letra encontrada', text: `${r.synced ? 'Viene con tiempos. ' : ''}¿Sustituyo la letra actual? Tu progreso con la letra se reiniciará.`, ok: 'Sustituir' }))) return;
  sg.lyrics = r;
  sg.prog = {};
  saveSong(sg, true);
  rerender();
};

ACT.songEditLyrics = async () => {
  const sg = App.curSong;
  const text = await promptSheet({ title: 'Letra', value: Lyrics.toLRC(sg.lyrics.lines), multiline: true, ok: 'Guardar',
    hint: 'Una frase por línea. Los tiempos entre corchetes [mm:ss.cc] son opcionales: si los quitas, podrás sincronizarla tocando.' });
  if (text == null) return;
  const before = sg.lyrics.lines.map((l) => l.text).join('\n');
  sg.lyrics = text.trim() ? Lyrics.fromText(text) : { lines: [], synced: false, source: '' };
  if (sg.lyrics.lines.map((l) => l.text).join('\n') !== before) sg.prog = {};
  saveSong(sg, true);
  rerender();
};

async function linkSpotify(sg) {
  await Spotify.load();
  if (!Spotify.connected()) { const ok = await confirmSheet({ title: 'Conecta Spotify', text: 'Primero conecta tu cuenta en Ajustes, con tu propia clave de Spotify.', ok: 'Ir a Ajustes' }); if (ok) nav('/settings?sec=spotify'); return; }
  let list = [];
  try { list = await Spotify.search([sg.title, sg.artist].filter(Boolean).join(' ')); } catch (e) { toast(e.message, 4000); return; }
  if (!list.length) { toast('No la encuentro en Spotify'); return; }
  const id = await chooseSheet({ title: '¿Cuál es?', options: list.map((t) => ({ value: t.id, label: t.title, sub: `${t.artist} · ${fmtTime(t.durationMs)}`, icon: 'music' })) });
  const t = list.find((x) => x.id === id);
  if (!t) return;
  sg.spotify = { id: t.id, uri: t.uri, url: t.url };
  if (!sg.durationMs) sg.durationMs = t.durationMs;
  if (!sg.cover && t.img) { try { sg.cover = { src: (await Covers.toDataURL(t.img)).src }; } catch (e) { sg.cover = { src: t.img }; } }
  saveSong(sg, true);
  await SongPlayer.attach(sg);
  rerender();
}

/* ---------- Sincronizar tocando ---------- */
const SyncSess = {
  start(sg) {
    if (SongPlayer.kind === 'none' || !sg.lyrics.lines.length) return go(`/song/${sg.id}`, true);
    this.sg = sg;
    this.texts = sg.lyrics.lines.filter((l) => l.text).map((l) => l.text);
    this.times = [];
    this.started = false;
    this.render();
    App.cleanup = () => { SongPlayer.pause(); };
  },
  render() {
    const k = this.times.length, n = this.texts.length;
    mount(`<div class="sess-top"><button class="icon-btn" data-act="syncExit" aria-label="Salir">${icon('close')}</button><div class="prog"><i style="width:${Math.round((k / n) * 100)}%"></i></div><span class="count">${k}/${n}</span></div>
    <main class="sess">
      <p class="hint" style="margin-top:6px">${this.started ? 'Toca «¡Ahora!» justo cuando empiece a cantarse la frase de abajo.' : 'Pondré la canción desde el principio. Toca «¡Ahora!» cada vez que empiece la frase marcada.'}</p>
      ${k ? `<div class="ctx"><div class="cx dim">${esc(this.texts[k - 1])}</div></div>` : ''}
      <div class="answer"><div class="txt">${k < n ? esc(this.texts[k]) : '¡Hecho! Guarda los tiempos.'}</div></div>
      ${k + 1 < n ? `<div class="ctx mt"><div class="cx dim">${esc(this.texts[k + 1])}</div></div>` : ''}
    </main>
    <div class="sess-actions"><div class="inner">
      ${this.started ? `<button class="btn soft" data-act="syncUndo" ${k ? '' : 'disabled'}>Deshacer</button>` : ''}
      ${k < n ? `<button class="btn primary" data-act="syncTap">${this.started ? '¡Ahora!' : icon('play', 'sm') + ' Empezar'}</button>` : `<button class="btn primary" data-act="syncSave">${icon('check', 'sm')} Guardar</button>`}
    </div></div>`);
  },
  async tap() {
    if (!this.started) { this.started = true; await playerAction(() => SongPlayer.play(0)); this.render(); return; }
    // se resta el tiempo de reacción habitual
    this.times.push(Math.max(0, Math.round(SongPlayer.position() - 180)));
    this.render();
  },
  undo() {
    const t = this.times.pop();
    if (t != null) playerAction(() => SongPlayer.seek(Math.max(0, t - 3000)));
    this.render();
  },
  save() {
    const sg = this.sg;
    sg.lyrics = { lines: this.texts.map((text, i) => ({ t: this.times[i], text })), synced: true, source: (sg.lyrics.source ? sg.lyrics.source + ' · ' : '') + 'tiempos marcados a mano' };
    saveSong(sg, true);
    SongPlayer.pause();
    toast('Tiempos guardados');
    go(`/song/${sg.id}`, true);
  },
};
ACT.syncTap = () => SyncSess.tap();
ACT.syncUndo = () => SyncSess.undo();
ACT.syncSave = () => SyncSess.save();
ACT.syncExit = async () => {
  const sg = SyncSess.sg;
  if (SyncSess.times.length && !(await confirmSheet({ title: '¿Salir sin guardar?', ok: 'Salir', danger: true }))) return;
  go(`/song/${sg.id}`, true);
};

/* ---------- Aprender la letra ---------- */
function viewSongLearn(sg) {
  const idx = songSingable(sg);
  const pct = songMastery(sg);
  const weak = idx.filter((i) => { const p = sg.prog[i]; return p && p.r > 0 && (p.x > 0 || p.l <= 1); }).length;
  const learned = idx.filter((i) => sg.prog[i] && sg.prog[i].l >= 4).length;
  mount(`${songHeroHTML(sg)}
  <main class="page">
    ${idx.length ? `
    <div class="card learn-top"><div class="ring" style="--p:${pct};--sz:84px;--w:8px"><b style="font-size:20px">${pct}%</b></div>
      <div class="grow"><b>${plural(learned, 'frase sabida', 'frases sabidas')} de ${idx.length}</b><p class="small muted">Te enseño cada frase con la anterior como pista, escondiendo palabras poco a poco.</p></div></div>
    <h3 class="section-title">Aprender de memoria</h3>
    <div class="list">
      ${rowHTML({ ic: 'cards', title: 'Frase a frase', sub: 'Toda la canción, en orden', attrs: `data-act="go" data-to="/song/${sg.id}/learn/run?m=all"` })}
      ${weak ? rowHTML({ ic: 'target', title: 'Las que más me cuestan', sub: plural(weak, 'frase', 'frases'), attrs: `data-act="go" data-to="/song/${sg.id}/learn/run?m=weak"` }) : ''}
      ${rowHTML({ ic: 'layers', title: 'Estrofa a estrofa', sub: 'Elige un trozo', attrs: 'data-act="learnPart"' })}
    </div>
    <h3 class="section-title">Método</h3>
    <div class="card steps">
      <div class="step"><span class="n">1</span><div><b>Léela y escúchala</b><span>En «Letra», con todas las palabras a la vista.</span></div></div>
      <div class="step"><span class="n">2</span><div><b>Recítala sin música</b><span>Aquí, frase a frase: primero con las iniciales, luego sin nada.</span></div></div>
      <div class="step"><span class="n">3</span><div><b>Cántala escondiendo palabras</b><span>En «Letra» sube el nivel hasta «Nada».</span></div></div>
    </div>`
    : `<div class="empty">${icon('music')}<p>Primero necesita la letra.</p><button class="btn primary mt" data-act="songFindLyrics">Buscar la letra</button></div>`}
  </main>
  ${songTabbarHTML(sg, 'learn')}`);
}

ACT.learnPart = async () => {
  const sg = App.curSong;
  const lines = songLines(sg);
  const parts = [];
  let cur = null;
  lines.forEach((l, i) => {
    if (!l.text) { cur = null; return; }
    if (!cur) { cur = { from: i, to: i, first: l.text }; parts.push(cur); }
    cur.to = i;
  });
  // letras sin estrofas marcadas: trozos de 4 frases
  if (parts.length <= 1) {
    parts.length = 0;
    const idx = songSingable(sg);
    for (let k = 0; k < idx.length; k += 4) parts.push({ from: idx[k], to: idx[Math.min(idx.length - 1, k + 3)], first: lines[idx[k]].text });
  }
  const v = await chooseSheet({ title: 'Elige un trozo', options: parts.map((p, k) => ({ value: `${p.from}-${p.to}`, label: `${k + 1}. ${p.first.slice(0, 48)}${p.first.length > 48 ? '…' : ''}`, icon: 'layers' })) });
  if (v) go(`/song/${sg.id}/learn/run?m=${v}`);
};

const LearnSess = {
  start(sg, mode) {
    const idx = songSingable(sg);
    let q = idx;
    if (mode === 'weak') {
      q = idx.filter((i) => { const p = sg.prog[i]; return p && p.r > 0 && (p.x > 0 || p.l <= 1); });
      if (!q.length) { toast('No hay frases que te cuesten. ¡Bien!'); q = idx; }
    } else if (/^\d+-\d+$/.test(mode)) {
      const [a, b] = mode.split('-').map(Number);
      q = idx.filter((i) => i >= a && i <= b);
    }
    if (!q.length) return go(`/song/${sg.id}/learn`, true);
    Object.assign(this, { sg, queue: q.slice(), pos: 0, results: [], t0: Date.now() });
    this.reset();
    App.cleanup = () => this.stop();
    this.render();
  },
  reset() { this.state = 'ask'; this.revealed = new Set(); this.align = null; this.micText = ''; this.listening = false; },
  stop() {
    if (this.listener) { const l = this.listener; this.listener = null; l.stop(); }
    SR.stop();
    TTS.cancel();
    if (SongPlayer.stopAt != null) { SongPlayer.stopAt = null; SongPlayer.pause(); }
    if (this.sg) { const secs = (Date.now() - this.t0) / 1000; if (secs > 3) { const k = todayKey(); this.sg.log.days[k] = (this.sg.log.days[k] || 0) + Math.round(secs); this.sg.log.secs += Math.round(secs); saveSong(this.sg); } this.t0 = Date.now(); }
  },
  cueOf(i) {
    const lines = songLines(this.sg);
    for (let j = i - 1; j >= 0; j--) if (lines[j].text) return lines[j].text;
    return '';
  },
  render() {
    const sg = this.sg, i = this.queue[this.pos], line = songLines(sg)[i];
    const n = this.queue.length;
    const lvl = this.state === 'ask' ? Number(sg.ui.learnLevel) : 0;
    const cue = this.cueOf(i);
    let body = `<div class="answer" id="answer"><div class="txt">${renderSpeech(line.text, { level: lvl, revealed: this.revealed, seed: i + 1, marked: this.align ? this.align.matched : null })}</div>`;
    if (this.align) {
      const pct = Math.round(this.align.score * 100);
      body += `<div class="score-line"><span>${pct}%</span><div class="meter"><i class="${pct >= 90 ? 'ok' : pct >= 60 ? 'warn' : ''}" style="width:${pct}%"></i></div></div>`;
      if (this.micText) body += `<div class="typed">Te he entendido: «${esc(this.micText)}»</div>`;
    } else if (this.listening) body += `<div class="typed" id="micTxt">Te escucho…</div>`;
    body += '</div>';
    const canHear = (line.t != null && SongPlayer.kind !== 'none') || TTS.supported;
    let acts;
    if (this.state === 'rate') {
      const sug = this.align ? Model.gradeFromScore(this.align.score) : -1;
      acts = `<button class="btn grade g0 ${sug === 0 ? 'sug' : ''}" data-act="lsGrade" data-g="0">Otra vez<small>no me la sé</small></button>
        <button class="btn grade g1 ${sug === 1 ? 'sug' : ''}" data-act="lsGrade" data-g="1">Casi<small>con dudas</small></button>
        <button class="btn grade g2 ${sug === 2 ? 'sug' : ''}" data-act="lsGrade" data-g="2">¡La sé!<small>perfecta</small></button>`;
    } else if (this.listening) {
      acts = `<button class="btn primary" data-act="lsStopMic">${icon('check', 'sm')} Ya está</button>`;
    } else {
      acts = `<button class="btn soft" data-act="lsHint">Pista</button>
        ${SR.supported ? `<button class="btn surface" data-act="lsMic">${icon('mic', 'sm')} Recitar</button>` : ''}
        <button class="btn primary" data-act="lsShow">${icon('eye', 'sm')} Ver</button>`;
    }
    mount(`<div class="sess-top"><button class="icon-btn" data-act="lsClose" aria-label="Terminar">${icon('close')}</button><div class="prog"><i style="width:${Math.round((this.pos / n) * 100)}%"></i></div><span class="count">${this.pos + 1}/${n}</span></div>
    <main class="sess">
      <div class="sess-scene">${esc(sg.title)}</div>
      <div class="ctx"><div class="cx cue"><div class="who" style="color:var(--muted)">${cue ? 'Viene después de…' : 'Empieza la canción'}</div><div class="txt">${cue ? esc(cue) : '♪'}</div></div></div>
      ${body}
      ${this.state === 'ask' ? `<div class="level-bar" role="group" aria-label="Palabras escondidas">${LY_LEVELS.slice(1).map(([v, l]) => `<button data-act="lsLevel" data-v="${v}" class="${String(sg.ui.learnLevel) === v ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
      ${canHear ? `<p class="center mt"><button class="link-btn" data-act="lsHear">${icon('volume', 'sm')} Escuchar esta frase</button></p>` : ''}
    </main>
    <div class="sess-actions"><div class="inner">${acts}</div></div>`);
  },
  hint() {
    const el = $('#answer .w.ini:not(.rev), #answer .w.hid:not(.rev)');
    if (!el) { toast('Ya está toda a la vista'); return; }
    this.revealed.add(Number(el.dataset.wi));
    el.classList.add('rev', 'just');
  },
  hear() {
    const lines = songLines(this.sg), i = this.queue[this.pos], l = lines[i];
    if (l.t != null && SongPlayer.kind !== 'none') { SongPlayer.loop = null; playerAction(() => SongPlayer.playRange(Math.max(0, l.t - 200), lineEnd(lines, i) + 150)); }
    else { TTS.cancel(); TTS.speak(l.text, { lang: S().lang, rate: S().rate }); }
  },
  listen() {
    const line = songLines(this.sg)[this.queue[this.pos]];
    const target = wordsOf(line.text);
    this.listening = true;
    this.align = null;
    App.keepScroll = true;
    this.render();
    this.listener = listenLine(target, {
      lang: S().lang,
      onUpdate: (al, t) => { this.micText = t; this.align = al; const m = $('#micTxt'); if (m) m.textContent = t; },
      onDone: (al, t) => { this.listener = null; if (t) { this.micText = t; this.align = al; } this.endListen(); },
      onError: (err) => { this.listener = null; this.listening = false; toast(micErrorMsg(err), 4000); App.keepScroll = true; this.render(); },
    });
  },
  endListen() {
    if (this.listener) { const l = this.listener; this.listener = null; l.stop(); }
    if (!this.listening) return;
    this.listening = false;
    SR.stop();
    if (!this.align) this.align = { matched: new Set(), extra: [], score: 0 };
    this.state = 'rate';
    App.keepScroll = true;
    this.render();
  },
  show() { this.endListen(); this.state = 'rate'; App.keepScroll = true; this.render(); },
  grade(g) {
    const sg = this.sg, i = this.queue[this.pos];
    const p = sg.prog[i] || (sg.prog[i] = { l: 0, r: 0, x: 0 });
    p.r++; p.t = Date.now();
    if (g === 0) { p.l = 0; p.x++; } else if (g === 1) p.l = Math.max(1, Math.min(p.l, 3)); else p.l = Math.min(5, p.l + 1);
    this.results.push({ i, g });
    if (g === 0) this.queue.splice(Math.min(this.queue.length, this.pos + 3), 0, i);
    saveSong(sg);
    this.pos++;
    if (this.pos >= this.queue.length) return this.finish();
    this.reset();
    this.render();
  },
  finish() {
    const first = new Map();
    for (const r of this.results) if (!first.has(r.i)) first.set(r.i, r);
    const arr = [...first.values()];
    const good = arr.filter((r) => r.g === 2).length, hard = arr.filter((r) => r.g === 1).length;
    const pct = arr.length ? Math.round(((good + hard * 0.5) / arr.length) * 100) : 0;
    this.stop();
    const sg = this.sg;
    mount(`<div class="sess-top"><button class="icon-btn" data-act="go" data-to="/song/${sg.id}/learn" data-replace="1" aria-label="Terminar">${icon('close')}</button><div class="prog"><i style="width:100%"></i></div><span class="count"></span></div>
    <main class="sess"><div class="done">
      <div class="ring big" style="--p:${pct}"><div><b>${pct}%</b><small>acierto</small></div></div>
      <h2>${pct >= 90 ? '¡Te la sabes!' : pct >= 60 ? '¡Vas muy bien!' : 'Buen comienzo'}</h2>
      <p class="muted">Has repasado ${plural(arr.length, 'frase', 'frases')}. Ahora prueba a cantarla escondiendo palabras.</p>
      <div class="btn-col mt">
        <button class="btn primary big" data-act="go" data-to="/song/${sg.id}/lyrics" data-replace="1">${icon('music')} Cantarla con la letra</button>
        <button class="btn ghost" data-act="go" data-to="/song/${sg.id}/learn" data-replace="1">Volver</button>
      </div></div></main>`);
  },
};
ACT.lsHint = () => LearnSess.hint();
ACT.lsShow = () => LearnSess.show();
ACT.lsMic = () => LearnSess.listen();
ACT.lsStopMic = () => LearnSess.endListen();
ACT.lsHear = () => LearnSess.hear();
ACT.lsGrade = (el) => LearnSess.grade(Number(el.dataset.g));
ACT.lsLevel = (el) => { LearnSess.sg.ui.learnLevel = Number(el.dataset.v); saveSong(LearnSess.sg); App.keepScroll = true; LearnSess.render(); };
ACT.lsClose = () => { const sg = LearnSess.sg; go(`/song/${sg.id}/learn`, true); };

/* ---------- Cantar con afinador ---------- */
function tunerHTML(withTarget = false) {
  return `<div class="tuner"><div class="tn-note" id="tnNote">—</div><div class="tn-sub" id="tnSub">${withTarget ? '' : 'Canta una «aaa» o la canción'}</div>
    <div class="tn-bar" aria-hidden="true"><span class="tn-zone"></span><b id="tnNeedle"></b></div>
    <div class="tn-scale"><span>Más grave</span><span>${withTarget ? 'En el tono' : 'Afinado'}</span><span>Más agudo</span></div></div>`;
}

// Mueve la aguja: cents respecto a la nota objetivo (o a la nota más cercana)
function setTuner(midi, cents, label) {
  const n = $('#tnNote'), nd = $('#tnNeedle'), sb = $('#tnSub');
  if (!n) return;
  if (midi == null) { n.classList.add('off'); if (nd) nd.className = ''; return; }
  n.classList.remove('off');
  n.textContent = label || Pitch.nameOf(midi);
  if (nd) {
    nd.style.left = (50 + clamp(cents, -100, 100) / 2) + '%';
    nd.className = Math.abs(cents) <= 20 ? 'ok' : Math.abs(cents) <= 45 ? 'warn' : 'bad';
  }
  if (sb && label == null) sb.textContent = Math.abs(cents) <= 20 ? '¡Afinado!' : cents > 0 ? `${cents} cents alto` : `${-cents} cents bajo`;
}

// Dibuja el rastro de tu voz (y la línea objetivo si la hay)
function drawTrail(cv, frames, { now, span = 8000, lo, hi, target = null }) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const cs = getComputedStyle(document.documentElement);
  const col = (v) => cs.getPropertyValue(v).trim();
  const y = (m) => h - ((m - lo) / (hi - lo)) * h;
  const x = (t) => ((t - (now - span)) / span) * w;
  g.font = '600 10px ' + col('--font-ui');
  g.lineWidth = 1;
  for (let m = Math.ceil(lo); m <= hi; m++) {
    const yy = Math.round(y(m)) + 0.5;
    const isC = ((m % 12) + 12) % 12 === 0;
    g.strokeStyle = isC ? col('--faint') : col('--hair');
    g.globalAlpha = isC ? 0.5 : 1;
    g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke();
    g.globalAlpha = 1;
    if (isC || (hi - lo <= 14 && [4, 7].includes(((m % 12) + 12) % 12))) { g.fillStyle = col('--faint'); g.fillText(Pitch.nameOf(m), 4, yy - 3); }
  }
  if (target) {
    g.strokeStyle = col('--brand');
    g.globalAlpha = 0.28;
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.beginPath();
    for (let px = 0; px <= w; px += 4) { const m = target(now - span + (px / w) * span); if (px === 0) g.moveTo(px, y(m)); else g.lineTo(px, y(m)); }
    g.stroke();
    g.globalAlpha = 1;
  }
  for (const f of frames) {
    if (f.midi == null || f.t < now - span) continue;
    const ref = target ? target(f.t) : Math.round(f.midi);
    let m = f.midi;
    if (target) m -= 12 * Math.round((m - ref) / 12);
    const c = Math.abs((m - ref) * 100);
    g.fillStyle = c <= 25 ? col('--ok') : c <= 50 ? col('--warn') : col('--bad');
    g.beginPath(); g.arc(x(f.t), y(clamp(m, lo, hi)), 3, 0, Math.PI * 2); g.fill();
  }
}

function viewSongSing(sg) {
  const lines = songLines(sg);
  mount(`${songHeroHTML(sg)}
  <main class="page song-page">
    <div class="card sing-card">${tunerHTML()}<canvas class="trail" id="trail"></canvas>
      <div class="btn-row mt-s"><button class="btn primary" data-act="singMic" id="singMic">${icon('mic', 'sm')} Empezar a cantar</button></div>
      <div class="sing-stats" id="singStats"></div></div>
    ${lines.length ? `<div class="card now-lines"><p class="nl-cur" id="nlCur">${esc((lines.find((l) => l.text) || {}).text || '')}</p><p class="nl-next muted" id="nlNext"></p></div>` : ''}
    <p class="small muted mt-s">Usa <b>auriculares</b>: si la música sale por el altavoz, el micrófono la oye y se mezcla con tu voz. El afinador te dice si das notas limpias y estables; no compara con la melodía original.</p>
  </main>
  ${playerDockHTML(sg)}
  ${songTabbarHTML(sg, 'sing')}`);

  const S2 = { frames: [], mic: null, voiced: 0, clean: 0, lo: null, hi: null, raf: 0 };
  const R = App.sing.range;
  let view = R ? { lo: R.lo - 3, hi: R.hi + 3 } : { lo: 48, hi: 72 };
  let cur = -2;
  bindDock((pos) => {
    if (!sg.lyrics.synced) return;
    const i = activeLine(lines, pos);
    if (i === cur) return;
    cur = i;
    const c = $('#nlCur'), n = $('#nlNext');
    if (!c) return;
    const at = i < 0 ? lines.findIndex((l) => l.text) : i;
    c.textContent = (lines[at] && lines[at].text) || '♪';
    let nx = '';
    for (let j = at + 1; j < lines.length; j++) if (lines[j].text) { nx = lines[j].text; break; }
    n.textContent = nx;
  });
  const prevClean = App.cleanup;
  const stopMic = () => { cancelAnimationFrame(S2.raf); if (S2.mic) { S2.mic.stop(); S2.mic = null; } };
  App.cleanup = () => { prevClean && prevClean(); stopMic(); };

  const draw = () => {
    const now = performance.now();
    S2.frames = S2.frames.filter((f) => f.t > now - 9000);
    const v = S2.frames.filter((f) => f.midi != null).map((f) => f.midi);
    if (!R && v.length > 10) {
      const med = v.slice().sort((a, b) => a - b)[v.length >> 1];
      if (med < view.lo + 3 || med > view.hi - 3) view = { lo: Math.round(med) - 9, hi: Math.round(med) + 9 };
    }
    drawTrail($('#trail'), S2.frames, { now, lo: view.lo, hi: view.hi });
    S2.raf = requestAnimationFrame(draw);
  };
  ACT.singMic = async (el) => {
    if (S2.mic) {
      stopMic();
      el.innerHTML = `${icon('mic', 'sm')} Empezar a cantar`;
      return;
    }
    Pitch.unlock();
    try {
      S2.mic = await Pitch.listen((fr) => {
        S2.frames.push(fr);
        if (fr.midi == null) { setTuner(null); return; }
        S2.voiced++;
        const c = Pitch.centsOff(fr.midi);
        if (Math.abs(c) <= 25) S2.clean++;
        S2.lo = S2.lo == null ? fr.midi : Math.min(S2.lo, fr.midi);
        S2.hi = S2.hi == null ? fr.midi : Math.max(S2.hi, fr.midi);
        setTuner(fr.midi, c);
        if (S2.voiced % 12 === 0) {
          const st = $('#singStats');
          if (st) st.innerHTML = `<span class="pill ${pctClass(Math.round((S2.clean / S2.voiced) * 100))}">${Math.round((S2.clean / S2.voiced) * 100)}% notas limpias</span><span class="pill">De ${Pitch.nameOf(S2.lo)} a ${Pitch.nameOf(S2.hi)}</span>`;
        }
      });
      el.innerHTML = `${icon('pause', 'sm')} Parar`;
      draw();
    } catch (e) {
      toast(e && e.name === 'NotAllowedError' ? 'Necesito permiso para usar el micrófono' : 'No se pudo abrir el micrófono', 4000);
    }
  };
}

/* ============ CLASE DE CANTO ============ */
const LESSONS = [
  { id: 'breath', ic: 'wind', title: 'Respiración', sub: 'Respira con el diafragma y mide tu soplido', min: 3 },
  { id: 'range', ic: 'layers', title: 'Tu tesitura', sub: 'Tus notas más grave y más aguda y tu tipo de voz', min: 2 },
  { id: 'siren', ic: 'wave', title: 'Sirena', sub: 'Desliza la voz de grave a agudo sin cortes', min: 2 },
  { id: 'notes', ic: 'target', title: 'Afinar notas', sub: 'Escucha una nota y cántala igual', min: 4 },
  { id: 'scale', ic: 'chart', title: 'Escalas', sub: 'Do-re-mi-fa-sol, subiendo de tono', min: 4 },
  { id: 'hold', ic: 'clock', title: 'Nota larga', sub: 'Mantén una nota firme y estable', min: 2 },
];

const TIPS = [
  ['Calienta siempre', 'Antes de cantar fuerte o agudo, 5–10 minutos de ejercicios suaves. La voz es un músculo.'],
  ['Respira «abajo»', 'Al coger aire se expanden la tripa y las costillas; los hombros no suben. El aire sale despacio y constante.'],
  ['Cantar no duele', 'Si raspa, pica o duele, para y descansa. Forzar hoy es perder voz mañana.'],
  ['Agudos con espacio, no con fuerza', 'Para subir, abre por dentro (como al bostezar) en vez de empujar volumen.'],
  ['Mandíbula suelta', 'Boca abierta en vertical en las vocales, lengua relajada detrás de los dientes de abajo.'],
  ['Bebe agua', 'La garganta se hidrata desde dentro y con tiempo: bebe a lo largo del día, no solo al cantar.'],
  ['Grábate', 'Escucharte desde fuera entrena el oído más rápido que nada.'],
  ['Aprende por capas', 'Primero la letra hablada, luego con el ritmo, luego con la melodía. Esta app te ayuda con las tres.'],
];

function viewCoach() {
  const R = App.sing.range;
  const today = todayKey();
  const doneToday = new Set(App.sing.history.filter((h) => todayKey(new Date(h.t)) === today).map((h) => h.id));
  const days = new Set(App.sing.history.map((h) => todayKey(new Date(h.t))));
  let streak = 0;
  const d = new Date();
  if (!days.has(todayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(todayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  mount(`
  <header class="topbar"><button class="icon-btn" data-act="go" data-to="/" aria-label="Volver">${icon('back')}</button>
    <div class="tb-title"><h2>Clase de canto</h2><span class="tb-sub">10 minutos al día marcan la diferencia</span></div></header>
  <main class="page no-tabs">
    <section class="coach-hero">
      <span class="eyebrow">Tu voz</span>
      ${R ? `<h2>${esc(R.type)}</h2><p>De <b>${Pitch.nameOf(R.lo)}</b> a <b>${Pitch.nameOf(R.hi)}</b> · ${plural(R.hi - R.lo, 'semitono', 'semitonos')}</p>
        <small>Orientativo: tu tesitura crece con la práctica. Repite el test cada pocas semanas.</small>`
    : `<h2>Aún no la conozco</h2><p>Haz el test de tesitura: así los ejercicios usarán notas cómodas para ti.</p>
        <button class="btn gold sm mt-s" data-act="go" data-to="/canto/range">${icon('play', 'sm')} Hacer el test</button>`}
      ${streak ? `<div class="pill-row mt-s"><span class="pill glass">${icon('flame')} ${plural(streak, 'día seguido', 'días seguidos')}</span></div>` : ''}
    </section>
    ${Pitch.supported() ? '' : '<div class="banner">' + icon('mic') + '<span class="grow">Este navegador no deja analizar el micrófono. Usa Chrome (Android) o Safari (iPhone).</span></div>'}
    <h3 class="section-title">Ejercicios</h3>
    <p class="hint">Hazlos en este orden: primero calientas y luego le pides más a la voz.</p>
    <div class="list">${LESSONS.map((L, i) => {
      const best = App.sing.best[L.id];
      const sub = [L.sub, `${L.min} min`, best != null ? `récord ${best}%` : ''].filter(Boolean).join(' · ');
      return `<button class="row" data-act="go" data-to="/canto/${L.id}"><span class="ri">${icon(L.ic)}</span><span class="grow"><b>${i + 1}. ${esc(L.title)}</b><small>${esc(sub)}</small></span>${doneToday.has(L.id) ? `<span class="chev" style="color:var(--ok)">${icon('check')}</span>` : `<span class="chev">${icon('right', 'sm')}</span>`}</button>`;
    }).join('')}</div>
    <h3 class="section-title">Tus canciones</h3>
    ${App.songs.length ? `<div class="list">${App.songs.map(songRowHTML).join('')}</div>` : '<p class="hint">Añade una canción para aprenderte la letra y cantarla con el afinador.</p>'}
    <button class="btn surface block mt-s" data-act="addSong">${icon('music', 'sm')} Añadir canción</button>
    <h3 class="section-title">Consejos de técnica</h3>
    <div class="list">${TIPS.map(([t, s]) => `<details class="tip"><summary class="row flat"><span class="grow"><b>${esc(t)}</b></span><span class="chev">${icon('down', 'sm')}</span></summary><p>${esc(s)}</p></details>`).join('')}</div>
    <p class="small muted mt">Usa auriculares cuando cantes con música. Los ejercicios son una ayuda para practicar en casa; no sustituyen a un profesor de canto.</p>
  </main>`);
}

/* --- motor de los ejercicios --- */
const Coach = {
  run: 0, mic: null, onFrame: null,
  token() { const r = ++this.run; return () => r === this.run; },
  async startMic() {
    if (this.mic) return;
    this.mic = await Pitch.listen((fr) => { if (this.onFrame) this.onFrame(fr); });
  },
  stopMic() { if (this.mic) { this.mic.stop(); this.mic = null; } this.onFrame = null; },
  stop() { this.run++; this.stopMic(); Pitch.silence(); },
};

const lsStage = (html) => { const el = $('#stage'); if (el) el.innerHTML = html; };
const lsActs = (html) => { const el = $('#acts'); if (el) el.innerHTML = html; };
const lsProg = (p, label = '') => { const i = $('#lsProg'); if (i) i.style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; const c = $('#lsCount'); if (c) c.textContent = label; };
const btnHTML = (id, label, cls = 'primary') => `<button class="btn ${cls}" id="${id}">${label}</button>`;
// Espera a que se toque alguno de los botones; devuelve su id
function tapAny(...ids) {
  return new Promise((res) => {
    for (const id of ids) {
      const b = document.getElementById(id);
      if (b) b.onclick = () => { Pitch.unlock(); res(id); };
    }
  });
}

function viewLesson(id) {
  const L = LESSONS.find((x) => x.id === id);
  if (!L) return go('/canto', true);
  Coach.stop();
  App.cleanup = () => Coach.stop();
  mount(`<div class="sess-top"><button class="icon-btn" data-act="go" data-to="/canto" data-replace="1" aria-label="Salir">${icon('close')}</button><div class="prog"><i id="lsProg" style="width:0%"></i></div><span class="count" id="lsCount"></span></div>
    <main class="sess lesson"><div class="sess-scene">${esc(L.title)}</div><div id="stage"></div></main>
    <div class="sess-actions"><div class="inner" id="acts"></div></div>`);
  if (!Pitch.supported()) { lsStage(`<div class="empty">${icon('mic')}<p>Este navegador no deja usar el micrófono para cantar. Prueba con Chrome (Android) o Safari (iPhone).</p></div>`); return; }
  LESSON_RUN[id]().catch((e) => {
    console.warn(e);
    Coach.stopMic();
    lsStage(`<div class="empty">${icon('mic')}<p>${e && e.name === 'NotAllowedError' ? 'Necesito permiso para usar el micrófono. Actívalo en los permisos del navegador y vuelve a entrar.' : 'No se pudo usar el micrófono: ' + esc((e && e.message) || e)}</p></div>`);
    lsActs(`<button class="btn primary" data-act="go" data-to="/canto" data-replace="1">Volver</button>`);
  });
}

function lessonDone(id, score, title, text) {
  Coach.stopMic();
  score = Math.round(clamp(score, 0, 100));
  App.sing.history.push({ id, t: Date.now(), score });
  if (App.sing.history.length > 500) App.sing.history = App.sing.history.slice(-500);
  App.sing.best[id] = Math.max(App.sing.best[id] || 0, score);
  saveSing();
  lsProg(1, '');
  lsStage(`<div class="done"><div class="ring big" style="--p:${score}"><div><b>${score}%</b><small>puntuación</small></div></div>
    <h2>${esc(title)}</h2><p class="muted">${text}</p></div>`);
  lsActs(`<button class="btn soft" data-act="go" data-to="/canto" data-replace="1">Volver</button><button class="btn primary" data-act="lessonAgain" data-id="${id}">${icon('reset', 'sm')} Repetir</button>`);
}
ACT.lessonAgain = (el) => viewLesson(el.dataset.id);

// Rango para los ejercicios: el del test o uno aproximado
async function lessonRange() {
  if (App.sing.range) return App.sing.range;
  const v = await chooseSheet({ title: '¿Cómo es tu voz?', sub: 'Para elegir notas cómodas. Con el test de tesitura será más exacto.', options: [
    { value: 'test', label: 'Hacer el test de tesitura', sub: '2 minutos', icon: 'layers' },
    { value: 'low', label: 'Grave (normalmente, voz de hombre)', icon: 'down' },
    { value: 'high', label: 'Aguda (normalmente, voz de mujer o infantil)', icon: 'up' },
  ] });
  if (v === 'test') { go('/canto/range', true); return null; }
  if (v === 'low') return { lo: 45, hi: 64, type: 'Barítono' };
  if (v === 'high') return { lo: 57, hi: 76, type: 'Mezzosoprano' };
  go('/canto', true);
  return null;
}

/**
 * Espera a que cantes la nota `target` afinada durante holdMs seguidos (vale una octava arriba o abajo).
 * Devuelve { ok, dev } (desviación media en cents mientras estabas afinado). cancel() la corta.
 */
function waitForNote(target, { holdMs = 1000, tol = 35, timeout = 8000, alive }) {
  let cancel;
  const p = new Promise((res) => {
    const t0 = performance.now();
    let okSince = null, lastOk = 0, devs = [], finished = false;
    const done = (ok) => { if (finished) return; finished = true; Coach.onFrame = null; res({ ok, dev: devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 100 }); };
    cancel = () => done(false);
    Coach.onFrame = (fr) => {
      if (!alive()) return done(false);
      const now = fr.t;
      if (fr.midi != null) {
        let d = fr.midi - target;
        d -= 12 * Math.round(d / 12);
        const cents = Math.round(d * 100);
        setTuner(target, cents, Pitch.nameOf(target));
        const sb = $('#tnSub');
        if (sb) sb.textContent = Math.abs(cents) <= tol ? '¡Ahí! Mantenla…' : cents < 0 ? 'Sube un poco ↑' : 'Baja un poco ↓';
        if (Math.abs(cents) <= tol) {
          if (okSince == null) okSince = now;
          lastOk = now;
          devs.push(Math.abs(cents));
          if (now - okSince >= holdMs) return done(true);
        } else if (now - lastOk > 150) okSince = null;
      } else {
        setTuner(null);
        if (now - lastOk > 250) okSince = null;
      }
      if (now - t0 > timeout) done(false);
    };
  });
  p.cancel = () => cancel && cancel();
  return p;
}

// Captura una nota mantenida de forma estable (para el test de tesitura)
function captureStable({ timeout = 15000, alive }) {
  return new Promise((res) => {
    const t0 = performance.now();
    const win = [];
    Coach.onFrame = (fr) => {
      if (!alive()) { Coach.onFrame = null; return res(null); }
      const now = fr.t;
      win.push(fr);
      while (win.length && win[0].t < now - 1300) win.shift();
      if (fr.midi != null) setTuner(fr.midi, Pitch.centsOff(fr.midi)); else setTuner(null);
      const v = win.filter((f) => f.midi != null).map((f) => f.midi);
      if (v.length >= 20 && v.length >= win.length * 0.7) {
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) * (b - mean), 0) / v.length);
        if (sd < 0.45) { Coach.onFrame = null; return res(Math.round(v.slice().sort((a, b) => a - b)[v.length >> 1])); }
      }
      if (now - t0 > timeout) { Coach.onFrame = null; res(null); }
    };
  });
}

const LESSON_RUN = {
  /* 1. Respiración */
  async breath() {
    const alive = Coach.token();
    lsStage(`<p class="lesson-txt">De pie o sentado con la espalda recta y los hombros sueltos. Pon una mano en la tripa: al coger aire tiene que <b>hincharse la tripa</b>, no subir los hombros.</p>
      <div class="breath"><div class="breath-c" id="bc"></div><b id="bTxt">Preparado</b></div>`);
    lsActs(btnHTML('aGo', `${icon('play', 'sm')} Empezar`));
    await tapAny('aGo');
    if (!alive()) return;
    lsActs(btnHTML('aSkip', 'Saltar a la prueba', 'soft'));
    let skip = false;
    tapAny('aSkip').then(() => { skip = true; });
    const phases = [['Coge aire por la nariz', 4000, 'in'], ['Aguanta', 3000, 'in'], ['Suelta el aire: «sss»', 6000, 'out']];
    const total = 4 * phases.length;
    let k = 0;
    for (let c = 0; c < 4 && !skip; c++) {
      for (const [txt, ms, cls] of phases) {
        if (!alive() || skip) break;
        const bc = $('#bc'), bt = $('#bTxt');
        if (bc) { bc.style.transitionDuration = ms + 'ms'; bc.className = 'breath-c ' + cls; }
        for (let s = Math.round(ms / 1000); s > 0 && !skip; s--) { if (bt) bt.textContent = `${txt} · ${s}`; await sleep(1000); if (!alive()) return; }
        lsProg((++k / total) * 0.6, `Ronda ${c + 1}/4`);
      }
    }
    if (!alive()) return;
    lsStage(`<p class="lesson-txt">Ahora la prueba: coge mucho aire y suelta una <b>«sss» larga, suave y constante</b>, sin apretar la garganta. Te cronometro.</p>
      <div class="big-num" id="bNum">0,0 s</div><p class="center muted small" id="bHint">Toca «Empezar» y espera a que te avise.</p>`);
    lsActs(btnHTML('aGo', `${icon('mic', 'sm')} Empezar la prueba`));
    await tapAny('aGo');
    if (!alive()) return;
    lsActs(btnHTML('aStop', 'Ya está', 'soft'));
    await Coach.startMic();
    const hint = (t) => { const h = $('#bHint'); if (h) h.textContent = t; };
    hint('Silencio un momento: mido el ruido de la habitación…');
    const noise = [];
    await new Promise((res) => { const t0 = performance.now(); Coach.onFrame = (fr) => { noise.push(fr.rms); if (fr.t - t0 > 900) res(); }; });
    if (!alive()) return;
    const floor = noise.sort((a, b) => a - b)[noise.length >> 1] || 0.005;
    const thr = Math.max(0.012, floor * 3);
    hint('¡Ahora! Suelta la «sss»…');
    let start = null, lastLoud = 0, secs = 0;
    await new Promise((res) => {
      tapAny('aStop').then(res);
      const t0 = performance.now();
      Coach.onFrame = (fr) => {
        const now = fr.t;
        if (fr.rms > thr) { if (start == null) start = now; lastLoud = now; }
        if (start != null) {
          secs = (lastLoud - start) / 1000;
          const n = $('#bNum'); if (n) n.textContent = secs.toFixed(1).replace('.', ',') + ' s';
          if (now - lastLoud > 900) res();
        } else if (now - t0 > 15000) res();
      };
    });
    if (!alive()) return;
    const msg = secs >= 25 ? 'Control del aire excelente.' : secs >= 15 ? 'Buen control. Con práctica pasarás de 25 segundos.' : secs > 0 ? 'Sigue practicando: suelta el aire más despacio y sin apretar. El objetivo es pasar de 20 segundos.' : 'No te he oído. Acércate al micrófono y vuelve a probar.';
    lessonDone('breath', (secs / 25) * 100, `${secs.toFixed(1).replace('.', ',')} segundos`, msg);
  },

  /* 2. Tesitura */
  async range() {
    const alive = Coach.token();
    const step = async (title, txt) => {
      for (;;) {
        lsStage(`<h3 class="lesson-h">${title}</h3><p class="lesson-txt">${txt}</p>${tunerHTML()}`);
        lsActs(btnHTML('aGo', `${icon('mic', 'sm')} Empezar`));
        await tapAny('aGo');
        if (!alive()) return null;
        lsActs(btnHTML('aCancel', 'Cancelar', 'soft'));
        await Coach.startMic();
        const cancelled = tapAny('aCancel').then(() => 'x');
        const m = await Promise.race([captureStable({ alive }), cancelled]);
        Coach.onFrame = null;
        if (!alive()) return null;
        if (m === 'x') continue;
        if (m == null) { toast('No he conseguido oír una nota estable. Prueba con una «aaa» más larga.', 4000); continue; }
        lsStage(`<h3 class="lesson-h">${title}</h3><div class="big-num">${Pitch.nameOf(m)}</div><p class="center muted">¿Es tu nota ${title.includes('grave') ? 'más grave' : 'más aguda'} cómoda?</p>`);
        lsActs(btnHTML('aRe', 'Otra vez', 'soft') + btnHTML('aOk', `${icon('check', 'sm')} Sí`));
        if ((await tapAny('aRe', 'aOk')) === 'aOk') return m;
        if (!alive()) return null;
      }
    };
    lsProg(0.1, '1/2');
    let lo = await step('Tu nota más grave', 'Canta una «aaa» relajada y ve bajando hasta la nota más grave que te salga <b>con sonido limpio</b> (sin carraspeo). Mantenla un par de segundos.');
    if (lo == null) return;
    lsProg(0.55, '2/2');
    let hi = await step('Tu nota más aguda', 'Ahora sube hasta la nota más aguda que te salga <b>cómoda, sin gritar ni apretar</b>. Mantenla un par de segundos.');
    if (hi == null) return;
    if (hi < lo) [lo, hi] = [hi, lo];
    if (hi - lo < 5) { toast('Las dos notas salen muy juntas: repite el test bajando y subiendo más.', 4500); return viewLesson('range'); }
    const type = Pitch.voiceType(lo, hi);
    App.sing.range = { lo, hi, type, date: Date.now() };
    saveSing();
    lessonDone('range', Math.min(100, ((hi - lo) / 24) * 100), `Eres ${type}`,
      `Tu tesitura cómoda va de <b>${Pitch.nameOf(lo)}</b> a <b>${Pitch.nameOf(hi)}</b> (${plural(hi - lo, 'semitono', 'semitonos')}). Es orientativo: el tipo de voz también depende del timbre, y la tesitura crece con la práctica.`);
  },

  /* 3. Sirena */
  async siren() {
    const alive = Coach.token();
    const R = await lessonRange();
    if (!R || !alive()) return;
    const c = Math.round((R.lo + R.hi) / 2);
    const A = clamp(Math.floor((R.hi - R.lo) / 2) - 1, 3, 7);
    const P = 7000, cycles = 3;
    lsStage(`<p class="lesson-txt">Con la boca cerrada («mmm») o con una «uuu», desliza la voz siguiendo la línea: sube y baja <b>sin cortes</b>, como una sirena.</p>
      <canvas class="trail tall" id="trail"></canvas><p class="center muted small" id="sHint">Primero escucha cómo suena.</p>`);
    lsActs(btnHTML('aGo', `${icon('play', 'sm')} Empezar`));
    await tapAny('aGo');
    if (!alive()) return;
    lsActs('');
    const lo = c - A - 3, hi = c + A + 3;
    const target0 = (t) => c - A * Math.cos((2 * Math.PI * t) / P);
    // demostración
    const demoStart = performance.now();
    const demo = () => { if (!alive() || performance.now() - demoStart > P) return; drawTrail($('#trail'), [], { now: performance.now(), span: P, lo, hi, target: (t) => target0(t - demoStart) }); requestAnimationFrame(demo); };
    demo();
    await Pitch.glide(c - A, c + A, P / 2);
    await Pitch.glide(c + A, c - A, P / 2);
    if (!alive()) return;
    await Coach.startMic();
    const hint = $('#sHint'); if (hint) hint.textContent = '¡Ahora tú! Sigue la línea.';
    const frames = [];
    const t0 = performance.now() + 600;
    const target = (t) => target0(t - t0);
    let voiced = 0, good = 0;
    Coach.onFrame = (fr) => {
      if (fr.t < t0) return;
      frames.push(fr);
      if (fr.midi != null) {
        voiced++;
        let d = fr.midi - target(fr.t);
        d -= 12 * Math.round(d / 12);
        if (Math.abs(d) <= 1.2) good++;
      }
    };
    await new Promise((res) => {
      const loop = () => {
        if (!alive()) return res();
        const now = performance.now();
        drawTrail($('#trail'), frames, { now, span: P, lo, hi, target });
        lsProg((now - t0) / (P * cycles), '');
        if (now - t0 >= P * cycles) return res();
        requestAnimationFrame(loop);
      };
      loop();
    });
    if (!alive()) return;
    const total = frames.length || 1;
    const voicedRatio = voiced / total;
    const score = voiced ? (good / voiced) * 100 * Math.min(1, voicedRatio / 0.6) : 0;
    lessonDone('siren', score, score >= 75 ? '¡Muy fluida!' : score >= 45 ? 'Bien, sigue así' : 'A practicar',
      voicedRatio < 0.5 ? 'He oído pocos tramos de voz: intenta no cortar el sonido en toda la subida y bajada.' : 'Consejo: en la parte aguda no empujes; deja que la voz se haga más ligera.');
  },

  /* 4. Afinar notas sueltas */
  async notes() {
    const alive = Coach.token();
    const R = await lessonRange();
    if (!R || !alive()) return;
    const lo = R.lo + 2, hi = Math.max(R.lo + 4, R.hi - 3);
    const N = 8;
    const list = [];
    while (list.length < N) { const m = lo + Math.floor(Math.random() * (hi - lo + 1)); if (m !== list[list.length - 1]) list.push(m); }
    lsStage(`<p class="lesson-txt">Sonará una nota. Escúchala y cántala igual con una «aaa» o «nooo». Mantenla cuando la aguja se ponga verde.</p>`);
    lsActs(btnHTML('aGo', `${icon('play', 'sm')} Empezar`));
    await tapAny('aGo');
    if (!alive()) return;
    await Coach.startMic();
    let hits = 0, devSum = 0;
    for (let k = 0; k < N; k++) {
      if (!alive()) return;
      const t = list[k];
      lsProg(k / N, `${k + 1}/${N}`);
      lsStage(`<h3 class="lesson-h">Nota ${k + 1} de ${N}</h3>${tunerHTML(true)}<p class="center muted small" id="nHint">Escucha…</p>`);
      lsActs(btnHTML('aRep', `${icon('volume', 'sm')} Otra vez`, 'soft') + btnHTML('aSkip', 'Saltar', 'soft'));
      Coach.onFrame = null;
      setTuner(t, 0, Pitch.nameOf(t));
      await Pitch.tone(t, 1300);
      await sleep(250);
      if (!alive()) return;
      const h = $('#nHint'); if (h) h.textContent = 'Ahora tú';
      let r;
      for (;;) {
        const w = waitForNote(t, { holdMs: 1000, tol: 35, timeout: 9000, alive });
        const tap = tapAny('aRep', 'aSkip');
        const first = await Promise.race([w.then((x) => ({ w: x })), tap.then((b) => ({ b }))]);
        if (first.w) { r = first.w; break; }
        w.cancel();
        if (first.b === 'aSkip') { r = { ok: false, dev: 100 }; break; }
        Coach.onFrame = null;
        await Pitch.tone(t, 1300);
        await sleep(200);
        if (!alive()) return;
      }
      if (!alive()) return;
      if (r.ok) { hits++; devSum += r.dev; }
      lsStage(`<div class="verdict ${r.ok ? 'ok' : 'bad'}">${icon(r.ok ? 'check' : 'close', 'lg')}<b>${r.ok ? '¡Afinada!' : 'Esta se resiste'}</b><span>${Pitch.nameOf(t)}</span></div>`);
      await sleep(900);
    }
    const avg = hits ? Math.round(devSum / hits) : 0;
    lessonDone('notes', (hits / N) * 100, `${hits} de ${N} notas`,
      hits ? `Cuando acertabas, te desviabas de media ${avg} cents (100 cents = un semitono). ${hits < N / 2 ? 'Escucha la nota tarareándola por dentro antes de cantarla.' : '¡Buen oído!'}` : 'Tararea la nota por dentro antes de cantarla y empieza suave.');
  },

  /* 5. Escalas */
  async scale() {
    const alive = Coach.token();
    const R = await lessonRange();
    if (!R || !alive()) return;
    const PAT = [0, 2, 4, 5, 7, 5, 4, 2, 0];
    const SOL = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'Fa', 'Mi', 'Re', 'Do'];
    const base = clamp(R.lo + 2, R.lo, R.hi - 8);
    const roots = [base, base + 2, base + 4].filter((r) => r + 7 <= R.hi);
    if (!roots.length) roots.push(base);
    lsStage(`<p class="lesson-txt">Cantarás <b>do-re-mi-fa-sol-fa-mi-re-do</b>. Cada nota suena primero y después la cantas tú. Luego subimos de tono.</p>`);
    lsActs(btnHTML('aGo', `${icon('play', 'sm')} Empezar`));
    await tapAny('aGo');
    if (!alive()) return;
    lsActs(btnHTML('aSkip', 'Saltar nota', 'soft'));
    await Coach.startMic();
    let hits = 0, total = 0;
    const N = roots.length * PAT.length;
    for (let r = 0; r < roots.length; r++) {
      for (let k = 0; k < PAT.length; k++) {
        if (!alive()) return;
        const t = roots[r] + PAT[k];
        lsProg(total / N, `${r + 1}/${roots.length}`);
        lsStage(`<div class="solfa">${SOL.map((s, j) => `<span class="${j === k ? 'on' : j < k ? 'past' : ''}">${s}</span>`).join('')}</div>${tunerHTML(true)}`);
        Coach.onFrame = null;
        setTuner(t, 0, Pitch.nameOf(t));
        await Pitch.tone(t, 650);
        if (!alive()) return;
        const w = waitForNote(t, { holdMs: 450, tol: 45, timeout: 4500, alive });
        const res = await Promise.race([w, tapAny('aSkip').then(() => { w.cancel(); return { ok: false }; })]);
        total++;
        if (res.ok) hits++;
        const sp = $$('.solfa span')[k];
        if (sp) sp.className = res.ok ? 'hit' : 'miss';
        await sleep(150);
      }
      if (r < roots.length - 1 && alive()) { lsStage(`<div class="verdict ok">${icon('up', 'lg')}<b>Subimos un tono</b></div>`); await sleep(1100); }
    }
    lessonDone('scale', (hits / total) * 100, `${hits} de ${total} notas`, hits / total >= 0.7 ? '¡Muy bien! Las escalas son la base de la afinación.' : 'Ve despacio: escucha bien cada nota antes de cantarla. Repite este ejercicio cada día.');
  },

  /* 6. Nota larga */
  async hold() {
    const alive = Coach.token();
    const R = await lessonRange();
    if (!R || !alive()) return;
    const t = Math.round((R.lo + R.hi) / 2) - 2;
    lsStage(`<p class="lesson-txt">Coge aire con la tripa y mantén esta nota con una «aaa» <b>firme y sin temblar</b>, hasta 12 segundos.</p>${tunerHTML(true)}<div class="big-num small" id="hNum">0,0 s</div>`);
    lsActs(btnHTML('aGo', `${icon('play', 'sm')} Empezar`));
    await tapAny('aGo');
    if (!alive()) return;
    lsActs(btnHTML('aStop', 'Parar', 'soft'));
    setTuner(t, 0, Pitch.nameOf(t));
    await Pitch.tone(t, 1300);
    await Coach.startMic();
    if (!alive()) return;
    let start = null, lastGood = 0, secs = 0;
    const cents = [];
    await new Promise((res) => {
      tapAny('aStop').then(res);
      const t0 = performance.now();
      Coach.onFrame = (fr) => {
        const now = fr.t;
        if (fr.midi != null) {
          let d = fr.midi - t;
          d -= 12 * Math.round(d / 12);
          const c = Math.round(d * 100);
          setTuner(t, c, Pitch.nameOf(t));
          if (Math.abs(c) <= 80) { if (start == null) start = now; lastGood = now; cents.push(c); }
        } else setTuner(null);
        if (start != null) {
          secs = (lastGood - start) / 1000;
          const n = $('#hNum'); if (n) n.textContent = secs.toFixed(1).replace('.', ',') + ' s';
          lsProg(secs / 12, '');
          if (now - lastGood > 500 || secs >= 12) res();
        } else if (now - t0 > 12000) res();
      };
    });
    if (!alive()) return;
    let sd = 100;
    if (cents.length > 5) { const m = cents.reduce((a, b) => a + b, 0) / cents.length; sd = Math.sqrt(cents.reduce((a, b) => a + (b - m) * (b - m), 0) / cents.length); }
    const score = Math.min(50, (secs / 10) * 50) + Math.max(0, 50 - sd);
    lessonDone('hold', score, `${secs.toFixed(1).replace('.', ',')} s, ${sd <= 15 ? 'muy estable' : sd <= 30 ? 'bastante estable' : 'con altibajos'}`,
      `Tu nota se movió de media ±${Math.round(sd)} cents. ${sd > 30 ? 'Suelta el aire de forma constante, sin empujar al final.' : 'Ahora prueba a hacerla más larga.'}`);
  },
};
