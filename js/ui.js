'use strict';
/* Componentes de interfaz: iconos, filas, hojas inferiores, diálogos e indicador de carga */

const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  book: '<path d="M2 4h6a4 4 0 014 4v13a3 3 0 00-3-3H2zM22 4h-6a4 4 0 00-4 4v13a3 3 0 013-3h7z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0014 0v-1M12 18v4M8 22h8"/>',
  cards: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 012 2v12"/>',
  letters: '<path d="M3 17l4-11 4 11M4.5 13h5M14 17h3M19 17h2M14 13h7"/>',
  keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M8 16.5h8"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1v-6h3zM3 19a2 2 0 002 2h1v-6H3z"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
  play: '<path class="fill" d="M8 5.1v13.8a1 1 0 001.5.86l11-6.9a1 1 0 000-1.72l-11-6.9A1 1 0 008 5.1z"/>',
  pause: '<rect class="fill" x="6" y="4" width="4" height="16" rx="1"/><rect class="fill" x="14" y="4" width="4" height="16" rx="1"/>',
  next: '<path d="M5 5l10 7-10 7zM19 5v14"/>',
  prev: '<path d="M19 19L9 12l10-7zM5 5v14"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0112 5c6.5 0 10 7 10 7a17.6 17.6 0 01-3.2 4.2M6.6 6.6A17.3 17.3 0 002 12s3.5 7 10 7a10 10 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  note: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  camera: '<path d="M3 8a2 2 0 012-2h2l2-2h6l2 2h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><circle cx="12" cy="13" r="4"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  more: '<circle class="fill" cx="12" cy="5" r="1.7"/><circle class="fill" cx="12" cy="12" r="1.7"/><circle class="fill" cx="12" cy="19" r="1.7"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  merge: '<path d="M12 20V8M6 14l6-6 6 6M5 4h14"/>',
  swap: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  print: '<path d="M6 9V3h12v6M6 17H4a1 1 0 01-1-1v-5a2 2 0 012-2h14a2 2 0 012 2v5a1 1 0 01-1 1h-2M7 14h10v7H7z"/>',
  reset: '<path d="M3 12a9 9 0 0115.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 01-15.5 6.3L3 16M3 21v-5h5"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9a3.5 3.5 0 010 6M19 6a8 8 0 010 12"/>',
  flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-5 5-5 8-1-1-2-2-2-4-2 2-2 5-2 8 0 4 3 7 7 7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 013 0V11M11 10.5V4a1.5 1.5 0 013 0v7M14 10.5V5.5a1.5 1.5 0 013 0V12M17 9.5a1.5 1.5 0 013 0V15a7 7 0 01-7 7h-1a7 7 0 01-5.6-2.8L3.6 15a1.6 1.6 0 012.5-2L8 15"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2v4a5 5 0 0010 0V2M7 22v-4a5 5 0 0110 0v4"/>',
  file: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle class="fill" cx="8" cy="10" r="1.3"/><circle class="fill" cx="12" cy="7.5" r="1.3"/><circle class="fill" cx="16" cy="10" r="1.3"/><path d="M12 21a2 2 0 010-4h2a3 3 0 003-3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.8"/><path d="M21 15l-5-5L5 21"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/>',
  words: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
};
function icon(name, cls = '') { return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }

const LOGO_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#8e1b2c"/><rect x="17" y="11" width="30" height="42" rx="3.5" fill="#fffaf0"/><rect x="21.5" y="17" width="12" height="3.4" rx="1.7" fill="#2b2320"/><rect x="21.5" y="24.5" width="21" height="2.6" rx="1.3" fill="#b9ab98"/><rect x="19.5" y="30.2" width="25" height="7" rx="2.6" fill="#ffd43b"/><rect x="21.5" y="32.4" width="20" height="2.6" rx="1.3" fill="#2b2320"/><rect x="21.5" y="41" width="21" height="2.6" rx="1.3" fill="#b9ab98"/><rect x="21.5" y="46.3" width="14" height="2.6" rx="1.3" fill="#b9ab98"/></svg>`;

/**
 * Fila de lista con icono en «píldora».
 * attrs: atributos extra en bruto (data-act, data-id…). Los textos se escapan aquí.
 */
function rowHTML({ ic, title, sub = '', attrs = '', danger = false, tag = 'button', end = '' }) {
  return `<${tag} class="row ${danger ? 'danger' : ''}" ${attrs}>${ic ? `<span class="ri">${icon(ic)}</span>` : ''}
    <span class="grow"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${end}</${tag}>`;
}

function avatarHTML(c) {
  const initials = String(c.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<span class="avatar" style="--c:${c.color}" aria-hidden="true">${esc(initials)}</span>`;
}

/* ---------- Hoja inferior (bottom sheet) ---------- */
const Sheet = {
  el: null, pushed: false, onClose: null,

  open(html, { onClose } = {}) {
    if (this.el) this._remove(true);
    const w = document.createElement('div');
    w.className = 'sheet-wrap';
    w.innerHTML = `<div class="sheet-bg" data-act="sheetClose"></div><div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>${html}</div>`;
    document.body.appendChild(w);
    this.el = w;
    this.onClose = onClose || null;
    requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('open')));
    // el botón «atrás» de Android cierra la hoja en vez de cambiar de pantalla
    if (!this.pushed) { try { history.pushState({ sheet: true }, ''); this.pushed = true; } catch (e) { /* nada */ } }
    document.body.classList.add('noscroll');
    return w.querySelector('.sheet');
  },

  _remove(replacing) {
    const w = this.el;
    if (!w) return;
    this.el = null;
    w.classList.remove('open');
    setTimeout(() => w.remove(), 260);
    if (!replacing) document.body.classList.remove('noscroll');
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
  },

  close() {
    return new Promise((res) => {
      if (!this.el && !this.pushed) return res();
      this._remove();
      if (!this.pushed) return res();
      this.pushed = false;
      let done = false;
      const fin = () => { if (done) return; done = true; window.removeEventListener('popstate', fin); res(); };
      window.addEventListener('popstate', fin);
      history.back();
      setTimeout(fin, 350);
    });
  },
};
window.addEventListener('popstate', () => {
  if (Sheet.pushed) { Sheet.pushed = false; Sheet._remove(); }
});

/* ---------- Diálogos ---------- */
// Pequeña ayuda: abre una hoja y resuelve con el valor elegido (o con `fallback` si se cierra)
function sheetPromise(html, bind, fallback = null) {
  return new Promise((res) => {
    let done = false;
    const finish = async (v) => { if (done) return; done = true; await Sheet.close(); res(v); };
    const el = Sheet.open(html, { onClose: () => { if (!done) { done = true; res(fallback); } } });
    bind(el, finish);
  });
}

function confirmSheet({ title, text = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false }) {
  return sheetPromise(`<div class="sheet-body"><h3>${esc(title)}</h3>${text ? `<p class="muted">${text}</p>` : ''}
    <div class="sheet-actions"><button class="btn soft" data-r="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`,
  (el, finish) => el.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => finish(b.dataset.r === '1'); }), false);
}

function alertSheet(title, text) {
  return sheetPromise(`<div class="sheet-body"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="sheet-actions"><button class="btn primary" data-r>Entendido</button></div></div>`,
    (el, finish) => { el.querySelector('[data-r]').onclick = () => finish(true); }, true);
}

function promptSheet({ title, value = '', placeholder = '', ok = 'Guardar', multiline = false, hint = '' }) {
  const field = multiline
    ? `<textarea class="input" id="pIn" rows="7" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input class="input" id="pIn" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`;
  return sheetPromise(`<div class="sheet-body"><h3>${esc(title)}</h3>${hint ? `<p class="muted small" style="margin-bottom:12px">${hint}</p>` : ''}${field}
    <div class="sheet-actions"><button class="btn soft" data-r="0">Cancelar</button><button class="btn primary" data-r="1">${esc(ok)}</button></div></div>`,
  (el, finish) => {
    const inp = el.querySelector('#pIn');
    setTimeout(() => { inp.focus(); if (!multiline) inp.select(); }, 260);
    el.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => finish(b.dataset.r === '1' ? inp.value : null); });
    if (!multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(inp.value); });
  });
}

// Lista de opciones: devuelve el `value` elegido o null
function chooseSheet({ title, sub = '', options }) {
  const rows = options.map((o, i) => {
    const lead = o.dot ? `<span class="avatar" style="--c:${o.dot};width:38px;height:38px"></span>` : o.icon ? `<span class="ri">${icon(o.icon)}</span>` : '';
    return `<button class="row ${o.danger ? 'danger' : ''}" data-i="${i}">${lead}<span class="grow"><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</span>${o.on ? `<span class="chev" style="color:var(--brand)">${icon('check')}</span>` : ''}</button>`;
  }).join('');
  return sheetPromise(`<div class="sheet-body" style="padding-bottom:2px"><h3>${esc(title)}</h3>${sub ? `<p class="sheet-sub">${sub}</p>` : ''}</div><div class="list">${rows}</div>`,
    (el, finish) => el.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => finish(options[Number(b.dataset.i)].value); }));
}

/* ---------- Indicador de carga ---------- */
const Busy = {
  show(msg) {
    let el = $('#busy');
    if (!el) {
      el = document.createElement('div');
      el.id = 'busy';
      el.innerHTML = '<div class="busy-box"><div class="spinner"></div><p class="busy-msg"></p><div class="busy-bar" hidden><i></i></div></div>';
      document.body.appendChild(el);
    }
    el.querySelector('.busy-msg').textContent = msg || 'Un momento…';
    el.querySelector('.busy-bar').hidden = true;
    el.classList.add('show');
  },
  progress(p, msg) {
    const el = $('#busy');
    if (!el) return;
    if (msg) el.querySelector('.busy-msg').textContent = msg;
    const bar = el.querySelector('.busy-bar');
    if (p == null) bar.hidden = true;
    else { bar.hidden = false; bar.firstElementChild.style.width = Math.round(clamp(p, 0, 1) * 100) + '%'; }
  },
  hide() { const el = $('#busy'); if (el) el.classList.remove('show'); },
};

function switchHTML(change, checked, label, sub = '', extra = '') {
  return `<label class="switch-row"><span class="grow"><b style="font-weight:700">${esc(label)}</b>${sub ? `<small>${sub}</small>` : ''}</span>
    <span class="switch"><input type="checkbox" data-change="${change}" ${extra} ${checked ? 'checked' : ''}><span class="sl"></span></span></label>`;
}

function segHTML(act, value, options, extra = '') {
  return `<div class="seg">${options.map(([v, l]) => `<button data-act="${act}" data-v="${esc(v)}" ${extra} class="${String(v) === String(value) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
}
