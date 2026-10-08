'use strict';
/* Utilidades generales */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const deaccent = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

const _scripts = {};
function loadScript(src) {
  if (!_scripts[src]) {
    _scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res();
      s.onerror = () => { delete _scripts[src]; rej(new Error('No se pudo cargar ' + src + '. ¿Tienes conexión?')); };
      document.head.appendChild(s);
    });
  }
  return _scripts[src];
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function relDay(ts) {
  if (!ts) return 'nunca';
  const d = new Date(ts); const t = new Date();
  const days = Math.round((new Date(t.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function fmtMinutes(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/* ---------- Texto hablado / acotaciones dentro de una frase ---------- */

// Divide un texto en trozos hablados y acotaciones entre paréntesis o corchetes.
function segments(text) {
  const out = [];
  const re = /\([^()]*\)|\[[^\[\]]*\]/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ dir: false, s: text.slice(last, m.index) });
    out.push({ dir: true, s: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ dir: false, s: text.slice(last) });
  return out;
}

function spokenText(text) {
  return segments(text).filter((x) => !x.dir).map((x) => x.s).join(' ').replace(/\s+/g, ' ').trim();
}

const WORD_SRC = "[\\p{L}\\p{N}][\\p{L}\\p{N}'’\\-]*";

const NUMS = {
  cero: '0', uno: '1', un: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8',
  nueve: '9', diez: '10', once: '11', doce: '12', trece: '13', catorce: '14', quince: '15', dieciseis: '16',
  diecisiete: '17', dieciocho: '18', diecinueve: '19', veinte: '20', treinta: '30', cuarenta: '40', cincuenta: '50',
  sesenta: '60', setenta: '70', ochenta: '80', noventa: '90', cien: '100', ciento: '100', mil: '1000',
  veintiuno: '21', veintiun: '21', veintiuna: '21', veintidos: '22', veintitres: '23', veinticuatro: '24', veinticinco: '25',
  veintiseis: '26', veintisiete: '27', veintiocho: '28', veintinueve: '29', doscientos: '200', quinientos: '500',
  primero: '1o', primer: '1o', primera: '1a', segundo: '2o', segunda: '2a', tercero: '3o', tercer: '3o', tercera: '3a',
};

function normWord(w) {
  const n = deaccent(w.toLowerCase()).replace(/[^a-z0-9]/g, '');
  return NUMS[n] || n;
}

function wordsOf(text) {
  return (spokenText(text).match(new RegExp(WORD_SRC, 'gu')) || []).map(normWord).filter(Boolean);
}

function countWords(text) { return wordsOf(text).length; }

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Clave «de cómo suena» en español: el reconocedor confunde palabras que suenan igual (ha/a, vaya/valla, hay/ahí, echo/hecho)
const _phon = new Map();
function phon(w) {
  let k = _phon.get(w);
  if (k === undefined) {
    k = w.replace(/ch/g, '#').replace(/h/g, '').replace(/#/g, 'ch').replace(/v/g, 'b').replace(/ll/g, 'y')
      .replace(/c([ei])/g, 's$1').replace(/z/g, 's').replace(/qu/g, 'k').replace(/c(?!h)/g, 'k').replace(/g([ei])/g, 'j$1')
      .replace(/gu([ei])/g, 'g$1').replace(/x/g, 'ks').replace(/y$/, 'i').replace(/([^r])\1+/g, '$1'); // «rr» se conserva: perro ≠ pero
    if (_phon.size > 5000) _phon.clear();
    _phon.set(w, k);
  }
  return k;
}

function wordEq(a, b) {
  if (a === b) return true;
  const pa = phon(a), pb = phon(b);
  if (pa === pb) return true;
  const L = Math.max(pa.length, pb.length);
  if (L < 4) return false;
  return lev(pa, pb) <= Math.floor(L / 4);
}

// Alinea palabras objetivo con palabras dichas/escritas (LCS tolerante).
function alignWords(target, said) {
  const n = target.length, m = said.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = wordEq(target[i], said[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matched = new Set(); const extra = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (wordEq(target[i], said[j])) { matched.add(i); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { extra.push(j); j++; }
  }
  while (j < m) extra.push(j++);
  return { matched, extra, score: n ? matched.size / n : 1 };
}

// pseudo-aleatorio estable por palabra (para ocultar palabras de forma progresiva)
function wordHash(idx, seed) {
  let h = Math.imul((idx + 1) ^ 0x9e3779b9, 2654435761) ^ Math.imul(seed + 7, 40503);
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Pinta una frase envolviendo cada palabra en <span class="w">.
 * level: 0 completa · 1 algunas ocultas · 2 la mitad · 3 solo iniciales · 4 todo oculto
 * revealed: Set de índices de palabra ya destapadas
 */
const HIDE_RATIO = [0, 0.3, 0.6, 1, 1];
function renderSpeech(text, { level = 0, revealed = null, seed = 1, marked = null } = {}) {
  let wi = 0;
  let html = '';
  const ratio = HIDE_RATIO[level] || 0;
  for (const seg of segments(text)) {
    if (seg.dir) { html += `<i class="dir">${esc(seg.s)}</i>`; continue; }
    const s = seg.s;
    const re = new RegExp(WORD_SRC, 'gu');
    let last = 0, m;
    while ((m = re.exec(s))) {
      html += esc(s.slice(last, m.index));
      const w = m[0];
      const idx = wi++;
      const hidden = level > 0 && (ratio >= 1 || wordHash(idx, seed) < ratio) && !(revealed && revealed.has(idx));
      let cls = 'w';
      if (marked) cls += marked.has(idx) ? ' ok' : ' miss';
      if (hidden && level < 4) {
        html += `<span class="${cls} ini" data-wi="${idx}">${esc(w[0])}<span class="r">${esc(w.slice(1))}</span></span>`;
      } else if (hidden) {
        html += `<span class="${cls} hid" data-wi="${idx}"><span class="r">${esc(w)}</span></span>`;
      } else {
        html += `<span class="${cls}" data-wi="${idx}">${esc(w)}</span>`;
      }
      last = m.index + w.length;
    }
    html += esc(s.slice(last));
  }
  return html;
}

/* ---------- Toasts ---------- */
function toast(msg, ms = 2600) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- Wake lock (pantalla encendida mientras ensayas) ---------- */
const Wake = {
  lock: null, want: false,
  async on() {
    this.want = true;
    try { if ('wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } } catch (e) { /* sin soporte */ }
  },
  off() { this.want = false; try { this.lock && this.lock.release(); } catch (e) {} this.lock = null; },
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Wake.want) Wake.on(); });

function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

function safeFileName(s) { return String(s || 'guion').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'guion'; }
