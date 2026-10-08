'use strict';
/* Afinación: detecta la nota que cantas (algoritmo YIN) y toca notas de referencia */

const Pitch = (() => {
  const NAMES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const midiOf = (f) => 69 + 12 * Math.log2(f / 440);
  const freqOf = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // Do4 = do central (notación internacional)
  const nameOf = (m) => { const r = Math.round(m); return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); };
  const centsOff = (m) => Math.round((m - Math.round(m)) * 100);

  let ctx = null;
  function audioCtx() {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) throw new Error('Este navegador no puede usar audio'); ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // iPhone: el audio debe arrancar dentro de un toque
  function unlock() { try { audioCtx(); } catch (e) { /* nada */ } }
  const supported = () => !!((window.AudioContext || window.webkitAudioContext) && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  /* --- detector YIN (de Cheveigné y Kawahara), limitado a la tesitura de la voz humana --- */
  function yin(buf, sr, minF = 65, maxF = 1100) {
    const W = 1024;
    const tMin = Math.max(2, Math.floor(sr / maxF));
    const tMax = Math.min(Math.floor(sr / minF), buf.length - W - 1);
    let e = 0;
    for (let i = 0; i < W; i++) e += buf[i] * buf[i];
    const rms = Math.sqrt(e / W);
    if (rms < 0.008 || tMax <= tMin) return { f: 0, rms, clarity: 0 };
    const d = new Float32Array(tMax + 2);
    for (let tau = 1; tau <= tMax + 1; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
      d[tau] = s;
    }
    let run = 0;
    d[0] = 1;
    for (let tau = 1; tau <= tMax + 1; tau++) { run += d[tau]; d[tau] = run ? (d[tau] * tau) / run : 1; }
    let tau = -1;
    for (let t = tMin; t <= tMax; t++) {
      if (d[t] < 0.15) { while (t + 1 <= tMax && d[t + 1] < d[t]) t++; tau = t; break; }
    }
    if (tau < 0) return { f: 0, rms, clarity: 0 };
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    const shift = den ? (a - c) / (2 * den) : 0;
    return { f: sr / (tau + clamp(shift, -1, 1)), rms, clarity: 1 - b };
  }

  /**
   * Abre el micrófono y llama a onFrame({ midi, freq, rms, clarity, t }) unas 25 veces por segundo.
   * midi es null cuando no hay una nota clara (silencio, consonantes, ruido).
   * Se filtran los saltos de octava sueltos con una mediana de 5 lecturas.
   */
  async function listen(onFrame) {
    const c = audioCtx();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    const src = c.createMediaStreamSource(stream);
    const an = c.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const hist = [];
    let stopped = false, timer = null;
    const tick = () => {
      if (stopped) return;
      an.getFloatTimeDomainData(buf);
      const r = yin(buf, c.sampleRate);
      let midi = null;
      if (r.f && r.clarity > 0.8) {
        hist.push(midiOf(r.f));
        if (hist.length > 5) hist.shift();
        const sorted = hist.slice().sort((x, y) => x - y);
        const med = sorted[sorted.length >> 1];
        const cur = hist[hist.length - 1];
        midi = Math.abs(cur - med) > 1.5 ? med : cur;
      } else hist.length = 0;
      try { onFrame({ midi, freq: midi != null ? freqOf(midi) : 0, rms: r.rms, clarity: r.clarity, t: performance.now() }); } catch (e) { console.warn(e); }
      timer = setTimeout(tick, 40);
    };
    tick();
    return {
      stop() {
        stopped = true;
        clearTimeout(timer);
        try { src.disconnect(); } catch (e) { /* nada */ }
        stream.getTracks().forEach((t) => t.stop());
      },
    };
  }

  /* --- notas de referencia: un timbre suave tipo piano eléctrico --- */
  const voicesOn = new Set();
  function tone(midi, ms = 900, { vol = 0.22 } = {}) {
    const c = audioCtx();
    const t0 = c.currentTime + 0.02, t1 = t0 + ms / 1000;
    const g = c.createGain();
    g.connect(c.destination);
    const parts = [[1, 'triangle', 1], [2, 'sine', 0.18], [3, 'sine', 0.06]].map(([mul, type, lvl]) => {
      const o = c.createOscillator();
      const og = c.createGain();
      o.type = type;
      o.frequency.value = freqOf(midi) * mul;
      og.gain.value = lvl;
      o.connect(og); og.connect(g);
      o.start(t0); o.stop(t1 + 0.05);
      return o;
    });
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.025);
    g.gain.exponentialRampToValueAtTime(vol * 0.55, t0 + 0.3);
    g.gain.setValueAtTime(vol * 0.55, Math.max(t0 + 0.3, t1 - 0.12));
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    const v = { parts, g };
    voicesOn.add(v);
    return new Promise((res) => setTimeout(() => { voicesOn.delete(v); res(); }, ms + 30));
  }

  // Glissando de referencia (para la sirena)
  function glide(fromMidi, toMidi, ms, { vol = 0.16 } = {}) {
    const c = audioCtx();
    const t0 = c.currentTime + 0.02, t1 = t0 + ms / 1000;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freqOf(fromMidi), t0);
    o.frequency.exponentialRampToValueAtTime(freqOf(toMidi), t1);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.05);
    g.gain.setValueAtTime(vol, t1 - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t1);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t1 + 0.05);
    const v = { parts: [o], g };
    voicesOn.add(v);
    return new Promise((res) => setTimeout(() => { voicesOn.delete(v); res(); }, ms + 30));
  }

  function silence() {
    for (const v of voicesOn) { try { v.g.gain.cancelScheduledValues(0); v.g.gain.value = 0; v.parts.forEach((o) => o.stop()); } catch (e) { /* nada */ } }
    voicesOn.clear();
  }

  /* --- tipos de voz (rangos orientativos en MIDI) --- */
  const VOICE_TYPES = [
    ['Bajo', 40, 64], ['Barítono', 45, 69], ['Tenor', 48, 72],
    ['Contralto', 53, 77], ['Mezzosoprano', 57, 81], ['Soprano', 60, 84],
  ];
  function voiceType(lo, hi) {
    let best = null, bestScore = -Infinity;
    for (const [name, a, b] of VOICE_TYPES) {
      const overlap = Math.max(0, Math.min(hi, b) - Math.max(lo, a));
      const score = overlap - Math.abs((lo + hi) / 2 - (a + b) / 2) * 0.8 - Math.abs(lo - a) * 0.4;
      if (score > bestScore) { bestScore = score; best = name; }
    }
    return best;
  }

  return { NAMES, midiOf, freqOf, nameOf, centsOff, supported, unlock, listen, tone, glide, silence, voiceType, VOICE_TYPES, yin };
})();
