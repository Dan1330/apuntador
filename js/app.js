'use strict';
/* Apuntador · núcleo: estado, navegación, cartelera, importación, portadas y ajustes */

const VERSION = '2.0.0';
const App = {
  settings: null, scripts: [], cur: null, pending: null, installEvt: null,
  cleanup: null, onSettings: null, keepScroll: false, firstOpen: null, retry: null,
  coverBusy: new Set(), scan: [],
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
  if (!parts.length) return viewLibrary();
  if (parts[0] === 'shared') { viewLibrary(); checkShared(); return; }
  if (parts[0] === 'settings') return viewSettings();
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
    ${list.length ? libraryHTML(list) : emptyLibraryHTML()}
  </main>
  ${list.length ? `<button class="fab" data-act="importMenu">${icon('plus')} Nueva obra</button>` : ''}`);
}

function installBannerHTML() {
  if (isStandalone() || S().installHidden || !(App.installEvt || isIOS())) return '';
  return `<div class="banner">${icon('phone')}<span class="grow"><b>Instálala en tu móvil</b><br><span class="small muted">${App.installEvt ? 'Tendrás su icono y funcionará sin conexión.' : 'En Safari: Compartir → «Añadir a pantalla de inicio».'}</span></span>
    ${App.installEvt ? '<button class="btn sm primary" data-act="install">Instalar</button>' : ''}<button class="icon-btn" data-act="hideInstall" aria-label="Ocultar">${icon('close', 'sm')}</button></div>`;
}

function libraryHTML(list) {
  return `<div class="lib-hello"><span class="eyebrow">${greeting()}</span><h1 class="display">Tu cartelera</h1></div>
    ${featureHTML(list[0])}
    <div class="sec-head"><h2>Todas tus obras</h2><span class="muted">${list.length}</span></div>
    <div class="poster-grid">${list.map(posterTileHTML).join('')}
      <button class="poster-add" data-act="importMenu">${icon('plus')}<span>Nueva obra</span></button></div>
    <p class="center muted small mt-l">Tus obras se guardan solo en este dispositivo.</p>`;
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
ACT.install = async () => {
  const e = App.installEvt;
  if (!e) return;
  e.prompt();
  try { await e.userChoice; } catch (err) { /* nada */ }
  App.installEvt = null;
  rerender();
};
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  App.installEvt = e;
  if (['library', 'settings'].includes(currentView())) rerender();
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
  // arrastrar y soltar (ordenador y tabletas con teclado)
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });
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
function viewSettings() {
  const st = S();
  const voices = TTS.voicesFor(st.lang);
  let install = '';
  if (App.installEvt) install = `<div class="banner">${icon('phone')}<span class="grow"><b>Instalar Apuntador</b><br><span class="small muted">Tendrás su icono y funcionará sin conexión.</span></span><button class="btn sm primary" data-act="install">Instalar</button></div>`;
  else if (!isStandalone()) install = `<div class="banner">${icon('phone')}<span class="grow"><b>Instalar en el móvil</b><br><span class="small muted">${isIOS()
    ? 'En Safari: botón Compartir → «Añadir a pantalla de inicio».' : 'En Chrome: menú ⋮ → «Instalar aplicación».'}</span></span></div>`;
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
    <h3 class="section-title">Voz y ensayo</h3>
    <div class="card">
      <label class="field"><span>Idioma de los guiones</span><select data-change="lang">${LANGS.map(([v, l]) => `<option value="${v}" ${v === st.lang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Voz principal</span><select data-change="voice"><option value="">Automática</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}" ${st.voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select></label>
      <div class="field"><span>Velocidad de lectura</span><div class="range-row"><input type="range" min="0.6" max="1.6" step="0.05" value="${st.rate}" data-input="rate" aria-label="Velocidad"><output id="rateOut">${Number(st.rate).toFixed(2)}×</output></div></div>
      <button class="btn surface block" data-act="testVoice">${icon('volume')} Probar voz</button>
      <p class="small muted mt-s">${TTS.supported ? (voices.length ? `${plural(voices.length, 'voz disponible', 'voces disponibles')} en este idioma.` : 'No hay voces de este idioma instaladas; se usará la del sistema.') : 'Este navegador no puede leer en voz alta.'}
        ${SR.supported ? 'Reconocimiento de voz disponible.' : 'Este navegador no reconoce la voz (usa Chrome en Android o Safari en iPhone).'}</p>
    </div>
    <h3 class="section-title">Portadas y escaneo</h3>
    <div class="card">
      ${switchHTML('autoCovers', st.autoCovers, 'Buscar portadas en internet', 'Reconoce la obra y busca su imagen en Wikipedia. Solo se envían el título y el autor, nunca el guion.')}
      <label class="field" style="margin:10px 0 0"><span>Idioma del texto escaneado</span><select data-change="ocrLang">${OCR_LANGS.map(([v, l]) => `<option value="${v}" ${v === st.ocrLang ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <h3 class="section-title">Tus datos</h3>
    <div class="list">
      ${rowHTML({ ic: 'download', title: 'Hacer copia de seguridad', sub: 'Descarga todas tus obras y tu progreso', attrs: 'data-act="backupAll"' })}
      ${rowHTML({ ic: 'upload', title: 'Restaurar una copia', sub: 'Carga un archivo .apuntador.json', attrs: 'data-act="restoreAll"' })}
    </div>
    <p class="small muted mt-s">Tus guiones se guardan solo en este dispositivo. Haz copias de seguridad de vez en cuando.</p>
    <p class="center small muted mt-l">Apuntador ${VERSION} · Ilustraciones creadas con Figma AI</p>
  </main>
  <input type="file" id="restoreIn" accept=".json,application/json" hidden>`);
  $('#restoreIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restoreBackup(f); });
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

ACT.testVoice = async () => {
  TTS.unlock();
  await TTS.init();
  TTS.cancel();
  TTS.speak('Hola. Soy tu apuntador. Cuando quieras, empezamos el ensayo.', voiceProfile(null, null, 'narrator'));
};

ACT.backupAll = () => {
  if (!App.scripts.length) { toast('Todavía no tienes obras'); return; }
  const data = JSON.stringify({ app: 'apuntador', version: 2, date: new Date().toISOString(), scripts: App.scripts }, (k, v) => (k.startsWith('_') ? undefined : v));
  download(`apuntador-copia-${todayKey()}.apuntador.json`, data);
};
ACT.restoreAll = () => $('#restoreIn').click();

async function restoreBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.scripts;
    if (!Array.isArray(list) || !list.length || !list.every((x) => x && x.id && Array.isArray(x.blocks))) throw new Error('El archivo no es una copia de Apuntador.');
    const ok = await confirmSheet({ title: 'Restaurar copia', text: `Se cargarán ${plural(list.length, 'obra', 'obras')}. Las que ya tengas iguales se sustituirán.`, ok: 'Restaurar' });
    if (!ok) return;
    for (const raw of list) {
      const s = Model.normalize(raw);
      App.scripts = App.scripts.filter((x) => x.id !== s.id);
      App.scripts.push(s);
      await DB.putScript(s);
    }
    toast('Copia restaurada');
    go('/');
  } catch (e) {
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
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}

async function boot() {
  const saved = await DB.get('settings', {});
  App.settings = Object.assign({}, DEFAULTS, saved || {});
  App.settings.rehearsal = Object.assign({}, DEFAULTS.rehearsal, (saved && saved.rehearsal) || {});
  applySettings();
  try { App.scripts = (await DB.allScripts()).map(Model.normalize); } catch (e) { console.error(e); App.scripts = []; }
  setupFileInputs();
  window.addEventListener('hashchange', route);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings); } catch (e) { /* navegador antiguo */ }
  route();
  TTS.init().then(() => { if (currentView() === 'settings') rerender(); });
  registerSW();
  window.addEventListener('online', backfillCovers);
  setTimeout(backfillCovers, 1500);
}

document.addEventListener('DOMContentLoaded', boot);
