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

  voicesFor(lang) {
    const L = (lang || 'es-ES').toLowerCase();
    const pre = L.split('-')[0];
    const norm = (v) => (v.lang || '').toLowerCase().replace('_', '-');
    return this.voices
      .filter((v) => norm(v).startsWith(pre))
      .sort((a, b) => (norm(b) === L) - (norm(a) === L) || (b.localService === true) - (a.localService === true) || a.name.localeCompare(b.name));
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

const SR = {
  get Ctor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; },
  get supported() { return !!this.Ctor; },
  rec: null,
  active: false,

  start({ lang = 'es-ES', onText, onError, onStart }) {
    this.stop();
    if (!this.supported) { onError && onError('unsupported'); return; }
    this.active = true;
    let prev = '';
    let sessionText = '';
    const make = () => {
      const r = new this.Ctor();
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onstart = () => onStart && onStart();
      r.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += ' ' + e.results[i][0].transcript;
        sessionText = t;
        onText && onText((prev + ' ' + t).replace(/\s+/g, ' ').trim());
      };
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
          this.active = false;
          onError && onError(e.error);
        }
      };
      r.onend = () => {
        if (this.rec !== r) return;
        if (this.active) {
          prev += ' ' + sessionText;
          sessionText = '';
          setTimeout(() => { if (this.active && this.rec === r) { try { make(); } catch (err) { this.active = false; } } }, 120);
        }
      };
      this.rec = r;
      try { r.start(); } catch (err) { this.active = false; onError && onError('start'); }
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
