'use strict';
/* Apuntador · núcleo: estado, navegación, cartelera, importación, portadas y ajustes */

const VERSION = '2.3.0';
const App = {
  settings: null, scripts: [], cur: null, pending: null, installEvt: null,
  cleanup: null, onSettings: null, keepScroll: false, firstOpen: null, retry: null,
  coverBusy: new Set(), scan: [],
  songs: [], curSong: null, sing: null, audioTarget: null, protected: null,
};
const ACT = {}, CHANGE = {}, INPUT = {};

const HL_COLORS = { yellow: '#ffe066', green: '#9be9a8', pink: '#ffb3d1', blue: '#9fd3ff', orange: '#ffc078' };
const LANGS = [['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['es-AR', 'Español (Argentina)'], ['es-US', 'Español (EE. UU.)'],
  ['ca-ES', 'Català'], ['gl-ES', 'Galego'], ['eu-ES', 'Euskara'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'],
  ['pt-PT', 'Português'], ['pt-BR', 'Português (Brasil)'], ['fr-FR', 'Français'], ['it-IT', 'Italiano'], ['de-DE', 'Deutsch']];
const OCR_LANGS = [['spa', 'Español'], ['cat', 'Català'], ['glg', 'Galego'], ['eus', 'Euskara'], ['eng', 'English'], ['por', 'Português'], ['fra', 'Français'], ['ita', 'Italiano'], ['deu', 'Deutsch']];

const DEFAULTS = {
  theme: 'auto', fontSize: 18, font: 'serif', style: 'auto', hl: 'yellow', mineView: 'full', showNotes: true, charColors: true,
  lang: (navigator.language && /^[a-z]{2}-[A-Z]{2}$/.test(navigator.language) ? navigator.language : 'es-ES'),
  rate: 1, voiceURI: '', ocrLang: 'spa', letterLevel: 2, order: 'seq', installHidden: false, autoCovers: true,
  voiceEngine: 'device', geminiKey: '', geminiModel: 'gemini-3.8-flash-tts', micMode: 'auto',
  spotifyClientId: '', lastBackup: 0, backupSnooze: 0,
  rehearsal: { mineView: 'hid', answer: 'voice', readDir: false, speakMine: false, showOthers: true },
};
const S = () => App.settings;

/* ---------- ajustes ---------- */
const saveSettings = debounce(() => DB.set('settings', App.settings), 300);

function applySettings() {
  const st = S();
  const root = document.documentElement;
  if (st.theme === 'auto') root.removeAttribute('data-theme'); else root.dataset.theme = st.theme;
  root.style.setProperty('--hl', HL_COLORS[st.hl] || HL_COLORS.yellow);
  root.style.setProperty('--script-fs', st.fontSize + 'px');
  const dark = st.theme === 'dark' || (st.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0e0b0c' : '#f4ede3');
}

/* ---------- guardado ---------- */
const _savers = new Map();
function saveScript(s, now = false) {
  if (!s || s === App.pending) return;
  s.updated = Date.now();
  let f = _savers.get(s.id);
  if (!f) { f = debounce(() => DB.putScript(s).catch((e) => toast('No se pudo guardar: ' + e.message)), 600); _savers.set(s.id, f); }
  if (now) f.flush(); else f();
}
// Cambio que afecta a la estructura (personajes, bloques): invalida los índices calculados
function structural(s) { s._v = (s._v || 1) + 1; saveScript(s); }
function flushAll() { for (const f of _savers.values()) f.flush(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
window.addEventListener('pagehide', flushAll);

/* ---------- navegación ---------- */
function go(path, replace = false) {
  const h = '#' + path;
  if (location.hash === h) { route(); return; }
  if (replace) location.replace(h); else location.hash = h;
}
async function nav(path, replace = false) { await Sheet.close(); go(path, replace); }
function rerender() { App.keepScroll = true; route(); }
const currentView = () => parseHash().parts[0] || 'library';

function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [p, q] = raw.split('?');
  return { parts: p.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(q || '') };
}

function mount(html) {
  const y = window.scrollY;
  $('#app').innerHTML = html;
  window.scrollTo(0, App.keepScroll ? y : 0);
  App.keepScroll = false;
}

function route() {
  if (App.cleanup) { const c = App.cleanup; App.cleanup = null; try { c(); } catch (e) { console.warn(e); } }
  App.onSettings = null;
  if (Sheet.el) { Sheet.pushed = false; Sheet._remove(); }
  const { parts, q } = parseHash();
  // al salir de una canción se suelta su reproductor (Spotify sigue sonando en su app si estaba sonando)
  if (parts[0] !== 'song' && SongPlayer.song) SongPlayer.detach();
  if (!parts.length) return viewLibrary();
  if (parts[0] === 'shared') { viewLibrary(); checkShared(); return; }
  if (parts[0] === 'settings') return viewSettings(q);
  if (parts[0] === 'canto') return parts[1] ? viewLesson(parts[1]) : viewCoach();
  if (parts[0] === 'song') {
    const sg = App.songs.find((x) => x.id === parts[1]);
    if (!sg) return go('/', true);
    viewSongRoute(sg, parts[2] || 'lyrics', parts[3]);
    return;
  }
  if (parts[0] === 'review') return viewReview();
  if (parts[0] === 's') {
    const s = App.scripts.find((x) => x.id === parts[1]);
    if (!s) return go('/', true);
    App.cur = s;
    const tab = parts[2] || 'read';
    if (tab === 'read') return viewReader(s, q);
    if (tab === 'study') return parts[3] ? viewSession(s, parts[3], q) : viewStudyHub(s);
    if (tab === 'progress') return viewProgress(s);
    if (tab === 'settings') return viewScriptSettings(s);
  }
  go('/', true);
}

/* ---------- delegación de eventos ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
// Elementos tocables que no son <button> (tarjetas, filas): también con Intro / espacio
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act]:not(button):not(input):not(textarea)')) {
    e.preventDefault();
    e.target.click();
  }
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && CHANGE[el.dataset.change]) CHANGE[el.dataset.change](el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (el && INPUT[el.dataset.input]) INPUT[el.dataset.input](el, e);
});

ACT.go = (el) => nav(el.dataset.to, el.dataset.replace === '1');
ACT.sheetClose = () => Sheet.close();

/* ---------- piezas comunes ---------- */
function tabbarHTML(s, active) {
  const tabs = [['read', 'book', 'Guion'], ['study', 'mic', 'Ensayar'], ['progress', 'chart', 'Progreso'], ['settings', 'sliders', 'Ajustes']];
  return `<nav class="tabbar" aria-label="Secciones">${tabs.map(([k, ic, l]) =>
    `<button class="tab ${active === k ? 'on' : ''}" data-act="go" data-to="/s/${s.id}/${k}" data-replace="1" ${active === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></button>`).join('')}</nav>`;
}

// Cabecera con la portada difuminada (Ensayar, Progreso, Ajustes)
function scriptHeroHTML(s) {
  const I = Model.ix(s);
  const sub = s.author || (s.work && s.work.desc) || '';
  return `<header class="topbar float"><button class="icon-btn" data-act="go" data-to="/" aria-label="Volver a la cartelera">${icon('back')}</button>
      <span class="grow"></span><button class="icon-btn" data-act="coverPickCur" aria-label="Cambiar portada">${icon('image')}</button></header>
    <section class="shero"><div class="shero-bg" style="background-image:url('${Covers.backdrop(s)}')"></div>
      <div class="shero-in"><div data-act="coverPickCur" style="cursor:pointer">${Covers.posterHTML(s)}</div>
        <div class="grow"><h1>${esc(s.title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
          <div class="pill-row">${s.me.length
            ? `<span class="pill glass">${icon('user')} ${esc(Model.charName(s, s.me))}</span><span class="pill glass">${plural(I.mine.length, 'frase', 'frases')}</span>`
            : '<span class="pill glass">Sin personaje</span>'}</div></div></div></section>`;
}

function scriptTop(s, extra = '') {
  const I = Model.ix(s);
  const sub = s.me.length ? `Eres ${Model.charName(s, s.me)} · ${plural(I.mine.length, 'frase', 'frases')}` : 'Sin personaje elegido';
  return `<header class="topbar"><button class="icon-btn" data-act="go" data-to="/" aria-label="Volver">${icon('back')}</button>
    <div class="tb-title"><h2>${esc(s.title)}</h2><span class="tb-sub">${esc(sub)}</span></div>${extra}</header>`;
}

function noCharBanner(s) {
  return `<div class="banner">${icon('user')}<span class="grow">Elige qué personaje eres para subrayar tus frases.</span><button class="btn sm primary" data-act="go" data-to="/s/${s.id}/settings" data-replace="1">Elegir</button></div>`;
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
}

/* ============ CARTELERA ============ */
function viewLibrary() {
  const list = App.scripts.slice().sort((a, b) => (b.opened || b.updated) - (a.opened || a.updated));
  mount(`
  <header class="app-head"><div class="logo">${LOGO_SVG}<span>Apuntador</span></div>
    <button class="icon-btn solid" data-act="go" data-to="/settings" aria-label="Ajustes">${icon('sliders')}</button></header>
  <main class="page lib no-tabs">
    ${installBannerHTML()}
    ${backupBannerHTML()}
    ${list.length ? libraryHTML(list) : emptyLibraryHTML()}
    ${songsSectionHTML()}
    <p class="center muted small mt-l">Tus obras y canciones se guardan solo en este dispositivo. Al actualizar la app no se borran.</p>
  </main>
  ${list.length ? `<button class="fab" data-act="importMenu">${icon('plus')} Nueva obra</button>` : ''}`);
}

const isTouchDevice = () => isIOS() || /Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;

// Recordatorio de copia de seguridad: lo único que protege tus datos si se pierde o se cambia el móvil
function backupBannerHTML() {
  const n = App.scripts.length + App.songs.length;
  const st = S();
  if (!n || Date.now() < (st.backupSnooze || 0)) return '';
  const days = st.lastBackup ? Math.floor((Date.now() - st.lastBackup) / 864e5) : null;
  if (days != null && days < 14) return '';
  return `<div class="banner">${icon('shield')}<span class="grow"><b>${days == null ? 'Haz una copia de seguridad' : `Última copia: hace ${days} días`}</b><br><span class="small muted">Por si cambias o pierdes el móvil.</span></span>
    <button class="btn sm primary" data-act="backupAll">Hacer copia</button><button class="icon-btn" data-act="snoozeBackup" aria-label="Más tarde">${icon('close', 'sm')}</button></div>`;
}
ACT.snoozeBackup = () => { S().backupSnooze = Date.now() + 7 * 864e5; saveSettings(); rerender(); };

function installBannerHTML() {
  if (isStandalone() || S().installHidden || !(App.installEvt || isTouchDevice())) return '';
  return `<div class="banner">${icon('phone')}<span class="grow"><b>Instálala en tu móvil</b><br><span class="small muted">Tendrás su icono y funcionará sin conexión.</span></span>
    <button class="btn sm primary" data-act="install">Instalar</button><button class="icon-btn" data-act="hideInstall" aria-label="Ocultar">${icon('close', 'sm')}</button></div>`;
}

// Pasos para instalar según el navegador (cuando no se puede instalar con un solo toque). Textos fijos con <b>.
function installSteps() {
  const ua = navigator.userAgent;
  if (isIOS()) {
    const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/i.test(ua);
    if (safari) {
      return { title: 'Instalar en iPhone o iPad', steps: [
        'Toca el botón <b>Compartir</b>: el cuadrado con una flecha hacia arriba, en la barra de abajo (arriba en el iPad).',
        'Desliza hacia abajo y elige <b>«Añadir a pantalla de inicio»</b>.',
        'Toca <b>«Añadir»</b>. Ábrela siempre desde ese icono: así el iPhone no borra tus obras.'] };
    }
    return { title: 'Ábrela en Safari', steps: [
      'En iPhone se instala desde <b>Safari</b>. Copia el enlace con el botón de abajo.',
      'Abre <b>Safari</b>, pega el enlace y entra.',
      'Toca <b>Compartir</b> → <b>«Añadir a pantalla de inicio»</b> → <b>«Añadir»</b>.'] };
  }
  if (/SamsungBrowser/i.test(ua)) {
    return { title: 'Instalar con Samsung Internet', steps: [
      'Si en la barra de direcciones ves un icono de <b>descarga</b> (⤓), tócalo y elige <b>«Instalar»</b>.',
      'Si no, toca el menú <b>☰</b> (abajo a la derecha) → <b>«Añadir página a»</b> → <b>«Pantalla de inicio»</b>.',
      'Para ensayar con el micrófono funciona mejor <b>Chrome</b>: si puedes, instálala desde Chrome.'] };
  }
  if (/Android/i.test(ua)) {
    return { title: 'Instalar en Android', steps: [
      'Toca el menú <b>⋮</b> de Chrome, arriba a la derecha.',
      'Elige <b>«Instalar aplicación»</b> o <b>«Añadir a pantalla de inicio»</b>.',
      'Confirma con <b>«Instalar»</b>. El icono aparecerá con tus aplicaciones.'] };
  }
  return { title: 'Instalar en el ordenador', steps: [
    'En Chrome o Edge, toca el icono de <b>instalar</b> que aparece a la derecha de la barra de direcciones.',
    'Para el móvil, abre esta misma dirección en el teléfono y vuelve a pulsar <b>«Instalar»</b>.'] };
}

function openInstallHelp() {
  const { title, steps } = installSteps();
  const el = Sheet.open(`<div class="sheet-body"><h3>${esc(title)}</h3>
    <div class="steps howto mt-s">${steps.map((txt, i) => `<div class="step"><span class="n">${i + 1}</span><div>${txt}</div></div>`).join('')}</div>
    <div class="sheet-actions"><button class="btn soft" id="instCopy">${icon('paste', 'sm')} Copiar enlace</button><button class="btn primary" data-act="sheetClose">Entendido</button></div></div>`);
  el.querySelector('#instCopy').onclick = async () => {
    const url = location.href.split('#')[0];
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch (e) { toast(url, 5000); }
  };
}

function libraryHTML(list) {
  return `<div class="lib-hello"><span class="eyebrow">${greeting()}</span><h1 class="display">Tu cartelera</h1></div>
    ${featureHTML(list[0])}
    <div class="sec-head"><h2>Todas tus obras</h2><span class="muted">${list.length}</span></div>
    <div class="poster-grid">${list.map(posterTileHTML).join('')}
      <button class="poster-add" data-act="importMenu">${icon('plus')}<span>Nueva obra</span></button></div>`;
}

function featureHTML(s) {
  const I = Model.ix(s);
  const m = Model.mastery(s);
  const due = s.me.length ? Model.dueCount(s) : 0;
  return `<section class="feature" data-act="openScript" data-id="${s.id}" tabindex="0" aria-label="Seguir ensayando ${esc(s.title)}">
    <div class="feature-bg" style="background-image:url('${Covers.backdrop(s)}')"></div>
    <div class="feature-in">${Covers.posterHTML(s)}
      <div class="grow"><span class="eyebrow">Sigue ensayando</span><h3>${esc(s.title)}</h3>
        <p>${s.me.length ? `Eres <b>${esc(Model.charName(s, s.me))}</b> · ${plural(I.mine.length, 'frase', 'frases')}` : 'Elige tu personaje para empezar'}</p>
        <div class="meter gold"><i style="width:${m.pct}%"></i></div>
        <small>${m.pct}% aprendido${due ? ` · ${due} para repasar hoy` : ''}</small>
        <button class="btn gold sm" data-act="openScript" data-id="${s.id}">${icon('play', 'sm')} Continuar</button></div></div>
  </section>`;
}

function posterTileHTML(s) {
  const m = Model.mastery(s);
  const due = s.me.length ? Model.dueCount(s) : 0;
  const who = s.me.length ? 'Eres ' + Model.charName(s, s.me) : 'Elige personaje';
  return `<article class="ptile" data-act="openScript" data-id="${s.id}" tabindex="0" aria-label="${esc(s.title)}">
    ${Covers.posterHTML(s, '', `<div class="p-meter"><i style="width:${m.pct}%"></i></div>`)}
    ${due ? `<span class="ptile-badge pill glass">${due} hoy</span>` : ''}
    <button class="ptile-more" data-act="scriptMenu" data-id="${s.id}" aria-label="Opciones de ${esc(s.title)}">${icon('more', 'sm')}</button>
    <div class="ptile-meta"><b>${esc(s.title)}</b><span>${esc(who)} · ${m.pct}%</span></div></article>`;
}

function emptyLibraryHTML() {
  return `<section class="hero-card"><img src="art/hero-stage.jpg" alt="" decoding="async">
      <div class="in"><span class="eyebrow" style="color:#f3d48b">Tu apuntador de bolsillo</span>
        <h1>Apréndete tu papel ensayando con la app</h1>
        <p>Sube el guion, elige tu personaje y la app te da las réplicas en voz alta.</p></div></section>
    <div class="start-actions">
      <button class="btn primary big" data-act="pickFile">${icon('upload')} Subir guion</button>
      <button class="btn surface" data-act="scanPages">${icon('camera')} Escanear páginas</button>
      <button class="btn surface" data-act="pasteText">${icon('paste')} Pegar texto</button>
      <button class="btn surface" data-act="addSong">${icon('music')} Aprender una canción</button>
    </div>
    <p class="formats">PDF · Word · TXT · ODT · RTF · Final Draft · Fountain · Fotos</p>
    <p class="center"><button class="link-btn" data-act="loadSample">${icon('sparkle', 'sm')} Probar con una obra de ejemplo</button></p>
    <div class="card steps mt">
      <div class="step"><span class="n">1</span><div><b>Sube tu guion</b><span>Reconoce la obra, le pone cartel y detecta personajes y escenas.</span></div></div>
      <div class="step"><span class="n">2</span><div><b>Elige tu personaje</b><span>Tus frases quedan subrayadas, como con rotulador.</span></div></div>
      <div class="step"><span class="n">3</span><div><b>Ensaya</b><span>Te da las réplicas, te escucha y sabe qué frases te cuestan.</span></div></div>
    </div>`;
}

ACT.openScript = (el) => {
  const s = App.scripts.find((x) => x.id === el.dataset.id);
  if (!s) return;
  s.opened = Date.now();
  saveScript(s);
  go(`/s/${s.id}/read`);
};

ACT.scriptMenu = async (el) => {
  const s = App.scripts.find((x) => x.id === el.dataset.id);
  if (!s) return;
  const v = await chooseSheet({ title: s.title, options: [
    { value: 'cover', label: 'Cambiar portada', icon: 'image' },
    { value: 'rename', label: 'Título y autor', icon: 'edit' },
    { value: 'export', label: 'Copia de seguridad de esta obra', icon: 'download' },
    { value: 'delete', label: 'Eliminar obra', icon: 'trash', danger: true },
  ] });
  if (v === 'cover') return openCoverPicker(s);
  if (v === 'rename') await editTitleAuthor(s);
  else if (v === 'export') exportScriptJSON(s);
  else if (v === 'delete') await deleteScript(s);
  if (v) rerender();
};

async function editTitleAuthor(s) {
  const t = await promptSheet({ title: 'Título de la obra', value: s.title });
  if (t == null || !t.trim()) return;
  const changed = t.trim() !== s.title;
  s.title = t.trim();
  const a = await promptSheet({ title: 'Autor (opcional)', value: s.author || '', placeholder: 'Ej.: William Shakespeare' });
  if (a != null) s.author = a.trim();
  saveScript(s);
  if (changed && !(s.cover && s.cover.kind === 'user') && S().autoCovers) findCoverFor(s, true);
}

async function deleteScript(s) {
  const ok = await confirmSheet({ title: '¿Eliminar esta obra?', text: `Se borrará «${esc(s.title)}» y todo tu progreso. No se puede deshacer.`, ok: 'Eliminar', danger: true });
  if (!ok) return false;
  App.scripts = App.scripts.filter((x) => x.id !== s.id);
  await DB.deleteScript(s.id);
  toast('Obra eliminada');
  return true;
}

function exportScriptJSON(s) {
  const data = JSON.stringify({ app: 'apuntador', version: 2, scripts: [s] }, (k, v) => (k.startsWith('_') ? undefined : v));
  download(`${safeFileName(s.title)}.apuntador.json`, data);
}

ACT.hideInstall = () => { S().installHidden = true; saveSettings(); rerender(); };
// Si el navegador permite instalar con un toque, lo hace; si no, explica cómo hacerlo a mano
ACT.install = async () => {
  const e = App.installEvt;
  if (!e) { openInstallHelp(); return; }
  e.prompt();
  let accepted = false;
  try { accepted = (await e.userChoice).outcome === 'accepted'; } catch (err) { /* nada */ }
  App.installEvt = null;
  if (accepted) toast('¡Instalada! Búscala con el resto de tus aplicaciones.');
  rerender();
};
window.addEventListener('appinstalled', () => { App.installEvt = null; S().installHidden = true; saveSettings(); });
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  App.installEvt = e;
  // puede llegar antes de que terminen de cargarse los ajustes
  if (App.settings && ['library', 'settings'].includes(currentView())) rerender();
});

/* ============ PORTADAS ============ */
async function findCoverFor(s, force = false) {
  if (App.coverBusy.has(s.id) || (!force && s.coverTried)) return;
  App.coverBusy.add(s.id);
  refreshCoverUI(s);
  try { await Covers.auto(s); } catch (e) { console.warn('portada', e); }
  App.coverBusy.delete(s.id);
  saveScript(s);
  refreshCoverUI(s);
}

function refreshCoverUI(s) {
  const view = currentView();
  if (view === 'review' && App.pending === s) {
    const p = $('#revPoster'); if (p) p.innerHTML = Covers.posterHTML(s);
    const st = $('#coverStatus'); if (st) st.innerHTML = coverStatusHTML(s);
    const t = $('#revTitle'); if (t && document.activeElement !== t && t.value !== s.title) t.value = s.title;
    const a = $('#revAuthor'); if (a && document.activeElement !== a && a.value !== (s.author || '')) a.value = s.author || '';
  } else if (!Sheet.el) {
    // solo pantallas que muestran la portada y no tienen una sesión en marcha
    const parts = parseHash().parts;
    const scriptPage = view === 's' && App.cur === s && !parts[3] && ['study', 'progress', 'settings'].includes(parts[2]);
    if (view === 'library' || scriptPage) rerender();
  }
}

function coverStatusHTML(s) {
  if (App.coverBusy.has(s.id)) return '<div class="cover-status"><span class="spin"></span> Buscando la obra en internet…</div>';
  if (s.work) {
    return `<div class="work-found">${icon('check')}<span class="grow">Obra reconocida: <b>${esc(s.title)}</b>${s.work.desc ? ` · ${esc(s.work.desc)}` : ''}</span></div>`;
  }
  if (s.coverTried && !s.cover && S().autoCovers) return '<div class="cover-status">No la he encontrado en internet: te he diseñado un cartel.</div>';
  return '';
}

ACT.coverPick = () => openCoverPicker(App.pending);
ACT.coverPickCur = () => openCoverPicker(App.cur);

function openCoverPicker(s) {
  if (!s) return;
  const cur = s.cover || {};
  const tpls = Covers.TEMPLATES.map((t) => `<button class="cover-opt ${cur.kind === 'tpl' && cur.tpl === t.id ? 'on' : ''}" data-tpl="${t.id}">
      ${Covers.templateHTML(t.id, s.title, s.author, s.title)}<small>${esc(t.name)}</small></button>`).join('');
  const el = Sheet.open(`<div class="sheet-body"><h3>Portada</h3>
    <div class="cover-search"><input class="input" id="cvQ" type="search" value="${esc(s.title)}" placeholder="Nombre de la obra" autocomplete="off">
      <button class="btn primary sm" id="cvGo" aria-label="Buscar">${icon('search', 'sm')}</button></div>
    <h4>En internet</h4><div class="cover-grid" id="cvNet"></div>
    <h4>Diseños de cartel</h4><div class="cover-grid">${tpls}</div>
    <button class="btn surface block mt" id="cvUpload">${icon('camera', 'sm')} Usar una foto mía</button>
    ${s.cover ? '<p class="center mt-s"><button class="link-btn" id="cvAuto">Volver al cartel automático</button></p>' : ''}</div>`);

  const net = el.querySelector('#cvNet');
  const search = async () => {
    const q = el.querySelector('#cvQ').value.trim();
    if (!q) return;
    net.innerHTML = '<p class="muted small" style="grid-column:1/-1">Buscando…</p>';
    let list = [];
    try { list = navigator.onLine === false ? [] : await Covers.candidates(q); } catch (e) { list = []; }
    if (!Sheet.el) return;
    net.innerHTML = list.length
      ? list.map((c, i) => `<button class="cover-opt" data-i="${i}"><div class="thumb"><img src="${esc(c.img)}" alt="" loading="lazy"></div></button>`).join('')
      : `<p class="muted small" style="grid-column:1/-1">${navigator.onLine === false ? 'Sin conexión. Elige un diseño o una foto tuya.' : 'No he encontrado imágenes. Prueba con otro nombre.'}</p>`;
    net.querySelectorAll('[data-i]').forEach((b) => {
      b.onclick = async () => {
        const c = list[Number(b.dataset.i)];
        Busy.show('Guardando portada…');
        try {
          const d = await Covers.toDataURL(c.img);
          s.cover = { kind: 'image', src: d.src, w: d.w, h: d.h, credit: c.credit };
          applyCover(s);
        } catch (e) { toast('No se pudo usar esa imagen'); }
        Busy.hide();
      };
    });
  };
  el.querySelector('#cvGo').onclick = search;
  el.querySelector('#cvQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  el.querySelectorAll('[data-tpl]').forEach((b) => { b.onclick = () => { s.cover = { kind: 'tpl', tpl: b.dataset.tpl }; applyCover(s); }; });
  el.querySelector('#cvUpload').onclick = () => { App.coverTarget = s; $('#coverIn').click(); };
  const auto = el.querySelector('#cvAuto');
  if (auto) auto.onclick = () => { s.cover = null; applyCover(s); };
  search();
}

async function applyCover(s) {
  saveScript(s);
  await Sheet.close();
  if (currentView() === 'review') refreshCoverUI(s); else rerender();
}

async function onCoverFile(file) {
  const s = App.coverTarget;
  App.coverTarget = null;
  if (!s || !file) return;
  Busy.show('Preparando tu foto…');
  try {
    const d = await Covers.toDataURL(file);
    s.cover = { kind: 'user', src: d.src, w: d.w, h: d.h, credit: 'Foto propia' };
    await applyCover(s);
  } catch (e) { toast('No se pudo abrir esa imagen'); }
  Busy.hide();
}

async function backfillCovers() {
  if (!S().autoCovers || navigator.onLine === false) return;
  for (const s of App.scripts) if (!s.coverTried) await findCoverFor(s);
}

/* ============ IMPORTAR ============ */
ACT.importMenu = () => {
  Sheet.open(`<div class="sheet-body" style="padding-bottom:2px"><h3>Nueva obra</h3></div><div class="list">
    ${rowHTML({ ic: 'upload', title: 'Subir archivo', sub: 'PDF, Word, TXT, ODT, RTF, Final Draft, Fountain', attrs: 'data-act="pickFile"' })}
    ${rowHTML({ ic: 'camera', title: 'Escanear páginas', sub: 'Haz fotos al guion en papel', attrs: 'data-act="scanPages"' })}
    ${rowHTML({ ic: 'paste', title: 'Pegar texto', sub: 'Copia el guion desde otra app', attrs: 'data-act="pasteText"' })}
    ${rowHTML({ ic: 'sparkle', title: 'Obra de ejemplo', sub: 'Para probar cómo funciona', attrs: 'data-act="loadSample"' })}
    ${rowHTML({ ic: 'music', title: 'Canción', sub: 'Desde Spotify, un audio tuyo o pegando la letra', attrs: 'data-act="addSong"' })}
  </div>`);
};

// El clic en el input de archivo debe ocurrir dentro del toque (Safari lo exige)
ACT.pickFile = () => { $('#fileIn').click(); Sheet.close(); };

ACT.loadSample = async () => {
  await Sheet.close();
  beginReview({ title: SAMPLE_TITLE, lines: Parser.textToLines(SAMPLE_SCRIPT) }, 'Ejemplo', { keepTitle: true, sample: true });
};

ACT.pasteText = async () => {
  if (Sheet.el) await Sheet.close();
  const el = Sheet.open(`<div class="sheet-body"><h3>Pegar el guion</h3>
    <p class="muted small" style="margin-bottom:14px">Funciona mejor si cada intervención empieza por el nombre del personaje, por ejemplo <span class="kbd">PEDRO: Hola.</span></p>
    <label class="field"><span>Título de la obra</span><input type="text" id="pTitle" placeholder="Ej.: Bodas de sangre"></label>
    <label class="field"><span>Texto</span><textarea id="pText" rows="10" placeholder="Pega aquí el texto del guion…"></textarea></label>
    <div class="sheet-actions"><button class="btn soft" data-act="sheetClose">Cancelar</button><button class="btn primary" id="pGo">Analizar</button></div></div>`);
  el.querySelector('#pGo').onclick = async () => {
    const text = el.querySelector('#pText').value;
    const title = el.querySelector('#pTitle').value.trim();
    if (text.trim().length < 20) { toast('Pega algo más de texto'); return; }
    await Sheet.close();
    beginReview({ title: title || 'Obra sin título', lines: Parser.textToLines(text) }, 'Texto pegado', { keepTitle: !!title });
  };
};

/* escanear con la cámara: varias páginas */
ACT.scanPages = async () => {
  if (Sheet.el) await Sheet.close();
  App.scan = [];
  renderScanSheet();
};
function renderScanSheet() {
  const n = App.scan.length;
  const rows = App.scan.map((f, i) => rowHTML({ tag: 'div', ic: 'image', title: `Página ${i + 1}`, sub: f.name || 'foto',
    end: `<button class="icon-btn" data-act="scanDel" data-i="${i}" aria-label="Quitar">${icon('close', 'sm')}</button>` })).join('');
  Sheet.open(`<div class="sheet-body"><h3>Escanear páginas</h3>
    <p class="muted small" style="margin-bottom:12px">Haz una foto a cada página, recta y con buena luz. La app reconocerá el texto (la primera vez necesita conexión).</p></div>
    ${n ? `<div class="list">${rows}</div>` : ''}
    <div class="sheet-body"><div class="btn-row mt-s">
      <button class="btn surface" data-act="scanCam">${icon('camera')} Foto</button>
      <button class="btn surface" data-act="scanGallery">${icon('image')} Galería</button></div>
      <button class="btn primary block big mt" data-act="scanGo" ${n ? '' : 'disabled'}>Reconocer texto${n ? ` (${plural(n, 'página', 'páginas')})` : ''}</button></div>`);
}
ACT.scanCam = () => $('#camIn').click();
ACT.scanGallery = () => $('#galIn').click();
ACT.scanDel = (el) => { App.scan.splice(Number(el.dataset.i), 1); renderScanSheet(); };
ACT.scanGo = async () => {
  const files = App.scan.slice();
  App.scan = [];
  await Sheet.close();
  Busy.show('Preparando…');
  try {
    const res = await Importers.fromImages(files, (p, m) => Busy.progress(p, m), S().ocrLang);
    Busy.hide();
    beginReview({ ...res, title: '' }, plural(files.length, 'foto', 'fotos'));
  } catch (e) {
    Busy.hide();
    console.error(e);
    alertSheet('No se pudo reconocer el texto', e.message || String(e));
  }
};

async function importFiles(files) {
  files = Array.from(files || []);
  if (!files.length) return;
  Busy.show('Leyendo el guion…');
  try {
    let res;
    if (files.length > 1 && files.every(Importers.isImage)) {
      res = await Importers.fromImages(files, (p, m) => Busy.progress(p, m), S().ocrLang);
      res.title = '';
    } else {
      res = await Importers.fromFile(files[0], (p, m) => Busy.progress(p, m), {
        ocrLang: S().ocrLang,
        confirmOCR: async (n) => {
          Busy.hide();
          const ok = await confirmSheet({ title: 'PDF escaneado', text: `Este PDF está hecho de imágenes (${plural(n, 'página', 'páginas')}). ¿Intento reconocer el texto? Necesita conexión y puede tardar un poco.`, ok: 'Reconocer texto' });
          if (ok) Busy.show('Preparando…');
          return ok;
        },
      });
      if (files.length > 1) toast('Solo se ha importado el primer archivo');
    }
    Busy.hide();
    beginReview(res, files[0].name);
  } catch (e) {
    console.error(e);
    Busy.hide();
    alertSheet('No se pudo leer el archivo', e.message || String(e));
  }
}

/**
 * Analiza las líneas importadas y abre la pantalla de revisión.
 * opts.keepTitle: respetar el título recibido · opts.sample: obra de ejemplo (sin búsqueda en internet)
 */
function beginReview(res, sourceName, opts = {}) {
  const r = Parser.parse(res.lines || []);
  const prev = opts.reparse ? App.pending : null;
  const meta = opts.keepTitle ? { title: res.title, author: '' } : Covers.guessMeta(r.blocks, res.title);
  const p = Model.create({ title: meta.title, author: meta.author, blocks: r.blocks, characters: r.characters, format: r.format, verse: r.verse, source: sourceName });
  if (prev) Object.assign(p, { title: prev.title, author: prev.author, cover: prev.cover, coverTried: prev.coverTried, work: prev.work });
  if (opts.sample) { p.coverTried = true; p.cover = { kind: 'tpl', tpl: 'velvet' }; p.author = 'Obra de ejemplo'; }
  App.pending = p;
  go('/review');
  if (!p.coverTried && S().autoCovers) findCoverFor(p);
  else p.coverTried = true;
}

function setupFileInputs() {
  $('#fileIn').addEventListener('change', (e) => { const f = e.target.files; importFiles(f); e.target.value = ''; });
  const addScan = (e) => { App.scan.push(...Array.from(e.target.files || [])); e.target.value = ''; renderScanSheet(); };
  $('#camIn').addEventListener('change', addScan);
  $('#galIn').addEventListener('change', addScan);
  $('#coverIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; onCoverFile(f); });
  $('#songAudioIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; onSongAudioFile(f); });
  // arrastrar y soltar (ordenador y tabletas con teclado)
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const fs = e.dataTransfer && e.dataTransfer.files;
    if (!fs || !fs.length) return;
    if (/^audio\//.test(fs[0].type)) { App.audioTarget = currentView() === 'song' ? App.curSong : null; onSongAudioFile(fs[0]); }
    else importFiles(fs);
  });
}

async function checkShared() {
  if (!('caches' in window)) return;
  try {
    const key = new URL('__shared__', location.href.split('#')[0]).href;
    const c = await caches.open('apuntador-share');
    const r = await c.match(key);
    if (!r) return;
    await c.delete(key);
    const name = decodeURIComponent(r.headers.get('x-name') || 'compartido.txt');
    const blob = await r.blob();
    history.replaceState(null, '', '#/');
    await importFiles([new File([blob], name, { type: blob.type })]);
  } catch (e) { console.warn(e); }
}

/* ============ REVISIÓN TRAS IMPORTAR ============ */
function ctxScript() { return currentView() === 'review' ? App.pending : App.cur; }

function charRowHTML(s, c, I) {
  const on = s.me.includes(c.id);
  const n = (I.counts[c.id] || { lines: 0 }).lines;
  return `<div class="row char-row ${on ? 'on' : ''}" data-act="toggleMe" data-cid="${c.id}" role="checkbox" aria-checked="${on}" tabindex="0">
    ${avatarHTML(c)}<span class="grow"><span class="name">${esc(c.name)}</span><small>${plural(n, 'intervención', 'intervenciones')}${c.group ? ' · grupo' : ''}</small></span>
    <span class="check">${icon('check')}</span>
    <button class="icon-btn" data-act="charMenu" data-cid="${c.id}" aria-label="Opciones de ${esc(c.name)}">${icon('more')}</button></div>`;
}

function charListHTML(s) {
  const I = Model.ix(s);
  const lines = (c) => (I.counts[c.id] || { lines: 0 }).lines;
  return `<div class="list">${s.characters.slice().sort((a, b) => lines(b) - lines(a)).map((c) => charRowHTML(s, c, I)).join('')}</div>`;
}

function viewReview() {
  const p = App.pending;
  if (!p) return go('/', true);
  const I = Model.ix(p);
  const nScenes = I.scenes.filter((x) => x.id !== '_start').length;
  const meName = p.me.length ? Model.charName(p, p.me) : '';
  mount(`
  <header class="topbar"><button class="icon-btn" data-act="cancelImport" aria-label="Cancelar">${icon('close')}</button>
    <div class="tb-title"><h2>Revisar obra</h2><span class="tb-sub">${esc(p.source)}</span></div></header>
  <main class="page no-tabs">
    <div class="review-top">
      <div id="revPoster" data-act="coverPick" style="cursor:pointer;width:172px">${Covers.posterHTML(p)}</div>
      <button class="btn surface sm mt" data-act="coverPick">${icon('image', 'sm')} Cambiar portada</button>
      <div id="coverStatus" style="width:100%">${coverStatusHTML(p)}</div>
    </div>
    <label class="field mt"><span>Título</span><input type="text" id="revTitle" data-input="pendingTitle" value="${esc(p.title)}"></label>
    <label class="field"><span>Autor</span><input type="text" id="revAuthor" data-input="pendingAuthor" value="${esc(p.author || '')}" placeholder="Opcional"></label>
    <div class="summary-pills"><span class="pill">${plural(p.characters.length, 'personaje', 'personajes')}</span><span class="pill">${plural(nScenes, 'escena', 'escenas')}</span><span class="pill">${plural(I.totalLines, 'intervención', 'intervenciones')}</span></div>
    ${p.characters.length ? `
      <h3 class="section-title">¿Qué personaje eres?</h3>
      <p class="hint">Tócalo para elegirlo. Puedes elegir varios si haces más de un papel.</p>
      ${charListHTML(p)}
      <p class="hint mt-s">¿Nombres repetidos o algo que no es un personaje? Toca ⋮ para unir, renombrar o quitar.</p>`
    : `<div class="card mt">
      <h3 class="section-title" style="margin-top:0">No he encontrado personajes</h3>
      <p class="muted">Cada intervención tiene que empezar por el nombre del personaje. Por ejemplo:</p>
      <p class="mt-s"><span class="kbd">PEDRO: ¿Dónde estabas?</span><br><span class="kbd">MARÍA.— En el teatro.</span></p>
      <p class="muted mt-s">Puedes corregir el texto aquí mismo y volver a analizarlo.</p></div>`}
    <details class="preview mt"><summary>Ver cómo ha quedado el guion ›</summary>
      <div class="preview-box"><div class="${scriptClasses(p)}">${p.blocks.slice(0, 80).map((b, i) => blockHTML(p, b, i)).join('')}${p.blocks.length > 80 ? '<p class="gap-sep">· · ·</p>' : ''}</div></div></details>
    <button class="btn soft sm mt" data-act="editRaw">${icon('edit', 'sm')} Corregir el texto y volver a analizar</button>
  </main>
  <div class="sess-actions"><div class="inner"><button class="btn primary big" data-act="confirmImport" ${p.me.length ? '' : 'disabled'}>${p.me.length ? 'Empezar como ' + esc(meName) : 'Elige tu personaje'}</button></div></div>`);
}

const refreshReviewPoster = debounce(() => { const p = App.pending; if (p && $('#revPoster')) $('#revPoster').innerHTML = Covers.posterHTML(p); }, 250);
INPUT.pendingTitle = (el) => { if (!App.pending) return; App.pending.title = el.value; App.pending.work = null; refreshReviewPoster(); };
INPUT.pendingAuthor = (el) => { if (!App.pending) return; App.pending.author = el.value; refreshReviewPoster(); };

ACT.toggleMe = (el) => {
  const s = ctxScript();
  if (!s) return;
  const id = el.dataset.cid;
  s.me = s.me.includes(id) ? s.me.filter((x) => x !== id) : [...s.me, id];
  structural(s);
  rerender();
};

ACT.cancelImport = async () => {
  const ok = await confirmSheet({ title: '¿Descartar esta obra?', ok: 'Descartar', danger: true });
  if (ok) { App.pending = null; go('/', true); }
};

ACT.confirmImport = async () => {
  const p = App.pending;
  if (!p || !p.me.length) return;
  p.title = (p.title || '').trim() || 'Obra sin título';
  p.author = (p.author || '').trim();
  App.pending = null;
  App.scripts.push(p);
  await DB.putScript(p);
  DB.persist();
  App.firstOpen = p.id;
  go(`/s/${p.id}/read`, true);
};

ACT.editRaw = async () => {
  const p = App.pending;
  if (!p) return;
  const text = await promptSheet({ title: 'Corregir texto', value: Model.toText(p), multiline: true, ok: 'Volver a analizar',
    hint: 'Cada intervención debe empezar por el NOMBRE del personaje y dos puntos. Las acotaciones, mejor entre paréntesis.' });
  if (text == null) return;
  beginReview({ title: p.title, lines: Parser.textToLines(text) }, p.source, { keepTitle: true, reparse: true });
};

/* menú de un personaje (revisión y ajustes de la obra) */
ACT.charMenu = async (el) => {
  const s = ctxScript();
  const c = s && Model.charOf(s, el.dataset.cid);
  if (!c) return;
  const v = await chooseSheet({ title: c.name, options: [
    { value: 'rename', label: 'Renombrar', icon: 'edit' },
    { value: 'merge', label: 'Unir con otro personaje', sub: 'Si aparece escrito de dos formas (MARIA / MARÍA)', icon: 'merge' },
    { value: 'color', label: 'Cambiar color', icon: 'palette' },
    { value: 'remove', label: 'No es un personaje', sub: 'Sus líneas pasan a ser acotaciones', icon: 'trash', danger: true },
  ] });
  if (v === 'rename') {
    const n = await promptSheet({ title: 'Renombrar personaje', value: c.name });
    if (n && n.trim()) { Model.renameChar(s, c.id, n); structural(s); }
  } else if (v === 'merge') {
    const others = s.characters.filter((x) => x.id !== c.id);
    if (!others.length) return;
    const into = await chooseSheet({ title: `Unir ${c.name} con…`, sub: `Todas las frases de ${esc(c.name)} pasarán al personaje que elijas.`, options: others.map((o) => ({ value: o.id, label: o.name, dot: o.color })) });
    if (into) { Model.mergeChar(s, c.id, into); structural(s); }
  } else if (v === 'color') {
    const col = await colorSheet(c.color);
    if (col) { c.color = col; structural(s); }
  } else if (v === 'remove') {
    const ok = await confirmSheet({ title: `¿Quitar ${esc(c.name)}?`, text: 'Sus intervenciones se convertirán en acotaciones.', ok: 'Quitar', danger: true });
    if (ok) { Model.removeChar(s, c.id); structural(s); }
  }
  if (v) rerender();
};

function colorSheet(current) {
  return sheetPromise(`<div class="sheet-body"><h3>Color del personaje</h3><div class="swatches">${CHAR_COLORS.map((c) =>
    `<button class="swatch ${c === current ? 'on' : ''}" style="background:${c}" data-c="${c}" aria-label="Color ${c}"></button>`).join('')}</div></div>`,
  (el, finish) => el.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => finish(b.dataset.c); }));
}

/* ============ AJUSTES GENERALES ============ */
function spotifyCardHTML() {
  const st = S();
  const on = Spotify.connected();
  const uri = Spotify.redirectUri();
  const https = location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  return `<div class="card" id="sec-spotify">
    <div class="sp-head">${icon('music')}<b class="grow">Spotify</b><span class="pill ${on ? 'ok' : ''}">${on ? 'Conectado' : 'Sin conectar'}</span></div>
    ${on ? `<p class="small muted" style="margin:8px 4px 14px">Puedes buscar canciones en Spotify, importar la que estés escuchando y controlarla desde la letra. Las letras vienen de LRCLIB.</p>
      <div class="btn-row"><button class="btn surface" data-act="spTest">${icon('check', 'sm')} Probar</button><button class="btn soft" data-act="spLogout">Desconectar</button></div>`
    : `<p class="small muted" style="margin:8px 4px 12px">Cada persona usa su propia clave gratuita de Spotify. Hace falta <b>Spotify Premium</b> (Spotify lo exige para las apps de desarrollador y para controlar la música).</p>
      <details class="preview" ${st.spotifyClientId ? '' : 'open'}><summary>Cómo conseguir tu clave (5 minutos) ›</summary>
        <div class="steps howto mt-s">
          <div class="step"><span class="n">1</span><div>Entra en <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> con tu cuenta de Spotify y acepta las condiciones.</div></div>
          <div class="step"><span class="n">2</span><div>Pulsa <b>«Create app»</b>. Nombre y descripción: lo que quieras (p. ej. «Apuntador»).</div></div>
          <div class="step"><span class="n">3</span><div>En <b>«Redirect URIs»</b> pega exactamente esta dirección y pulsa <b>Add</b>:<div class="copy-row"><code id="spUri">${esc(uri)}</code><button class="btn sm soft" data-act="spCopyUri">Copiar</button></div></div></div>
          <div class="step"><span class="n">4</span><div>Marca <b>«Web API»</b>, acepta y guarda. Dentro de la app, en <b>Settings</b>, copia el <b>Client ID</b> y pégalo aquí abajo.</div></div>
          <div class="step"><span class="n">5</span><div>Si otra persona va a usar tu clave, añade su correo en <b>«User Management»</b> (máximo 5 personas).</div></div>
        </div></details>
      ${https ? '' : '<p class="small" style="color:var(--bad);margin:10px 4px">Spotify solo funciona con la app publicada en https (por ejemplo en Netlify).</p>'}
      <label class="field mt-s"><span>Client ID de Spotify</span><input type="text" data-change="spotifyClientId" value="${esc(st.spotifyClientId)}" placeholder="Pega aquí tu Client ID" autocomplete="off" spellcheck="false"></label>
      <button class="btn primary block" data-act="spLogin" ${st.spotifyClientId ? '' : 'disabled'}>${icon('link', 'sm')} Conectar con Spotify</button>`}
    <p class="small muted" style="margin:12px 4px 0">Spotify no permite descargar canciones: para tenerla guardada y oírla sin conexión (o más despacio), sube su audio en mp3 desde la canción.</p>
  </div>`;
}

CHANGE.spotifyClientId = (el) => { S().spotifyClientId = el.value.trim(); saveSettings(); rerender(); };
ACT.spCopyUri = async () => {
  const uri = Spotify.redirectUri();
  try { await navigator.clipboard.writeText(uri); toast('Dirección copiada'); } catch (e) { toast(uri, 6000); }
};
ACT.spLogin = async () => {
  saveSettings.flush();
  try { await Spotify.login(); } catch (e) { alertSheet('No se pudo conectar', e.message); }
};
ACT.spLogout = async () => { await Spotify.logout(); toast('Spotify desconectado'); rerender(); };
ACT.spTest = async () => {
  try {
    const st = await Spotify.state();
    toast(st && st.track ? `Conectado. Suena: ${st.track.title}` : 'Conectado correctamente', 3500);
  } catch (e) { alertSheet('Spotify', e.message); }
};

// Estado del almacenamiento: si el navegador «protege» los datos no los borra aunque le falte espacio
async function storageCardFill() {
  const el = $('#storeInfo');
  if (!el) return;
  const [persisted, est] = await Promise.all([DB.persisted(), DB.estimate()]);
  App.protected = persisted;
  const mb = (b) => (b / 1048576).toFixed(b > 104857600 ? 0 : 1).replace('.', ',') + ' MB';
  el.innerHTML = `<div class="row flat"><span class="ri" style="color:${persisted ? 'var(--ok)' : 'var(--warn)'}">${icon('shield')}</span>
    <span class="grow"><b>${persisted ? 'Datos protegidos' : 'Protección no confirmada'}</b><small>${persisted ? 'El navegador no los borrará aunque le falte espacio.' : 'El navegador podría borrarlos si se queda sin espacio. Instala la app y haz copias.'}</small></span>
    ${persisted ? '' : '<button class="btn sm primary" data-act="protectData">Proteger</button>'}</div>
    ${est && est.usage != null ? `<p class="small muted" style="margin:0 16px 12px">Ocupan ${mb(est.usage)}${est.quota ? ` de ${mb(est.quota)} disponibles` : ''}.</p>` : ''}`;
}
ACT.protectData = async () => {
  const ok = await DB.persist();
  toast(ok ? 'Datos protegidos' : 'El navegador no lo ha permitido todavía: instala la app en la pantalla de inicio y vuelve a probar', 4500);
  storageCardFill();
};

function viewSettings(q) {
  const st = S();
  const voices = TTS.voicesFor(st.lang);
  const install = isStandalone() ? ''
    : `<div class="banner">${icon('phone')}<span class="grow"><b>Instalar en el móvil</b><br><span class="small muted">Tendrás su icono y funcionará sin conexión.</span></span><button class="btn sm primary" data-act="install">Instalar</button></div>`;
  mount(`
  <header class="topbar"><button class="icon-btn" data-act="go" data-to="/" aria-label="Volver">${icon('back')}</button><div class="tb-title"><h2>Ajustes</h2></div></header>
  <main class="page no-tabs">
    ${install}
    <h3 class="section-title">Apariencia</h3>
    <div class="card">
      <div class="field"><span>Tema</span>${segHTML('setOpt', st.theme, [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']], 'data-k="theme"')}</div>
      <div class="field"><span>Color del subrayado</span>${swatchesHTML()}</div>
      <div class="field"><span>Tamaño de letra del guion</span><div class="range-row"><input type="range" min="14" max="30" step="1" value="${st.fontSize}" data-input="fontSize" aria-label="Tamaño de letra"><output class="fsOut">${st.fontSize}</output></div></div>
      <div class="field"><span>Tipo de letra</span>${segHTML('setOpt', st.font, [['serif', 'Libro'], ['mono', 'Máquina'], ['sans', 'Moderna']], 'data-k="font"')}</div>
      <div class="field" style="margin:0"><span>Maquetación</span>${segHTML('setOpt', st.style, [['auto', 'Automática'], ['theatre', 'Teatro'], ['screen', 'Cine']], 'data-k="style"')}</div>
    </div>
    <h3 class="section-title">Voces</h3>
    <div class="card">
      <div class="field"><span>Tipo de voz para las réplicas</span>${segHTML('setOpt', st.voiceEngine, [['device', 'Del móvil'], ['gemini', 'Natural (Gemini)']], 'data-k="voiceEngine"')}</div>
      ${st.voiceEngine === 'gemini' ? `
        <label class="field"><span>Tu clave de Gemini</span><input type="password" data-change="geminiKey" value="${esc(st.geminiKey)}" placeholder="Pega aquí tu clave" autocomplete="off" spellcheck="false"></label>
        <p class="small muted" style="margin:-6px 4px 14px">Es gratis: entra en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>, pulsa «Create API key» y pégala aquí. Solo se guarda en este dispositivo.</p>
        <div class="field"><span>Calidad</span>${segHTML('setOpt', st.geminiModel, GEMINI_MODELS, 'data-k="geminiModel"')}</div>
        <p class="small muted" style="margin:0 4px 14px">Las frases de los demás personajes se envían a Google para crear el audio y se guardan en el móvil: la segunda vez suenan al instante y sin conexión. El plan gratuito tiene un límite de uso; si se acaba, la app sigue con la voz del móvil.</p>
        <div class="btn-row"><button class="btn primary" data-act="testVoice">${icon('volume')} Probar</button><button class="btn surface" data-act="clearVoices">${icon('trash', 'sm')} Borrar audios</button></div>`
      : `<p class="small muted" style="margin:-4px 4px 0">Las voces naturales de Gemini suenan como una persona, con emoción y entonación. Necesitan una clave gratuita de Google e internet la primera vez.</p>`}
    </div>
    <div class="card">
      <label class="field"><span>Idioma de los guiones</span><select data-change="lang">${LANGS.map(([v, l]) => `<option value="${v}" ${v === st.lang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Voz del móvil preferida</span><select data-change="voice"><option value="">Automática (la más natural)</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${st.voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)}${TTS.isNatural(v) ? ' · natural' : ''}</option>`).join('')}</select></label>
      <div class="field"><span>Velocidad de lectura</span><div class="range-row"><input type="range" min="0.6" max="1.6" step="0.05" value="${st.rate}" data-input="rate" aria-label="Velocidad"><output id="rateOut">${Number(st.rate).toFixed(2)}×</output></div></div>
      ${st.voiceEngine !== 'gemini' ? `<button class="btn surface block" data-act="testVoice">${icon('volume')} Probar voz</button>` : ''}
      <p class="small muted mt-s">${TTS.supported ? (voices.length ? `${plural(voices.length, 'voz disponible', 'voces disponibles')} en este idioma.` : 'No hay voces de este idioma instaladas; se usará la del sistema.') : 'Este navegador no puede leer en voz alta.'}</p>
      <details class="preview"><summary>Mejorar la voz del móvil (gratis y sin internet) ›</summary>
        <p class="small muted" style="margin:0 4px 6px"><b>Samsung / Android:</b> Ajustes → Administración general → Salida de texto a voz (o busca «texto a voz»). Elige «Servicios de voz de Google», toca el engranaje → Instalar datos de voz → Español y descarga las voces.</p>
        <p class="small muted" style="margin:0 4px 6px"><b>iPhone / iPad:</b> Ajustes → Accesibilidad → Contenido leído → Voces → Español, y descarga una voz «Mejorada» o «Premium» (por ejemplo Mónica o Jorge).</p>
        <p class="small muted" style="margin:0 4px">Después vuelve aquí: la app elegirá sola las voces más naturales.</p></details>
    </div>
    <h3 class="section-title">Micrófono en los ensayos</h3>
    <div class="card">
      <div class="field"><span>Cómo te escucha la app</span>${segHTML('setOpt', st.micMode, [['auto', 'Automático'], ['app', 'Detector de la app'], ['browser', 'Del navegador']], 'data-k="micMode"')}</div>
      <p class="small muted" style="margin:-4px 4px 12px">«Detector de la app» usa el micrófono como el afinador: funciona en cualquier navegador (también en Samsung Internet) y sabe cuándo empiezas y terminas tu frase. «Del navegador» entiende tus palabras sin clave, pero en algunos móviles no funciona. En automático se prueba el del navegador y, si falla, se cambia solo.${SR.supported ? '' : ' <b>Este navegador no tiene reconocimiento de voz propio.</b>'}</p>
      ${st.voiceEngine !== 'gemini' ? `<label class="field"><span>Clave de Gemini (para puntuar tus palabras)</span><input type="password" data-change="geminiKey" value="${esc(st.geminiKey)}" placeholder="Opcional" autocomplete="off" spellcheck="false"></label>` : ''}
      <p class="small muted" style="margin:-4px 4px 12px">${st.geminiKey ? 'Con tu clave de Gemini, el detector de la app entiende lo que dices, marca las palabras acertadas y te puntúa. Tu grabación se envía a Google solo para transcribirla.' : 'Sin clave, el detector de la app te oye y sigue el ensayo, pero no puede saber qué palabras has dicho: te enseña la frase para que compruebes tú. La clave es gratis en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>.'}</p>
      <button class="btn surface block" data-act="testMic">${icon('mic')} Probar micrófono</button>
    </div>
    <h3 class="section-title">Música</h3>
    ${spotifyCardHTML()}
    <h3 class="section-title">Portadas y escaneo</h3>
    <div class="card">
      ${switchHTML('autoCovers', st.autoCovers, 'Buscar portadas en internet', 'Reconoce la obra y busca su imagen en Wikipedia. Solo se envían el título y el autor, nunca el guion.')}
      <label class="field" style="margin:10px 0 0"><span>Idioma del texto escaneado</span><select data-change="ocrLang">${OCR_LANGS.map(([v, l]) => `<option value="${v}" ${v === st.ocrLang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <h3 class="section-title">Tus datos</h3>
    <div class="list" id="storeInfo"></div>
    <div class="list mt-s">
      ${rowHTML({ ic: 'download', title: 'Hacer copia de seguridad', sub: `Obras, canciones y progreso${st.lastBackup ? ' · última: ' + relDay(st.lastBackup) : ''}`, attrs: 'data-act="backupAll"' })}
      ${rowHTML({ ic: 'upload', title: 'Restaurar una copia', sub: 'Carga un archivo .apuntador.json o .zip', attrs: 'data-act="restoreAll"' })}
    </div>
    <p class="small muted mt-s">Todo se guarda solo en este dispositivo. <b>Actualizar la app no borra nada</b>, siempre que la abras desde la misma dirección. Lo que sí lo borra: desinstalarla eligiendo «borrar datos», o borrar los datos del navegador. Por eso conviene hacer copias.</p>
    <p class="center small muted mt-l">Apuntador ${VERSION} · Ilustraciones creadas con Figma AI · Letras de LRCLIB</p>
  </main>
  <input type="file" id="restoreIn" accept=".json,.zip,application/json,application/zip" hidden>`);
  $('#restoreIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreBackup(f); });
  App.onSettings = (k) => {
    if (k === 'voiceEngine') { Voices.resetBlock(); rerender(); }
    if (k === 'geminiModel') Voices.resetBlock();
    if (k === 'micMode') MicPref.broken = false;
  };
  storageCardFill();
  if (q && q.get('sec') === 'spotify') setTimeout(() => { const el = $('#sec-spotify'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 80);
}

function swatchesHTML() {
  return `<div class="swatches">${Object.entries(HL_COLORS).map(([k, c]) =>
    `<button class="swatch ${S().hl === k ? 'on' : ''}" style="background:${c}" data-act="setOpt" data-k="hl" data-v="${k}" aria-label="Subrayado ${k}"></button>`).join('')}</div>`;
}

ACT.setOpt = (el) => {
  const k = el.dataset.k;
  S()[k] = el.dataset.v;
  saveSettings();
  applySettings();
  if (el.parentElement) el.parentElement.querySelectorAll('[data-act="setOpt"]').forEach((b) => b.classList.toggle('on', b === el));
  if (App.onSettings) App.onSettings(k);
};

INPUT.fontSize = (el) => {
  S().fontSize = Number(el.value);
  applySettings();
  $$('.fsOut').forEach((o) => { o.textContent = el.value; });
  saveSettings();
};
INPUT.rate = (el) => { S().rate = Number(el.value); const o = $('#rateOut'); if (o) o.textContent = Number(el.value).toFixed(2) + '×'; saveSettings(); };
CHANGE.lang = (el) => { S().lang = el.value; S().voiceURI = ''; saveSettings(); rerender(); };
CHANGE.voice = (el) => { S().voiceURI = el.value; saveSettings(); };
CHANGE.ocrLang = (el) => { S().ocrLang = el.value; saveSettings(); };
CHANGE.autoCovers = (el) => { S().autoCovers = el.checked; saveSettings(); if (el.checked) backfillCovers(); };
CHANGE.showNotes = (el) => { S().showNotes = el.checked; saveSettings(); if (App.onSettings) App.onSettings('showNotes'); };
CHANGE.charColors = (el) => { S().charColors = el.checked; saveSettings(); if (App.onSettings) App.onSettings('charColors'); };

CHANGE.geminiKey = (el) => { S().geminiKey = el.value.trim(); saveSettings(); Voices.resetBlock(); Transcriber.reset(); };

// Prueba del micrófono de los ensayos: di una frase y la app te dice qué ha oído
let micTest = null;
ACT.testMic = (el) => {
  if (micTest) { micTest.finishNow(); return; }
  if (!canListen()) { toast('Este navegador no puede usar el micrófono.', 4000); return; }
  VAD.unlock();
  const label = el.innerHTML;
  const reset = () => { micTest = null; el.innerHTML = label; };
  el.innerHTML = `<span class="mic-dot"></span> Di: «probando, uno, dos, tres»`;
  micTest = listenLine(toWords('probando uno dos tres'), {
    lang: S().lang,
    onUpdate: (al, t) => { el.innerHTML = `<span class="mic-dot"></span> ${esc(t.slice(-40))}`; },
    onLevel: (lv, speaking) => {
      el.innerHTML = lv < 0 ? 'Comprobando…' : `<span class="mic-dot"></span> ${speaking ? 'Te oigo…' : 'Di: «probando, uno, dos, tres»'}<span class="vu"><i style="width:${Math.round(lv * 10) * 10}%"></i></span>`;
    },
    onDone: (al, t, reason) => {
      reset();
      const how = MicPref.useBrowser() ? 'reconocimiento del navegador' : 'detector de la app';
      if (reason === 'nothing' || (!t && !al.unscored)) toast('No te he oído. Revisa el permiso del micrófono y prueba otra vez.', 4500);
      else if (al.unscored) toast(`✓ Te oigo (${how}). Sin clave de Gemini no puedo entender las palabras, pero el ensayo funcionará.`, 5500);
      else toast(`✓ He entendido: «${t}» (${how})`, 5000);
    },
    onError: (err) => { reset(); toast(micErrorMsg(err), 5000); },
  });
};

ACT.testVoice = async (el) => {
  if (S().voiceEngine === 'gemini' && !S().geminiKey) { toast('Pega primero tu clave de Gemini'); return; }
  Voices.unlock();
  await TTS.init();
  Voices.cancel();
  if (Voices.enabled()) {
    el.disabled = true;
    toast('Generando la voz con Gemini…', 1800);
  }
  await Voices.say(null, { text: 'Hola. Soy tu apuntador. Cuando quieras, empezamos el ensayo.', role: 'narrator' });
  el.disabled = false;
};

ACT.clearVoices = async () => {
  const ok = await confirmSheet({ title: '¿Borrar los audios guardados?', text: 'Se borrarán las voces naturales ya generadas. Se volverán a crear cuando ensayes (necesitará internet).', ok: 'Borrar', danger: true });
  if (!ok) return;
  await DB.audioClear();
  toast('Audios borrados');
};

/*
 * Copia de seguridad: obras + canciones + clase de canto en un .json.
 * Si hay audios de canciones, se puede elegir un .zip que los incluye (ocupa más).
 */
ACT.backupAll = async () => {
  if (!App.scripts.length && !App.songs.length) { toast('Todavía no tienes nada que guardar'); return; }
  flushAll();
  flushSongs();
  const strip = (k, v) => (k.startsWith('_') ? undefined : v);
  const data = JSON.stringify({ app: 'apuntador', version: 3, date: new Date().toISOString(), scripts: App.scripts, songs: App.songs, sing: App.sing }, strip);
  const withAudio = App.songs.filter((sg) => sg.audio);
  let zip = false;
  if (withAudio.length) {
    const v = await chooseSheet({ title: 'Copia de seguridad', options: [
      { value: 'zip', label: 'Con los audios de las canciones', sub: `Archivo .zip · ${plural(withAudio.length, 'audio', 'audios')}`, icon: 'music' },
      { value: 'json', label: 'Sin audios (más ligera)', sub: 'Los audios tendrás que volver a subirlos', icon: 'file' },
    ] });
    if (!v) return;
    zip = v === 'zip';
  }
  const name = `apuntador-copia-${todayKey()}`;
  try {
    if (zip) {
      Busy.show('Preparando la copia…');
      await loadScript('vendor/jszip.min.js');
      const z = new JSZip();
      z.file('copia.apuntador.json', data);
      for (const sg of withAudio) { const b = await DB.songAudioGet(sg.audio.key); if (b) z.file('audio/' + sg.audio.key, b); }
      const blob = await z.generateAsync({ type: 'blob' }, (m) => Busy.progress(m.percent / 100));
      Busy.hide();
      await shareOrDownload(name + '.apuntador.zip', blob);
    } else await shareOrDownload(name + '.apuntador.json', new Blob([data], { type: 'application/json' }));
    S().lastBackup = Date.now();
    saveSettings();
    if (currentView() === 'library') rerender();
  } catch (e) {
    Busy.hide();
    alertSheet('No se pudo hacer la copia', e.message || String(e));
  }
};

// En el móvil, «Compartir» deja guardarla directamente en Drive, el correo, WhatsApp…
async function shareOrDownload(name, blob) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (isTouchDevice() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia de Apuntador' }); return; }
    catch (e) { if (e && e.name === 'AbortError') throw new Error('Copia cancelada'); }
  }
  download(name, blob);
}
ACT.restoreAll = () => $('#restoreIn').click();

async function restoreBackup(file) {
  try {
    let data, zip = null;
    if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
      Busy.show('Abriendo la copia…');
      await loadScript('vendor/jszip.min.js');
      zip = await JSZip.loadAsync(file);
      const j = zip.file(/\.json$/i)[0];
      if (!j) throw new Error('El .zip no contiene una copia de Apuntador.');
      data = JSON.parse(await j.async('string'));
      Busy.hide();
    } else data = JSON.parse(await file.text());
    const list = (Array.isArray(data) ? data : data.scripts) || [];
    const songs = (!Array.isArray(data) && Array.isArray(data.songs)) ? data.songs : [];
    if (!list.every((x) => x && x.id && Array.isArray(x.blocks)) || !songs.every((x) => x && x.id) || (!list.length && !songs.length)) throw new Error('El archivo no es una copia de Apuntador.');
    const parts = [list.length ? plural(list.length, 'obra', 'obras') : '', songs.length ? plural(songs.length, 'canción', 'canciones') : ''].filter(Boolean).join(' y ');
    const ok = await confirmSheet({ title: 'Restaurar copia', text: `Se cargarán ${parts}. Lo que ya tengas igual se sustituirá; lo demás se conserva.`, ok: 'Restaurar' });
    if (!ok) return;
    Busy.show('Restaurando…');
    for (const raw of list) {
      const s = Model.normalize(raw);
      App.scripts = App.scripts.filter((x) => x.id !== s.id);
      App.scripts.push(s);
      await DB.putScript(s);
    }
    let missing = 0;
    for (const raw of songs) {
      const sg = normalizeSong(raw);
      if (sg.audio) {
        const f = zip && zip.file('audio/' + sg.audio.key);
        if (f) await DB.songAudioPut(sg.audio.key, new Blob([await f.async('arraybuffer')], { type: sg.audio.type || 'audio/mpeg' }));
        else if (!(await DB.songAudioGet(sg.audio.key))) { sg.audio = null; missing++; }
      }
      App.songs = App.songs.filter((x) => x.id !== sg.id);
      App.songs.push(sg);
      await DB.putSong(sg);
    }
    if (!Array.isArray(data) && data.sing) {
      const cur = App.sing;
      App.sing = Object.assign(SING_DEFAULT(), data.sing);
      if (!data.sing.range && cur.range) App.sing.range = cur.range;
      await DB.set('sing', App.sing);
    }
    DB.persist();
    Busy.hide();
    toast(missing ? `Copia restaurada. ${plural(missing, 'canción no trae', 'canciones no traen')} su audio: vuelve a subirlo.` : 'Copia restaurada', 4500);
    go('/');
  } catch (e) {
    Busy.hide();
    alertSheet('No se pudo restaurar', e.message || String(e));
  }
}

/* ============ AJUSTES DE LA OBRA ============ */
function viewScriptSettings(s) {
  mount(`
  ${scriptHeroHTML(s)}
  <main class="page">
    <h3 class="section-title">Tu personaje</h3>
    <p class="hint">Toca para elegir. Puedes elegir varios si doblas papeles.</p>
    ${charListHTML(s)}
    <div class="card mt-s" style="padding:4px 16px">
      ${switchHTML('groupLines', s.groupLines !== false, 'Contar frases de grupo como mías', 'Las de TODOS, AMBOS, CORO…')}
    </div>
    <button class="btn surface sm mt-s" data-act="addChar">${icon('plus', 'sm')} Añadir personaje</button>
    <h3 class="section-title">Voces del reparto</h3>
    <p class="hint">Cada personaje suena distinto y con voz de su sexo. Si alguno no es correcto, tócalo para cambiarlo.</p>
    ${castListHTML(s)}
    <h3 class="section-title">La obra</h3>
    <div class="list">
      ${rowHTML({ ic: 'image', title: 'Cambiar portada', sub: s.cover && s.cover.credit ? 'Imagen: ' + s.cover.credit : 'Cartel diseñado', attrs: 'data-act="coverPickCur"' })}
      ${rowHTML({ ic: 'edit', title: 'Título y autor', sub: s.title + (s.author ? ' · ' + s.author : ''), attrs: 'data-act="renameCur"' })}
      ${rowHTML({ ic: 'print', title: 'Imprimir o guardar PDF', sub: 'Con tus frases subrayadas', attrs: 'data-act="printCur"' })}
      ${rowHTML({ ic: 'file', title: 'Exportar como texto', sub: 'Archivo .txt con el guion limpio', attrs: 'data-act="exportTxt"' })}
      ${rowHTML({ ic: 'download', title: 'Copia de seguridad', sub: 'Obra + progreso, para pasarla a otro móvil', attrs: 'data-act="exportCur"' })}
    </div>
    <h3 class="section-title">Zona delicada</h3>
    <div class="list">
      ${rowHTML({ ic: 'reset', title: 'Reiniciar progreso', sub: 'Empieza a estudiar desde cero', attrs: 'data-act="resetProgress"' })}
      ${rowHTML({ ic: 'trash', title: 'Eliminar obra', attrs: 'data-act="deleteCur"', danger: true })}
    </div>
    <p class="small muted mt">Importada de: ${esc(s.source || '—')} · ${new Date(s.created).toLocaleDateString('es')}${s.work && s.work.url ? ` · <a href="${esc(s.work.url)}" target="_blank" rel="noopener">Ver en Wikipedia</a>` : ''}</p>
  </main>
  ${tabbarHTML(s, 'settings')}`);
}

/* ---------- voces del reparto ---------- */
const voiceDesc = (name) => { const v = GEMINI_VOICES.find((x) => x[0] === name); return v ? `${v[0]} (${v[1].toLowerCase()})` : name; };

function castListHTML(s) {
  const I = Model.ix(s);
  const lines = (c) => (I.counts[c.id] || { lines: 0 }).lines;
  const natural = Voices.enabled();
  const rows = s.characters.slice().sort((a, b) => lines(b) - lines(a)).map((c) => {
    const isMe = s.me.includes(c.id);
    const g = Voices.charGender(c) === 'f' ? 'Voz de mujer' : 'Voz de hombre';
    const sub = [g, natural ? voiceDesc(Voices.voiceFor(s, c.id, isMe ? 'me' : 'char')) : '', isMe ? 'tu personaje' : ''].filter(Boolean).join(' · ');
    return `<button class="row" data-act="castVoice" data-cid="${c.id}">${avatarHTML(c)}<span class="grow"><b>${esc(c.name)}</b><small>${esc(sub)}</small></span><span class="chev">${icon('right', 'sm')}</span></button>`;
  });
  if (natural) rows.push(`<button class="row" data-act="castVoice" data-cid="@narrator"><span class="ri">${icon('book')}</span><span class="grow"><b>Narrador</b><small>Lee las acotaciones · ${esc(voiceDesc(Voices.voiceFor(s, null, 'narrator')))}</small></span><span class="chev">${icon('right', 'sm')}</span></button>`);
  return `<div class="list">${rows.join('')}</div>`;
}

// Frase de ejemplo para escuchar una voz: la primera del propio personaje
function sampleLine(s, cid) {
  const b = s.blocks.find((x) => x.type === 'dialogue' && x.chars.includes(cid) && spokenText(x.text).length > 8);
  const t = b ? spokenText(b.text) : '';
  if (!t) return cid === '@narrator' ? 'Se abre el telón. La escena está en penumbra.' : 'Hola, así sonaré en el ensayo.';
  return t.length > 160 ? t.slice(0, 160).replace(/\s+\S*$/, '') + '…' : t;
}

ACT.castVoice = (el) => {
  const s = App.cur;
  const cid = el.dataset.cid;
  const narrator = cid === '@narrator';
  const c = narrator ? { id: cid, name: 'Narrador' } : Model.charOf(s, cid);
  if (!c) return;
  const role = narrator ? 'narrator' : s.me.includes(cid) ? 'me' : 'char';
  const preview = () => { Voices.unlock(); Voices.cancel(); Voices.say(s, { text: sampleLine(s, cid), charId: narrator ? null : cid, role }); };
  const html = () => {
    const g = narrator ? null : Voices.charGender(c);
    const cur = Voices.voiceFor(s, narrator ? null : cid, role);
    const voices = Voices.enabled() ? GEMINI_VOICES.filter((v) => !g || v[2] === g) : [];
    return `<div class="sheet-grip"></div><div class="sheet-body"><h3>${narrator ? 'Voz del narrador' : 'Voz de ' + esc(c.name)}</h3>
      ${g ? `<div class="field"><span>Este personaje es…</span>${segHTML('castGender', g, [['f', 'Mujer'], ['m', 'Hombre']])}</div>` : ''}
      <button class="btn primary block" id="cvPrev">${icon('volume')} Escuchar cómo suena</button>
      ${voices.length ? '<h4>Elige otra voz natural</h4>' : `<p class="small muted mt-s">Con las voces naturales de Gemini (Ajustes → Voces) podrás elegir entre ${GEMINI_VOICES.length} voces distintas.</p>`}</div>
      ${voices.length ? `<div class="list">${voices.map(([name, desc]) => `<button class="row flat" data-v="${name}"><span class="grow"><b>${name}</b><small>${desc}</small></span>${name === cur ? `<span class="chev" style="color:var(--brand)">${icon('check')}</span>` : ''}</button>`).join('')}</div>` : ''}`;
  };
  const sheet = Sheet.open('', { onClose: () => rerender() });
  const paint = () => {
    sheet.innerHTML = html();
    sheet.querySelector('#cvPrev').onclick = preview;
    sheet.querySelectorAll('[data-act="castGender"]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        c.gender = b.dataset.v;
        if (s.voices) delete s.voices[cid]; // la voz elegida podía ser del otro sexo
        structural(s);
        paint();
        preview();
      };
    });
    sheet.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = () => { s.voices = s.voices || {}; s.voices[cid] = b.dataset.v; saveScript(s); paint(); preview(); };
    });
  };
  paint();
};

CHANGE.groupLines = (el) => { const s = App.cur; if (!s) return; s.groupLines = el.checked; structural(s); rerender(); };
ACT.addChar = async () => {
  const s = App.cur;
  const n = await promptSheet({ title: 'Nuevo personaje', placeholder: 'Nombre' });
  if (n && n.trim()) { Model.addChar(s, n); structural(s); rerender(); }
};
ACT.renameCur = async () => { await editTitleAuthor(App.cur); rerender(); };
ACT.exportCur = () => exportScriptJSON(App.cur);
ACT.exportTxt = () => download(`${safeFileName(App.cur.title)}.txt`, Model.toText(App.cur), 'text/plain;charset=utf-8');
ACT.deleteCur = async () => { if (await deleteScript(App.cur)) go('/', true); };
ACT.resetProgress = async () => {
  const ok = await confirmSheet({ title: '¿Reiniciar el progreso?', text: 'Se borrará lo aprendido y el tiempo de estudio de esta obra. El texto y tus notas se mantienen.', ok: 'Reiniciar', danger: true });
  if (!ok) return;
  App.cur.prog = {};
  App.cur.log = { days: {}, secs: 0, sessions: 0 };
  saveScript(App.cur, true);
  toast('Progreso reiniciado');
};
ACT.printCur = () => {
  const s = App.cur;
  let el = $('#print');
  if (!el) { el = document.createElement('div'); el.id = 'print'; document.body.appendChild(el); }
  el.innerHTML = `<h1>${esc(s.title)}</h1><p class="print-sub">${esc([s.author, Model.charName(s, s.me)].filter(Boolean).join(' · '))}</p>
    <div class="${scriptClasses(s, true)}">${s.blocks.map((b, i) => blockHTML(s, b, i, { mineView: 'full' })).join('')}</div>`;
  setTimeout(() => window.print(), 50);
};

/* ============ ARRANQUE ============ */
/*
 * Actualizaciones: la versión nueva se descarga sola en segundo plano. Antes de cambiar a ella se guarda todo lo pendiente
 * y se avisa; los datos (IndexedDB) no se tocan nunca al actualizar.
 */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const ask = (w) => {
      if (!w || !navigator.serviceWorker.controller) return;
      toastAction('Hay una versión nueva de Apuntador', 'Actualizar', () => { flushAll(); flushSongs(); w.postMessage('skipWaiting'); });
    };
    if (reg.waiting) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') ask(w); });
    });
    // comprobar si hay versión nueva al volver a la app
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('SW', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    flushAll();
    flushSongs();
    setTimeout(() => location.reload(), 250);
  });
}

// Aviso con botón (para la actualización)
function toastAction(msg, label, fn) {
  let el = $('#toastAct');
  if (!el) { el = document.createElement('div'); el.id = 'toastAct'; document.body.appendChild(el); }
  el.innerHTML = `<span class="grow">${esc(msg)}</span><button class="btn sm gold">${esc(label)}</button><button class="icon-btn" aria-label="Más tarde">${icon('close', 'sm')}</button>`;
  el.classList.add('show');
  const [ok, no] = el.querySelectorAll('button');
  ok.onclick = () => { el.classList.remove('show'); fn(); };
  no.onclick = () => el.classList.remove('show');
}

async function boot() {
  const saved = await DB.get('settings', {});
  App.settings = Object.assign({}, DEFAULTS, saved || {});
  App.settings.rehearsal = Object.assign({}, DEFAULTS.rehearsal, (saved && saved.rehearsal) || {});
  applySettings();
  try { App.scripts = (await DB.allScripts()).map(Model.normalize); } catch (e) { console.error(e); App.scripts = []; }
  try { App.songs = (await DB.allSongs()).map(normalizeSong); } catch (e) { console.error(e); App.songs = []; }
  App.sing = Object.assign(SING_DEFAULT(), (await DB.get('sing', null)) || {});
  // pedir al navegador que no borre nuestros datos aunque le falte espacio
  if (App.scripts.length || App.songs.length) DB.persist();
  await Spotify.load();
  const spBack = await Spotify.handleRedirect();
  setupFileInputs();
  window.addEventListener('hashchange', route);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings); } catch (e) { /* navegador antiguo */ }
  // la ventana del inicio de sesión de Spotify puede ser otra: al volver, releer el permiso
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const was = Spotify.connected();
    Spotify.reload().then(() => { if (Spotify.connected() !== was && currentView() === 'settings') rerender(); });
  });
  route();
  if (spBack) { if (spBack.ok) toast('¡Spotify conectado!', 3000); else alertSheet('Spotify', spBack.msg); }
  TTS.init().then(() => { if (currentView() === 'settings') rerender(); });
  registerSW();
  window.addEventListener('online', backfillCovers);
  setTimeout(backfillCovers, 1500);
}

document.addEventListener('DOMContentLoaded', boot);
