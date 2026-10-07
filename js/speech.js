'use strict';
/* Voz: lectura en voz alta (síntesis) y reconocimiento de voz */

const TTS = {
  supported: typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
  voices: [],
  _ready: null,
  _gen: 0,
  _fin: null,

  init() {
    if (!this.supported) return Promise.resolve([]);
    if (this._ready) return this._ready;
    this._ready = new Promise((res) => {
      const load = () => {
        const v = speechSynthesis.getVoices();
        if (v && v.length) { this.voices = v; res(v); return true; }
        return false;
      };
      if (load()) return;
      try { speechSynthesis.addEventListener('voiceschanged', load); } catch (e) { speechSynthesis.onvoiceschanged = load; }
      setTimeout(() => { load(); res(this.voices); }, 2500);
    });
    return this._ready;
  },

  // Voces «neuronales» o mejoradas que suenan más humanas (Edge, Chrome, Samsung/Google, iPhone)
  isNatural(v) { return /natural|neural|premium|enhanced|mejorad|online|wavenet|siri/i.test(v.name); },
  quality(v) { return this.isNatural(v) ? 3 : /google|samsung/i.test(v.name) ? 2 : v.localService === false ? 1 : 0; },

  voicesFor(lang) {
    const L = (lang || 'es-ES').toLowerCase();
    const pre = L.split('-')[0];
    const norm = (v) => (v.lang || '').toLowerCase().replace('_', '-');
    return this.voices
      .filter((v) => norm(v).startsWith(pre))
      .sort((a, b) => (norm(b) === L) - (norm(a) === L) || this.quality(b) - this.quality(a) || a.name.localeCompare(b.name));
  },

  chunks(text) {
    const parts = String(text).replace(/\s+/g, ' ').trim().match(/[^.!?…;:]+[.!?…;:]*["»”)]*\s*/g) || [text];
    const out = [];
    let cur = '';
    for (const p of parts) {
      if ((cur + p).length > 200 && cur) { out.push(cur.trim()); cur = ''; }
      if (p.length > 200) {
        const words = p.split(' ');
        for (const w of words) { if ((cur + ' ' + w).length > 200) { out.push(cur.trim()); cur = ''; } cur += ' ' + w; }
      } else cur += p;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  },

  speak(text, { voice = null, pitch = 1, rate = 1, lang = 'es-ES', volume = 1 } = {}) {
    if (!this.supported || !text || !String(text).trim()) return Promise.resolve();
    const gen = this._gen;
    const chunks = this.chunks(text);
    return (async () => {
      for (const ch of chunks) {
        if (gen !== this._gen) return;
        await new Promise((res) => {
          const u = new SpeechSynthesisUtterance(ch);
          u.lang = (voice && voice.lang) || lang;
          if (voice) u.voice = voice;
          u.pitch = pitch; u.rate = rate; u.volume = volume;
          let done = false;
          const est = ((ch.length / 13) / rate) * 1000 + 3000;
          const wd = setTimeout(() => fin(), est * 1.8);
          const fin = () => { if (done) return; done = true; clearTimeout(wd); if (this._fin === fin) this._fin = null; res(); };
          u.onend = fin;
          u.onerror = fin;
          this._fin = fin;
          try { speechSynthesis.speak(u); } catch (e) { fin(); }
        });
      }
    })();
  },

  // iOS/Safari solo deja hablar si la primera vez ocurre dentro de un toque del usuario
  unlock() {
    if (!this.supported || this._unlocked) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); this._unlocked = true; } catch (e) { /* nada */ }
  },

  cancel() {
    this._gen++;
    try { speechSynthesis.cancel(); } catch (e) { /* nada */ }
    if (this._fin) this._fin();
  },
};

/*
 * Reconocimiento de voz.
 * Se usa en modo «frase a frase» (continuous = false): el propio móvil detecta cuándo te callas y corta.
 * El modo continuo de Android/iPhone no para nunca y repite resultados, por eso no se usa.
 * onSessionEnd() decide si se vuelve a escuchar (true) —p. ej. si hiciste una pausa a mitad de frase— o se termina.
 */
const SR = {
  get Ctor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; },
  get supported() { return !!this.Ctor; },
  rec: null,
  active: false,

  start({ lang = 'es-ES', onText, onError, onSessionEnd }) {
    this.stop();
    if (!this.supported) { onError && onError('unsupported'); return; }
    this.active = true;
    let prev = '';
    const make = () => {
      const r = new this.Ctor();
      r.lang = lang;
      r.continuous = false;
      r.interimResults = true;
      r.maxAlternatives = 1;
      let session = '';
      r.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += ' ' + e.results[i][0].transcript;
        session = t;
        if (onText) onText((prev + ' ' + t).replace(/\s+/g, ' ').trim());
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          this.active = false;
          if (onError) onError(e.error);
        }
      };
      r.onend = () => {
        if (this.rec !== r) return;
        prev = (prev + ' ' + session).trim();
        if (!this.active) return;
        if (onSessionEnd && onSessionEnd()) {
          setTimeout(() => { if (this.active && this.rec === r) { try { make(); } catch (err) { this.active = false; } } }, 150);
        } else this.active = false;
      };
      this.rec = r;
      try { r.start(); } catch (err) { this.active = false; if (onError) onError('start'); }
    };
    make();
  },

  stop() {
    this.active = false;
    const r = this.rec;
    this.rec = null;
    if (r) { try { r.onend = null; r.abort(); } catch (e) { /* nada */ } }
  },
};

/**
 * Escucha al actor decir una frase y decide cuándo ha terminado:
 *  · en cuanto dice las últimas palabras de la frase (aunque se haya saltado alguna),
 *  · tras un silencio sin palabras nuevas (1 s si ya llegó al final, 2 s si no),
 *  · o al pasar un tiempo máximo según lo larga que sea la frase.
 * onDone(alineación, texto, motivo) se llama una sola vez.
 */
function listenLine(target, { lang, onUpdate, onDone, onError }) {
  const t0 = Date.now();
  const maxMs = Math.min(90000, 6000 + target.length * 800);
  let al = { matched: new Set(), extra: [], score: 0 };
  let said = '', lastChange = 0, finished = false, soon = null, timer = null;
  const reachedEnd = () => target.length > 0 && (al.matched.has(target.length - 1) || (target.length >= 4 && al.matched.has(target.length - 2)));
  const end = (reason) => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    clearTimeout(soon);
    SR.stop();
    onDone(al, said, reason);
  };
  SR.start({
    lang,
    onText: (txt) => {
      if (finished || txt === said) return;
      said = txt;
      lastChange = Date.now();
      al = alignWords(target, txt.split(/\s+/).map(normWord).filter(Boolean));
      if (onUpdate) onUpdate(al, txt);
      clearTimeout(soon);
      if (al.score >= 0.95 || (reachedEnd() && al.score >= 0.5)) soon = setTimeout(() => end('done'), 450);
    },
    onSessionEnd: () => {
      if (finished) return false;
      if (lastChange && (reachedEnd() || al.score >= 0.8)) { end('done'); return false; }
      return Date.now() - t0 < maxMs;
    },
    onError: (err) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      if (onError) onError(err);
    },
  });
  timer = setInterval(() => {
    if (finished) { clearInterval(timer); return; }
    const now = Date.now();
    if (lastChange && now - lastChange > (reachedEnd() ? 1000 : 2000)) end('silence');
    else if (!lastChange && now - t0 > 12000) end('nothing');
    else if (now - t0 > maxMs) end('timeout');
  }, 200);
  return { stop: () => end('manual') };
}
