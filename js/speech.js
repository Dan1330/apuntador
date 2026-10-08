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
 * pick(texto) puntúa cada alternativa que propone el móvil: se queda con la que más se parece a la frase esperada
 * (el reconocedor suele acertar en la 2.ª o 3.ª opción cuando la 1.ª es una palabra parecida).
 */
const SR = {
  get Ctor() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; },
  get supported() { return !!this.Ctor; },
  rec: null,
  active: false,

  start({ lang = 'es-ES', onText, onError, onSessionEnd, onActivity, pick }) {
    this.stop();
    if (!this.supported) { onError && onError('unsupported'); return; }
    this.active = true;
    let prev = '';
    let netErrors = 0;
    let quickEnds = 0; // sesiones que se cierran al instante sin oír nada: el reconocedor no funciona en este navegador
    const best = (res) => {
      if (!pick || res.length < 2) return res[0].transcript;
      let top = res[0].transcript, topScore = pick(top);
      for (let a = 1; a < res.length; a++) {
        const sc = pick(res[a].transcript);
        if (sc > topScore) { top = res[a].transcript; topScore = sc; }
      }
      return top;
    };
    const fail = (err) => { this.active = false; if (onError) onError(err); };
    const make = () => {
      const r = new this.Ctor();
      r.lang = lang;
      r.continuous = false;
      r.interimResults = true;
      r.maxAlternatives = pick ? 4 : 1;
      let session = '';
      const started = Date.now();
      let heard = false;
      // el móvil avisa cuando nota sonido o voz, antes de tener palabras
      if (onActivity) r.onsoundstart = r.onspeechstart = () => { if (this.rec === r) onActivity(); };
      r.onresult = (e) => {
        netErrors = 0;
        quickEnds = 0;
        heard = true;
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += ' ' + best(e.results[i]);
        session = t;
        if (onText) onText((prev + ' ' + t).replace(/\s+/g, ' ').trim());
      };
      r.onerror = (e) => {
        if (this.rec !== r) return;
        if (['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(e.error)) fail(e.error);
        // sin conexión el reconocedor falla en bucle: tras varios intentos se avisa
        else if (e.error === 'network' && ++netErrors >= 3) fail('network');
      };
      r.onend = () => {
        if (this.rec !== r) return;
        prev = (prev + ' ' + session).trim();
        if (!this.active) return;
        if (!heard && Date.now() - started < 700 && ++quickEnds >= 4) { fail('broken'); return; }
        if (onSessionEnd && onSessionEnd(heard)) {
          // reabrir el micro cuanto antes: lo que digas durante el hueco se pierde
          setTimeout(() => { if (this.active && this.rec === r) { try { make(); } catch (err) { fail('start'); } } }, 40);
        } else this.active = false;
      };
      this.rec = r;
      try { r.start(); } catch (err) { fail('start'); }
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


const toWords = (txt) => (String(txt).match(new RegExp(WORD_SRC, 'gu')) || []).map(normWord).filter(Boolean);

/*
 * Detector de voz de la app: no depende del reconocimiento del navegador (que en Samsung Internet,
 * Brave, Opera o algunos móviles no funciona). Abre el micrófono igual que el afinador, mide el volumen
 * para saber cuándo empiezas a hablar y cuándo te callas, y graba lo que dices.
 * onDone(wav | null, motivo) — wav es la grabación (16 kHz) desde que empezaste a hablar.
 * onMuted() avisa si el micrófono solo da silencio absoluto (silenciado, o lo tiene otra app).
 */
const VAD = {
  ctx: null,
  supported: () => !!((window.AudioContext || window.webkitAudioContext) && navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  audioCtx() {
    if (!this.ctx || this.ctx.state === 'closed') { const C = window.AudioContext || window.webkitAudioContext; this.ctx = new C(); }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  // el audio tiene que arrancar dentro de un toque
  unlock() { try { if (this.supported()) this.audioCtx(); } catch (e) { /* nada */ } },
};

function listenVoice({ expectMs = 3000, maxMs = 60000, nothingMs = 15000, onLevel, onDone, onError, onMuted }) {
  const t0 = Date.now();
  let stopped = false, stream = null, src = null, proc = null, sink = null, ctx = null;
  let floor = 0, floorN = 0, run = 0, firstVoice = 0, lastVoice = 0, spoken = 0, lastVoiceChunk = 0, peak = 0, live = 0;
  const pre = [], chunks = [];
  const cleanup = () => {
    if (proc) proc.onaudioprocess = null;
    try { if (src) src.disconnect(); if (proc) proc.disconnect(); if (sink) sink.disconnect(); } catch (e) { /* nada */ }
    if (stream) stream.getTracks().forEach((t) => t.stop());
  };
  // Float32 a 48 kHz (o lo que dé el móvil) → WAV de 16 kHz y 16 bits
  const encode = () => {
    const used = chunks.slice(0, lastVoiceChunk + 8); // un poco de cola tras la última palabra
    const len = used.reduce((a, c) => a + c.length, 0);
    if (!len) return null;
    const all = new Float32Array(len);
    let o = 0;
    for (const c of used) { all.set(c, o); o += c.length; }
    const ratio = ctx.sampleRate / 16000;
    const n = Math.floor(len / ratio);
    const bytes = new Uint8Array(n * 2);
    const dv = new DataView(bytes.buffer);
    for (let k = 0; k < n; k++) {
      const a = Math.floor(k * ratio), b = Math.min(len, Math.floor((k + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += all[j];
      const v = clamp(s / Math.max(1, b - a), -1, 1);
      dv.setInt16(k * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return pcmToWav(bytes, 16000);
  };
  const end = (reason) => {
    if (stopped) return;
    stopped = true;
    cleanup();
    let wav = null;
    try { wav = firstVoice ? encode() : null; } catch (e) { console.warn(e); }
    onDone(wav, reason);
  };
  (async () => {
    try {
      ctx = VAD.audioCtx();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      if (ctx.state !== 'running') await ctx.resume().catch(() => {});
      src = ctx.createMediaStreamSource(stream);
      proc = ctx.createScriptProcessor(2048, 1, 1);
      sink = ctx.createGain();
      sink.gain.value = 0; // no se oye: solo hace falta para que el procesador funcione
      src.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
      const frameMs = (2048 / ctx.sampleRate) * 1000;
      live = Date.now();
      proc.onaudioprocess = (e) => {
        if (stopped) return;
        const x = new Float32Array(e.inputBuffer.getChannelData(0));
        let s = 0;
        for (let k = 0; k < x.length; k++) s += x[k] * x[k];
        const rms = Math.sqrt(s / x.length);
        const now = Date.now();
        if (rms > peak) peak = rms;
        // silencio digital total durante 3 s: el micrófono no da sonido
        if (onMuted && peak < 0.0003 && now - live > 3000) { const m = onMuted; onMuted = null; m(); if (stopped) return; }
        // ruido de fondo: se mide al principio y se va ajustando mientras no hablas
        if (floorN < 6) { floor = (floor * floorN + rms) / (floorN + 1); floorN++; }
        const thr = Math.max(0.01, Math.min(floor * 3, 0.06));
        const loud = rms > thr;
        if (!loud && floorN >= 6) floor = rms < floor ? floor * 0.85 + rms * 0.15 : floor * 0.99 + rms * 0.01;
        run = loud ? run + 1 : 0;
        if (!firstVoice) {
          pre.push(x);
          if (pre.length > 8) pre.shift();
          if (run >= 3) { firstVoice = now; lastVoice = now; chunks.push(...pre); lastVoiceChunk = chunks.length; }
        } else {
          chunks.push(x);
          if (loud) { lastVoice = now; spoken += frameMs; lastVoiceChunk = chunks.length; }
        }
        if (onLevel) { try { onLevel(Math.min(1, rms / (thr * 4)), !!firstVoice && now - lastVoice < 300); } catch (err) { /* nada */ } }
        // si aún no has dicho ni la mitad de lo esperado, las pausas pueden ser dramáticas: se espera más
        const quiet = spoken < expectMs * 0.5 ? 2400 : 1300;
        if (firstVoice && now - lastVoice > quiet) end('done');
        else if (!firstVoice && now - t0 > nothingMs) end('nothing');
        else if (now - t0 > maxMs) end('timeout');
      };
    } catch (e) {
      if (stopped) return;
      stopped = true;
      cleanup();
      if (onError) onError(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'not-allowed' : 'audio-capture');
    }
  })();
  return {
    finish: () => end('manual'),                       // termina y entrega lo grabado
    abort: () => { if (stopped) return; stopped = true; cleanup(); }, // termina sin avisar
    spokenMs: () => spoken,
  };
}

/*
 * Transcripción con Gemini (si tienes clave): convierte tu grabación en texto para puntuar tus palabras.
 * No se le da la frase del guion para que no «corrija» lo que dices.
 */
const Transcriber = (() => {
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest'];
  let model = 0, noThinking = true, blockedUntil = 0, warned = 0;
  const key = () => (S().geminiKey || '').trim();
  const available = () => !!key() && navigator.onLine !== false && Date.now() > blockedUntil;

  const toB64 = (blob) => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });

  async function call(b64, lang) {
    const prompt = `Transcribe literalmente lo que dice la persona en este audio (idioma: ${lang}). Escribe solo las palabras que se oyen, tal cual, sin corregirlas, sin completarlas y sin añadir nada. Si no se entiende ninguna palabra, responde exactamente: (nada)`;
    const gen = { temperature: 0 };
    if (noThinking) gen.thinkingConfig = { thinkingBudget: 0 };
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    let r;
    try {
      r = await fetch(API + MODELS[model] + ':generateContent', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key() },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'audio/wav', data: b64 } }] }], generationConfig: gen }),
      });
    } catch (e) { throw Object.assign(new Error('red'), { code: 'red' }); } finally { clearTimeout(t); }
    if (r.ok) {
      const j = await r.json();
      const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
      const txt = parts.filter((p) => !p.thought).map((p) => p.text || '').join(' ').trim();
      return /^\(?nada\)?\.?$/i.test(txt) ? '' : txt;
    }
    if (r.status === 404 && model < MODELS.length - 1) { model++; return call(b64, lang); }
    if (r.status === 400 && noThinking) { noThinking = false; return call(b64, lang); }
    throw Object.assign(new Error('HTTP ' + r.status), { code: r.status === 429 ? 'limite' : r.status === 400 || r.status === 401 || r.status === 403 ? 'clave' : 'otro' });
  }

  async function text(wav, lang) {
    try { return await call(await toB64(wav), lang); } catch (e) {
      blockedUntil = Date.now() + (e.code === 'clave' ? 3600000 : e.code === 'limite' ? 60000 : 15000);
      if (Date.now() - warned > 300000) {
        warned = Date.now();
        toast(e.code === 'clave' ? 'Tu clave de Gemini no funciona: te escucho, pero no puedo puntuar tus palabras.'
          : e.code === 'limite' ? 'Límite gratuito de Gemini alcanzado: sigo escuchándote sin puntuar.'
            : 'Sin conexión: te escucho, pero no puedo puntuar tus palabras.', 4500);
      }
      throw e;
    }
  }
  return { available, text, reset: () => { blockedUntil = 0; model = 0; noThinking = true; } };
})();

const canListen = () => SR.supported || VAD.supported();

/*
 * Qué micrófono usar. En automático la app aprende sola lo que funciona en este aparato (S().micLearn):
 *  'both' · el reconocimiento del navegador (te entiende mientras hablas) y el detector de la app
 *           (sabe cuándo te callas y graba por si hace falta) a la vez,
 *  'sr'   · solo el del navegador (en algunos móviles los dos no pueden usar el micrófono a la vez),
 *  'vad'  · solo el detector de la app (el del navegador no funciona aquí).
 */
const MicPref = {
  mode: () => S().micMode || 'auto',
  learn(v) {
    if (this.mode() !== 'auto' || S().micLearn === v) return;
    S().micLearn = v;
    try { saveSettings(); } catch (e) { /* nada */ }
  },
  reset() { S().micLearn = ''; try { saveSettings(); } catch (e) { /* nada */ } },
  plan() {
    const m = this.mode(), sr = SR.supported, vad = VAD.supported();
    if (m === 'app' || !sr) return vad ? 'vad' : 'none';
    if (m === 'browser') return 'sr';
    // Samsung Internet dice que reconoce la voz, pero no funciona
    if (/SamsungBrowser/i.test(navigator.userAgent) && vad) return 'vad';
    const l = S().micLearn;
    if (l === 'vad' && vad) return 'vad';
    if (l === 'sr' || !vad) return 'sr';
    return 'both';
  },
  useBrowser() { const p = this.plan(); return p === 'sr' || p === 'both'; },
};

/**
 * Escucha al actor decir una frase. Mientras hablas, el reconocimiento del navegador va entendiendo
 * las palabras (onUpdate) y el detector de la app mide tu voz (onLevel). La frase se da por terminada sola:
 *  · en cuanto dices las últimas palabras de la frase (aunque te hayas saltado alguna),
 *  · cuando te callas (1,3 s; 2,4 s si aún no has dicho ni la mitad: las pausas dramáticas no cortan),
 *  · o al pasar un tiempo máximo según lo larga que sea la frase.
 * Después se comprueba: con lo que entendió el navegador o, si no pudo, con Gemini (si hay clave).
 * onDone(alineación, texto, motivo) se llama una sola vez; si la alineación trae «unscored», te oyó
 * pero no pudo entender las palabras. alineación.via dice quién te entendió: 'sr', 'gemini' o 'vad'.
 * Devuelve { stop() } para cancelar y finishNow() para terminar y comprobar ya.
 */
function listenLine(target, { lang, onUpdate, onLevel, onDone, onError }) {
  let plan = MicPref.plan();
  const auto = MicPref.mode() === 'auto';
  const t0 = Date.now();
  const maxMs = Math.min(120000, 8000 + target.length * 900);
  const expectMs = target.length * 330;
  const zero = () => ({ matched: new Set(), extra: [], score: 0 });
  let al = zero(), said = '', lastWord = 0, srAct = 0, srLive = false, srSessions = 0;
  let vad = null, vadWav = null, vadHeard = false;
  let finished = false, stopped = false, settling = false, soon = null, timer = null, tVad = t0;
  const reachedEnd = () => target.length > 0 && (al.matched.has(target.length - 1) || (target.length >= 4 && al.matched.has(target.length - 2)));
  const level = (lv, sp) => { if (!finished && onLevel) { try { onLevel(lv, sp); } catch (e) { /* nada */ } } };

  const stopSr = () => { if (srLive) { srLive = false; SR.stop(); } };
  const stopVad = () => { if (vad) { const v = vad; vad = null; v.abort(); } };
  const deliver = (a, txt, reason) => { if (!stopped) onDone(a, txt, reason); };
  const fail = (err) => {
    if (finished) return;
    finished = true;
    clearInterval(timer); clearTimeout(soon);
    stopSr(); stopVad();
    if (!stopped && onError) onError(err);
  };

  // fin de la escucha: se comprueba lo que has dicho
  const finalize = async (reason) => {
    if (finished) return;
    finished = true;
    clearInterval(timer); clearTimeout(soon);
    stopSr();
    if (vad) { const v = vad; vad = null; v.finish(); } // entrega la grabación (vadWav)
    if (said && al.matched.size) return deliver(Object.assign(al, { via: 'sr' }), said, reason);
    if (vadWav && Transcriber.available()) {
      if (onLevel) onLevel(-1, false); // «comprobando…»
      try {
        const t = await Transcriber.text(vadWav, lang);
        return deliver(Object.assign(alignWords(target, toWords(t)), { via: 'gemini' }), t, reason);
      } catch (e) { /* sin Gemini: sigue abajo */ }
    }
    if (said) return deliver(Object.assign(al, { via: 'sr' }), said, reason);
    if (vadHeard || vadWav) return deliver(Object.assign(zero(), { unscored: true, via: 'vad' }), '', reason);
    deliver(zero(), '', reason === 'manual' ? 'manual' : 'nothing');
  };
  // te has callado: un respiro para que el navegador termine de entender las últimas palabras
  const settle = (reason) => {
    if (finished || settling) return;
    settling = true;
    clearTimeout(soon);
    if (srLive && Date.now() - srAct < 2000) soon = setTimeout(() => finalize(reason), 700);
    else finalize(reason);
  };

  /* --- detector de la app --- */
  const startVad = () => {
    if (vad || finished) return;
    tVad = Date.now();
    const v = listenVoice({
      expectMs, maxMs,
      nothingMs: srLive ? 600000 : 15000,
      onLevel: (lv, sp) => { if (sp) vadHeard = true; level(lv, sp || (srLive && Date.now() - srAct < 400)); },
      onDone: (wav, reason) => {
        vadWav = wav;
        if (vad !== v) return; // lo ha parado finalize
        vad = null;
        if (reason === 'nothing' && (said || srLive)) return; // el navegador sigue escuchando
        settle(reason === 'done' ? 'silence' : reason);
      },
      onError: (err) => {
        if (vad !== v) return;
        vad = null;
        if (srLive) { if (err === 'audio-capture') MicPref.learn('sr'); return; } // sigue el del navegador
        fail(err);
      },
      onMuted: () => {
        if (vad !== v) return;
        if (srLive) { MicPref.learn('sr'); stopVad(); return; } // el navegador tiene el micrófono: se sigue solo con él
        fail('muted');
      },
    });
    vad = v;
  };

  /* --- reconocimiento del navegador --- */
  const startSr = () => {
    srLive = true;
    SR.start({
      lang,
      pick: (txt) => alignWords(target, toWords(txt)).matched.size,
      onActivity: () => { srAct = Date.now(); if (!vad) level(0.6, true); },
      onText: (txt) => {
        if (finished || txt === said) return;
        said = txt;
        srAct = lastWord = Date.now();
        al = alignWords(target, toWords(txt));
        if (onUpdate) onUpdate(al, txt);
        if (settling) return;
        clearTimeout(soon);
        // un respiro antes de cortar: el móvil suele corregir las últimas palabras al cerrar la frase
        if (al.score >= 0.95) soon = setTimeout(() => finalize('done'), 500);
        else if (reachedEnd() && al.score >= 0.6) soon = setTimeout(() => finalize('done'), 900);
      },
      onSessionEnd: (heard) => {
        if (finished) return false;
        srSessions++;
        if (lastWord && (reachedEnd() || al.score >= 0.85)) { srLive = false; finalize('done'); return false; }
        if (Date.now() - t0 >= maxMs) { srLive = false; settle('timeout'); return false; }
        // solo con el navegador y sin oír nada: puede que aquí no funcione, se prueba el detector de la app
        if (!vad && !lastWord && !heard && auto && VAD.supported() && Date.now() - t0 > 4000) {
          srLive = false;
          startVad();
          return false;
        }
        if (lastWord) lastWord = Date.now(); // el micro se reabre: no es silencio tuyo
        return true;
      },
      onError: (err) => {
        srLive = false;
        if (finished) return;
        if (err === 'audio-capture' && vad) MicPref.learn('sr'); // los dos a la vez no pueden
        else if (['service-not-allowed', 'broken', 'audio-capture'].includes(err)) MicPref.learn('vad');
        if (vad) return; // sigue el detector de la app
        if (auto && VAD.supported()) { toast('El reconocimiento de voz del navegador no responde: uso el detector de voz de la app.', 4000); startVad(); return; }
        fail(err);
      },
    });
  };

  if (plan === 'none') { setTimeout(() => fail('unsupported'), 0); return { app: true, finishNow() {}, stop() {} }; }
  if (plan !== 'vad') startSr();
  if (plan !== 'sr') startVad();

  timer = setInterval(() => {
    if (finished) { clearInterval(timer); return; }
    const now = Date.now();
    if (now - t0 > maxMs) { settle('timeout'); return; }
    if (settling) return;
    // el detector oye tu voz, pero el navegador no entiende nada: no le llega el sonido (o aquí no funciona)
    if (vad && srLive && !said && vad.spokenMs() > 2200) {
      MicPref.learn(srAct ? 'sr' : 'vad');
      stopSr();
      return;
    }
    // sin detector (o sin que te oiga), el silencio se cuenta desde la última palabra entendida
    if (!vad || !vadHeard) {
      if (lastWord && now - lastWord > (reachedEnd() ? 1300 : 2500)) settle('silence');
      else if (!lastWord && !vad && !srLive && !vadHeard) settle('nothing');
      else if (!lastWord && !vadHeard && now - tVad > 15000) settle('nothing');
    }
  }, 200);

  return {
    app: true,
    get via() { return vad ? (srLive ? 'both' : 'vad') : 'sr'; },
    finishNow: () => settle('manual'),
    stop: () => { stopped = true; finished = true; clearInterval(timer); clearTimeout(soon); stopSr(); stopVad(); },
  };
}
