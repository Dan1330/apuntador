'use strict';
/*
 * Voces naturales con Gemini (texto a voz de Google).
 * - Cada frase se genera una vez y se guarda en el móvil: la siguiente vez suena al instante y sin conexión.
 * - Cada personaje tiene su voz; las acotaciones entre paréntesis («riendo», «enfadado») guían la interpretación.
 * - Si no hay clave, conexión o se acaba el cupo gratuito, se usa la voz del móvil sin cortar el ensayo.
 */

// [nombre, carácter, f/m]
const GEMINI_VOICES = [
  ['Kore', 'Firme', 'f'], ['Leda', 'Juvenil', 'f'], ['Aoede', 'Ligera', 'f'], ['Despina', 'Suave', 'f'], ['Sulafat', 'Cálida', 'f'],
  ['Gacrux', 'Madura', 'f'], ['Erinome', 'Clara', 'f'], ['Callirrhoe', 'Tranquila', 'f'], ['Vindemiatrix', 'Amable', 'f'],
  ['Zephyr', 'Brillante', 'f'], ['Autonoe', 'Luminosa', 'f'], ['Laomedeia', 'Animada', 'f'], ['Pulcherrima', 'Directa', 'f'], ['Achernar', 'Dulce', 'f'],
  ['Charon', 'Informativa', 'm'], ['Puck', 'Animada', 'm'], ['Orus', 'Firme', 'm'], ['Algieba', 'Suave', 'm'], ['Fenrir', 'Enérgica', 'm'],
  ['Iapetus', 'Clara', 'm'], ['Rasalgethi', 'Explicativa', 'm'], ['Achird', 'Amable', 'm'], ['Schedar', 'Serena', 'm'], ['Umbriel', 'Tranquila', 'm'],
  ['Algenib', 'Ronca', 'm'], ['Alnilam', 'Rotunda', 'm'], ['Sadachbia', 'Viva', 'm'], ['Sadaltager', 'Sabia', 'm'], ['Zubenelgenubi', 'Informal', 'm'],
  ['Enceladus', 'Susurrante', 'm'],
];

const GEMINI_MODELS = [['gemini-3.8-flash-tts', 'Mejor calidad'], ['gemini-3.8-flash-lite-tts', 'Más rápida']];

/* ---------- reproductor (un único <audio>, desbloqueado con un toque: requisito de iPhone) ---------- */
const Player = {
  el: null, _done: null,
  ensure() { if (!this.el) { this.el = new Audio(); this.el.preload = 'auto'; } return this.el; },
  unlock() {
    const el = this.ensure();
    if (this._unlocked) return;
    this._unlocked = true;
    try { el.src = URL.createObjectURL(pcmToWav(new Uint8Array(4800), 24000)); const p = el.play(); if (p) p.catch(() => {}); } catch (e) { /* nada */ }
  },
  play(blob) {
    const el = this.ensure();
    this.stop();
    return new Promise((res) => {
      const url = URL.createObjectURL(blob);
      let wd = null;
      const done = () => {
        if (this._done !== done) return;
        this._done = null;
        clearTimeout(wd);
        el.onended = el.onerror = null;
        URL.revokeObjectURL(url);
        res();
      };
      this._done = done;
      el.onended = done;
      el.onerror = done;
      el.src = url;
      // tope de seguridad por si el navegador no avisa del final (WAV de 24 kHz, 16 bits = 48 000 bytes/s)
      wd = setTimeout(done, (blob.size / 48000) * 1000 + 4000);
      const p = el.play();
      if (p) p.catch(done);
    });
  },
  stop() {
    if (this.el) { try { this.el.pause(); } catch (e) { /* nada */ } }
    if (this._done) this._done();
  },
};

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return out;
}

// PCM 16 bits little-endian → WAV
function pcmToWav(bytes, rate = 24000, channels = 1) {
  const h = new DataView(new ArrayBuffer(44));
  const tag = (o, s) => { for (let k = 0; k < 4; k++) h.setUint8(o + k, s.charCodeAt(k)); };
  tag(0, 'RIFF'); h.setUint32(4, 36 + bytes.length, true); tag(8, 'WAVE');
  tag(12, 'fmt '); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, channels, true);
  h.setUint32(24, rate, true); h.setUint32(28, rate * channels * 2, true); h.setUint16(32, channels * 2, true); h.setUint16(34, 16, true);
  tag(36, 'data'); h.setUint32(40, bytes.length, true);
  return new Blob([h.buffer, bytes], { type: 'audio/wav' });
}

const Voices = (() => {
  const API = 'https://generativelanguage.googleapis.com/v1beta';
  const LEGACY_MODEL = 'gemini-2.5-flash-preview-tts';
  const ACCENT = { 'es-ES': 'español de España', 'es-MX': 'español de México', 'es-AR': 'español de Argentina', 'es-US': 'español latino',
    'ca-ES': 'catalán', 'gl-ES': 'gallego', 'eu-ES': 'euskera', 'en-US': 'inglés americano', 'en-GB': 'inglés británico',
    'pt-PT': 'portugués de Portugal', 'pt-BR': 'portugués de Brasil', 'fr-FR': 'francés', 'it-IT': 'italiano', 'de-DE': 'alemán' };

  let legacy = false;      // si la API nueva no responde, se usa la anterior
  let blocked = null;      // { reason, until } tras un error de clave o de cupo
  let lastWarn = 0;
  const mem = new Map();   // caché en memoria de la sesión
  const inflight = new Map();
  let queue = Promise.resolve();
  let queueGen = 0;

  const enabled = () => S().voiceEngine === 'gemini' && !!(S().geminiKey || '').trim();
  const canGenerate = () => enabled() && navigator.onLine !== false && !(blocked && Date.now() < blocked.until);

  function strHash(s) {
    let h = 2166136261;
    for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  }

  /* ---------- reparto de voces ---------- */
  const FEM_TITLE = /^(DONA|SENORA|SRA|MADRE|REINA|PRINCESA|DUQUESA|CONDESA|MARQUESA|ABUELA|TIA|HERMANA|NINA|CHICA|MUJER|CRIADA|SOR|LADY|MRS|MS|MISS|MADAME|LA)$/;
  const MASC_TITLE = /^(DON|SENOR|SR|PADRE|REY|PRINCIPE|DUQUE|CONDE|MARQUES|ABUELO|TIO|HERMANO|NINO|CHICO|HOMBRE|CRIADO|FRAY|LORD|MR|SIR|EL)$/;
  const FEM_NAMES = /^(CARMEN|ISABEL|RAQUEL|PILAR|ROCIO|CONSUELO|INES|BEATRIZ|RUTH|ESTHER|MERCEDES|DOLORES|LOURDES|NIEVES|SOLEDAD|MARIBEL|MABEL|NOEMI|BELEN|ARACELI|MAITE|CHELO|LUZ|PAZ|SOL|ROSARIO|AMPARO|REMEDIOS|ASUNCION|CONCEPCION|ENCARNACION|ALICE|ROSE|KATE|JANE)$/;
  const MASC_A = /^(POETA|GUARDIA|CURA|PAPA|ATLETA|NOE|BAUTISTA|BORJA|LUCA|ANDREA|NICOLA|JOSHUA|ELIAS|MATIAS|TOMAS|JONAS)$/;

  function gender(name) {
    const words = deaccent(String(name)).toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return 'm';
    if (FEM_TITLE.test(words[0])) return 'f';
    if (MASC_TITLE.test(words[0])) return 'm';
    const w = words[0];
    if (FEM_NAMES.test(w)) return 'f';
    if (/A$/.test(w) && !MASC_A.test(w)) return 'f';
    return 'm';
  }

  // Sexo de la voz de un personaje: el que elijas en «Voces del reparto» o el que se deduce del nombre
  const charGender = (c) => (c ? c.gender || (c.group ? 'm' : gender(c.name)) : 'f');

  // Orden de reparto: los personajes con más frases eligen voz primero, y cada uno recibe una distinta
  function castOrder(s) {
    if (s._cast && s._castV === s._v) return s._cast;
    const I = Model.ix(s);
    const lines = (c) => (I.counts[c.id] || { lines: 0 }).lines;
    const count = { f: 0, m: 0 };
    const cast = new Map();
    for (const c of s.characters.slice().sort((a, b) => lines(b) - lines(a))) {
      const g = charGender(c);
      cast.set(c.id, { g, k: count[g]++ });
    }
    s._cast = cast;
    s._castV = s._v;
    return cast;
  }

  const POOL = { f: GEMINI_VOICES.filter((v) => v[2] === 'f').map((v) => v[0]), m: GEMINI_VOICES.filter((v) => v[2] === 'm').map((v) => v[0]) };

  // Voz de Gemini de un personaje: la elegida en «Voces del reparto» o una automática de su sexo, distinta para cada uno
  function voiceFor(s, charId, role) {
    if (!s) return 'Kore';
    const v = s.voices || {};
    if (role === 'narrator') return v['@narrator'] || 'Iapetus';
    const id = role === 'me' ? s.me[0] : charId;
    if (v[id]) return v[id];
    const e = castOrder(s).get(id) || { g: 'm', k: 0 };
    return POOL[e.g][e.k % POOL[e.g].length];
  }

  // Indicación de interpretación a partir de la acotación de la frase: «(Riendo.)» → «riendo»
  function styleOf(b) {
    let st = b.paren || '';
    if (!st) { const m = String(b.text).match(/^\s*[(\[]([^)\]]{2,60})[)\]]/); if (m) st = m[1]; }
    return st.replace(/[()\[\].]/g, '').trim().toLowerCase().slice(0, 60);
  }

  function keyOf(text, voice, style) {
    return `${S().geminiModel}|${S().lang}|${voice}|${style}|${strHash(text)}:${text.length}`;
  }

  /* ---------- llamada a la API ---------- */
  class VoiceError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

  function findAudio(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 8) return null;
    const mime = o.mime_type || o.mimeType || '';
    if (typeof o.data === 'string' && o.data.length > 64 && (/audio/i.test(mime) || o.type === 'audio')) {
      return { data: o.data, mime: mime || 'audio/wav', rate: o.sample_rate || o.sampleRate };
    }
    for (const k of Object.keys(o)) { const r = findAudio(o[k], depth + 1); if (r) return r; }
    return null;
  }

  async function post(url, body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    let r;
    try {
      r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S().geminiKey.trim() }, body: JSON.stringify(body) });
    } catch (e) {
      throw new VoiceError('red', 'Sin conexión con Gemini');
    } finally { clearTimeout(t); }
    if (r.ok) return r.json();
    let msg = '', reason = '';
    try {
      const j = await r.json();
      const err = (Array.isArray(j) ? j[0] : j).error || {}; // Google a veces devuelve el error dentro de una lista
      msg = err.message || '';
      reason = ((err.details || []).find((d) => d.reason) || {}).reason || '';
    } catch (e) { /* nada */ }
    if (r.status === 429) throw new VoiceError('limite', msg);
    if (r.status === 400 && (/api key/i.test(msg) || /API_KEY/.test(reason))) throw new VoiceError('clave', msg);
    if (r.status === 401 || r.status === 403) throw new VoiceError('clave', msg);
    if (r.status === 404) throw new VoiceError('modelo', msg);
    throw new VoiceError('otro', msg || 'HTTP ' + r.status);
  }

  function toBlob(found) {
    const bytes = b64ToBytes(found.data);
    if (/wav/i.test(found.mime) || (bytes[0] === 0x52 && bytes[1] === 0x49)) return new Blob([bytes], { type: 'audio/wav' });
    const rate = Number(found.rate) || Number((found.mime.match(/rate=(\d+)/) || [])[1]) || 24000;
    return pcmToWav(bytes, rate); // audio/L16 (PCM)
  }

  async function generate(text, voice, style) {
    const accent = ACCENT[S().lang] || '';
    const direction = [accent && `Habla en ${accent}`, style && `con este tono: ${style}`].filter(Boolean).join(', ');
    if (!legacy) {
      try {
        const content = { type: 'text', text };
        if (direction) content.annotations = [{ type: 'speech_metadata', style: direction }];
        const j = await post(`${API}/interactions`, {
          model: S().geminiModel, input: [{ type: 'user_input', content: [content] }],
          response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice }] },
        });
        const found = findAudio(j);
        if (found) return toBlob(found);
        throw new VoiceError('modelo', 'Respuesta sin audio');
      } catch (e) {
        if (!(e instanceof VoiceError) || e.code !== 'modelo') throw e;
        legacy = true; // la API nueva no está disponible: se prueba la anterior
      }
    }
    const j = await post(`${API}/models/${LEGACY_MODEL}:generateContent`, {
      contents: [{ parts: [{ text: direction ? `${direction}. Di: ${text}` : text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    });
    const found = findAudio(j);
    if (!found) throw new VoiceError('otro', 'Respuesta sin audio');
    return toBlob(found);
  }

  function handleError(e) {
    const code = e && e.code;
    if (code === 'clave') {
      blocked = { reason: code, until: Infinity };
      toast('La clave de Gemini no funciona. Revísala en Ajustes. Mientras, uso la voz del móvil.', 5000);
    } else if (code === 'limite') {
      blocked = { reason: code, until: Date.now() + 60000 };
      if (Date.now() - lastWarn > 300000) { lastWarn = Date.now(); toast('Has llegado al límite gratuito de Gemini por ahora. Sigo con la voz del móvil.', 5000); }
    } else if (code === 'red') {
      blocked = { reason: code, until: Date.now() + 15000 };
    } else console.warn('voz', e);
  }

  // Devuelve el audio de una frase (memoria → móvil → Gemini) o null si no se puede
  async function get(text, voice, style, { generate: allowGen = true } = {}) {
    const k = keyOf(text, voice, style);
    if (mem.has(k)) return mem.get(k);
    const stored = await DB.audioGet(k);
    if (stored) { mem.set(k, stored); return stored; }
    if (!allowGen || !canGenerate()) return null;
    if (!inflight.has(k)) {
      inflight.set(k, generate(text, voice, style)
        .then((blob) => { mem.set(k, blob); DB.audioPut(k, blob); return blob; })
        .finally(() => inflight.delete(k)));
    }
    return inflight.get(k);
  }

  /** Dice un texto con la voz natural si se puede; si no, con la del móvil. */
  async function say(s, { text, charId = null, role = 'char', style = '' }) {
    text = String(text || '').trim();
    if (!text) return;
    if (enabled()) {
      let blob = null;
      try { blob = await get(text, voiceFor(s, charId, role), style); } catch (e) { handleError(e); }
      if (blob) return Player.play(blob);
    }
    return TTS.speak(text, voiceProfile(s, charId, role));
  }

  function cancel() { Player.stop(); TTS.cancel(); }

  function unlock() { Player.unlock(); TTS.unlock(); }

  // Genera por adelantado (en segundo plano y de una en una) las próximas frases
  function prefetch(s, items) {
    if (!canGenerate()) return;
    const gen = queueGen;
    for (const it of items) {
      if (!it || !it.text) continue;
      queue = queue.then(() => {
        if (gen !== queueGen || !canGenerate()) return null;
        return get(it.text, voiceFor(s, it.charId, it.role), it.style || '').catch(handleError);
      });
    }
  }
  function stopPrefetch() { queueGen++; }

  // Prepara todas las frases indicadas; devuelve cuántas quedaron listas
  async function prepare(s, items, onProgress, isCancelled) {
    let done = 0;
    for (const it of items) {
      if (isCancelled && isCancelled()) break;
      try {
        const b = await get(it.text, voiceFor(s, it.charId, it.role), it.style || '');
        if (!b) break;
        done++;
        if (onProgress) onProgress(done, items.length);
      } catch (e) { handleError(e); break; }
    }
    return done;
  }

  async function readyCount(s, items) {
    const keys = await DB.audioKeys();
    return items.filter((it) => keys.has(keyOf(it.text, voiceFor(s, it.charId, it.role), it.style || ''))).length;
  }

  function resetBlock() { blocked = null; legacy = false; }

  return { enabled, canGenerate, say, cancel, unlock, prefetch, stopPrefetch, prepare, readyCount, voiceFor, styleOf, gender, charGender, castOrder, resetBlock, POOL };
})();
