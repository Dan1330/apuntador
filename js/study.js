'use strict';
/* Ensayar: tarjetas, primeras letras, escribir, ensayo con apuntador y escuchar · Progreso */

/* ---------- voces ---------- */
function baseVoices() {
  const vs = TTS.voicesFor(S().lang);
  const pref = S().voiceURI && TTS.voices.find((v) => v.voiceURI === S().voiceURI);
  return pref ? [pref, ...vs.filter((v) => v !== pref)] : vs;
}

// Sexo de una voz del sistema según su nombre (Microsoft, Google, Apple, Samsung…); 'u' si no se sabe
const FEM_VOICE = /(helena|laura|elvira|abril|estrella|irene|laia|\blia\b|triana|\bvera\b|ximena|m[oó]nica|paulina|marisol|francisca|isabela|soledad|ang[eé]lica|dalia|renata|beatriz|candela|carlota|elena|sabina|valentina|luciana|camila|paloma|esperanza|catalina|lupe|samantha|karen|moira|tessa|fiona|victoria|zira|jenny|\baria\b|sonia|libby|google espa[nñ]ol|mujer|femenin)/i;
const MASC_VOICE = /(pablo|[aá]lvaro|arnau|dar[ií]o|el[ií]as|\bnil\b|sa[uú]l|\bteo\b|jorge|\bjuan\b|diego|carlos|enrique|ra[uú]l|gonzalo|tom[aá]s|lorenzo|federico|gerardo|liberto|alonso|\bmale\b|hombre|masculin|david|\bmark\b|\bguy\b|ryan|daniel|\balex\b|\bfred\b|aaron|arthur|thomas)/i;
function voiceGender(v) {
  if (/female/i.test(v.name)) return 'f';
  if (MASC_VOICE.test(v.name)) return 'm';
  if (FEM_VOICE.test(v.name)) return 'f';
  return 'u';
}

/**
 * Voz del móvil para cada personaje:
 *  · voz de mujer para las mujeres y de hombre para los hombres (si el móvil las tiene);
 *  · si no las tiene, la misma voz con el tono cambiado (más agudo o más grave);
 *  · cada personaje con una combinación distinta de voz, tono y velocidad.
 */
function voiceProfile(s, charId, role = 'char') {
  const rate = Number(S().rate) || 1;
  const lang = S().lang;
  const vs = baseVoices();
  const byG = { f: vs.filter((v) => voiceGender(v) === 'f'), m: vs.filter((v) => voiceGender(v) === 'm'), u: vs.filter((v) => voiceGender(v) === 'u') };
  const pick = (g, k) => {
    const matched = byG[g].length > 0;
    const pool = matched ? byG[g] : byG.u.length ? byG.u : vs;
    const voice = pool.length ? pool[k % pool.length] : null;
    const round = pool.length ? Math.floor(k / pool.length) : k; // veces que se repite la misma voz
    const base = matched ? 1 : g === 'f' ? 1.3 : 0.78;
    const STEP = [0, -0.16, 0.16, -0.28, 0.28, 0.38];
    return {
      voice,
      pitch: clamp(base + STEP[round % STEP.length] * (g === 'f' ? 1 : 0.8), 0.5, 1.9),
      rate: rate * [1, 0.95, 1.06, 0.92, 1.09, 1][round % 6],
      lang,
    };
  };
  if (role === 'narrator' || !s) return { voice: vs[0] || null, pitch: 0.95, rate: rate * 1.04, lang, volume: 0.85 };
  const cast = Voices.castOrder(s);
  const id = role === 'me' ? s.me[0] : charId;
  const e = cast.get(id) || { g: 'm', k: 0 };
  return pick(e.g, e.k);
}

/* ---------- pantalla «Ensayar» ---------- */
function validScope(s, scope) {
  return Model.scopeOptions(s).some((o) => o.v === scope) ? scope : 'all';
}

const MODES = [
  ['cards', 'm-cards', 'cards', 'Tarjetas', 'Lees la réplica, recuerdas tu frase y te puntúas.'],
  ['letters', 'm-letters', 'letters', 'Primeras letras', 'Tu frase se va borrando hasta que la dices sola.'],
  ['type', 'm-type', 'keyboard', 'Escribir', 'Escríbela de memoria y mira qué palabras fallas.'],
  ['listen', 'm-listen', 'headphones', 'Escuchar', 'La escena entera con pausas para lo tuyo.'],
];

function viewStudyHub(s) {
  if (!s.me.length) {
    mount(`${scriptHeroHTML(s)}<main class="page">${noCharBanner(s)}<div class="empty">${icon('user')}<p>Primero elige tu personaje para poder ensayar tus frases.</p></div></main>${tabbarHTML(s, 'study')}`);
    return;
  }
  const scope = validScope(s, s.ui.scope);
  const items = Model.scopeMine(s, scope);
  const m = Model.mastery(s, items);
  const due = Model.dueCount(s);
  mount(`
  ${scriptHeroHTML(s)}
  <main class="page">
    <button class="scope-btn" data-act="pickScope"><span class="ring" style="--p:${m.pct};--sz:46px;--w:5px"><b style="font-size:12px">${m.pct}%</b></span>
      <span class="grow"><small>Vas a ensayar</small><b>${esc(Model.scopeLabel(s, scope))}</b></span>
      <span class="pill brand">${plural(items.length, 'frase', 'frases')}</span>${icon('down', 'sm')}</button>
    <button class="mode-hero mt" data-act="startMode" data-mode="partner"><img src="art/prompter.jpg" alt="" decoding="async">
      <span class="in"><span class="grow"><span class="eyebrow" style="color:#f3d48b">Recomendado</span><b>Ensayo con apuntador</b>
        <span>La app dice las réplicas en voz alta y te escucha decir tus frases.</span></span><span class="go">${icon('play')}</span></span></button>
    <div class="mode-grid mt">${MODES.map(([mode, cls, ic, title, desc]) =>
      `<button class="mode-card ${cls}" data-act="startMode" data-mode="${mode}"><span class="mi">${icon(ic)}</span><b>${title}</b><span>${desc}</span></button>`).join('')}</div>
    ${due ? `<div class="card mt today"><span class="ri">${icon('clock')}</span><div class="grow"><b>${plural(due, 'frase toca', 'frases tocan')} repasar hoy</b><p class="small muted">Las nuevas y las que tu memoria necesita</p></div>
      <button class="btn primary sm" data-act="startMode" data-mode="cards" data-scope="due" data-order="smart">Repasar</button></div>` : ''}
    <h3 class="section-title">Orden de las frases</h3>
    ${segHTML('setOrder', S().order, [['seq', 'En orden'], ['smart', 'Inteligente'], ['random', 'Al azar']])}
    <p class="hint mt-s">Para tarjetas, letras y escribir. «Inteligente» empieza por las que fallas y las que toca repasar.</p>
  </main>
  ${tabbarHTML(s, 'study')}`);
}

ACT.pickScope = async () => {
  const s = App.cur;
  const cur = validScope(s, s.ui.scope);
  const v = await chooseSheet({ title: '¿Qué quieres ensayar?', options: Model.scopeOptions(s).map((o) => ({
    value: o.v, label: o.label, sub: plural(o.n, 'frase', 'frases'), on: o.v === cur,
    icon: o.v === 'all' ? 'book' : o.v === 'star' ? 'star' : o.v === 'weak' ? 'target' : o.level === 1 ? 'layers' : 'list',
  })) });
  if (!v) return;
  s.ui.scope = v;
  saveScript(s);
  rerender();
};
ACT.setOrder = (el) => { S().order = el.dataset.v; saveSettings(); el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el)); };
ACT.startMode = (el) => {
  const s = App.cur;
  Voices.unlock();
  const scope = el.dataset.scope || validScope(s, s.ui.scope);
  const order = el.dataset.order || S().order;
  go(`/s/${s.id}/study/${el.dataset.mode}?scope=${encodeURIComponent(scope)}&order=${order}`);
};
ACT.sessClose = () => go(`/s/${App.cur.id}/study`, true);

function viewSession(s, mode, q) {
  if (!s.me.length) return go(`/s/${s.id}/study`, true);
  if (mode === 'partner' || mode === 'listen') return Reh.setup(s, mode, q);
  return Drill.start(s, mode, q);
}

/* ---------- contexto: la réplica anterior a tu frase ---------- */
function cueInfo(s, i) {
  const between = [];
  let cue = -1;
  for (let j = i - 1; j >= 0; j--) {
    const b = s.blocks[j];
    if (b.type === 'scene') break;
    if (b.type === 'dialogue') { cue = j; break; }
    if (between.length < 2) between.unshift(j);
  }
  return { cue, between };
}

function ctxBlockHTML(s, j, cls) {
  const b = s.blocks[j];
  if (b.type === 'action') return `<div class="cx act ${cls}">${esc(b.text)}</div>`;
  if (b.type === 'scene') return `<div class="cx ${cls}"><b>${esc(b.text)}</b></div>`;
  const mine = Model.isMine(s, j);
  return `<div class="cx ${cls}"><div class="who">${whoHTML(s, b, mine)}${mine ? '<span class="muted">· tu frase anterior</span>' : ''}${b.paren ? `<span class="dir" style="text-transform:none;letter-spacing:0;font-weight:500">${esc(b.paren)}</span>` : ''}</div><div class="txt">${speechPlain(b.text)}</div></div>`;
}

function contextHTML(s, i, extra) {
  const { cue, between } = cueInfo(s, i);
  let html = '';
  if (cue >= 0 && extra > 0) {
    const earlier = [];
    for (let j = cue - 1; j >= 0 && earlier.length < extra; j--) {
      if (s.blocks[j].type === 'scene') break;
      earlier.unshift(j);
    }
    html += earlier.map((j) => ctxBlockHTML(s, j, 'dim')).join('');
  }
  html += cue >= 0 ? ctxBlockHTML(s, cue, 'cue') : '<div class="cx act">Empiezas tú la escena.</div>';
  html += between.map((j) => ctxBlockHTML(s, j, '')).join('');
  const canMore = cue > 0 && s.blocks[cue - 1].type !== 'scene';
  return `${canMore ? '<button class="more-ctx" data-act="moreCtx">＋ Ver más contexto</button>' : ''}<div class="ctx">${html}</div>`;
}

function micErrorMsg(err) {
  if (err === 'not-allowed' || err === 'service-not-allowed') return 'No tengo permiso para usar el micrófono. Actívalo en los permisos del navegador.';
  if (err === 'unsupported') return 'Este navegador no reconoce la voz. Prueba con Chrome (Android) o Safari (iPhone).';
  if (err === 'audio-capture') return 'No encuentro el micrófono. ¿Lo está usando otra app?';
  if (err === 'network') return 'El reconocimiento de voz necesita conexión a internet en este móvil.';
  if (err === 'language-not-supported') return 'Tu móvil no reconoce la voz en este idioma. Cámbialo en Ajustes → Idioma de los guiones.';
  if (err === 'broken') return 'El reconocimiento de voz del navegador no funciona aquí. En Ajustes → Micrófono elige «Detector de la app».';
  if (err === 'muted') return 'El micrófono no da sonido: revisa que no esté silenciado y que ninguna otra app lo esté usando.';
  return 'No se pudo usar el micrófono.';
}

const pctClass = (pct) => (pct >= 90 ? 'ok' : pct >= 60 ? 'warn' : 'bad');

/* ============ TARJETAS · PRIMERAS LETRAS · ESCRIBIR ============ */
const LEVELS = [['0', 'Todo'], ['1', 'Algo'], ['2', 'Mitad'], ['3', 'Iniciales'], ['4', 'Nada']];

const Drill = {
  start(s, mode, q) {
    this.s = s;
    this.mode = mode;
    this.scope = q.get('scope') || 'all';
    this.queue = this.buildQueue(s, q);
    App.retry = null;
    this.pos = 0;
    this.results = [];
    this.acc = 0;
    this.lastT = Date.now();
    this.stopped = false;
    if (!this.queue.length) {
      mount(`<div class="sess-top"><button class="icon-btn" data-act="sessClose" aria-label="Volver">${icon('close')}</button><div class="grow"></div></div>
        <main class="sess"><div class="empty">${icon('check')}<p>No hay frases para repasar aquí. ¡Todo al día!</p><button class="btn primary mt" data-act="sessClose">Volver</button></div></main>`);
      return;
    }
    s.log.sessions = (s.log.sessions || 0) + 1;
    Wake.on();
    App.cleanup = () => this.stop();
    this.resetCard();
    this.render();
  },

  buildQueue(s, q) {
    if (q.get('retry') && App.retry && App.retry.length) return App.retry.slice();
    const queue = Model.scopeMine(s, this.scope);
    const order = q.get('order') || S().order;
    if (order === 'random') {
      for (let k = queue.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [queue[k], queue[r]] = [queue[r], queue[k]]; }
    } else if (order === 'smart') {
      const now = Date.now();
      const key = (i) => { const p = s.prog[s.blocks[i].id]; if (!p) return 0.5; return p.d <= now ? p.l : 10 + p.l; };
      queue.sort((a, b) => key(a) - key(b) || a - b);
    }
    return queue;
  },

  // tiempo activo (los parones largos no cuentan)
  tick() { const now = Date.now(); this.acc += Math.min(90, (now - this.lastT) / 1000); this.lastT = now; },

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopListen(true);
    Voices.cancel();
    Wake.off();
    this.tick();
    Model.logTime(this.s, this.acc);
    this.acc = 0;
    saveScript(this.s, true);
  },

  resetCard() {
    this.state = 'ask';
    this.extra = 0;
    this.revealed = new Set();
    this.align = null;
    this.typed = '';
    this.listening = false;
    this.micText = '';
    this.heard = false;
    this.level = Number(S().letterLevel);
  },

  get i() { return this.queue[this.pos]; },
  get b() { return this.s.blocks[this.i]; },

  render() {
    const s = this.s, i = this.i;
    const total = this.queue.length;
    const scene = Model.sceneTitleOf(s, i);
    mount(`
    <div class="sess-top"><button class="icon-btn" data-act="sessClose" aria-label="Terminar">${icon('close')}</button>
      <div class="prog"><i style="width:${(this.pos / total) * 100}%"></i></div><span class="count">${this.pos + 1}/${total}</span></div>
    <main class="sess">
      ${scene ? `<div class="sess-scene">${esc(scene)}</div>` : ''}
      ${contextHTML(s, i, this.extra)}
      <div class="answer" id="answer">${this.answerHTML()}</div>
      ${this.mode === 'letters' && this.state === 'ask' ? `<div class="level-bar">${LEVELS.map(([v, l]) => `<button data-act="drillLevel" data-v="${v}" class="${Number(v) === this.level ? 'on' : ''}">${l}</button>`).join('')}</div>
        <p class="hint mt-s">Dila en voz alta. Toca una palabra oculta para verla.</p>` : ''}
      ${this.mode === 'type' && this.state === 'ask' ? `<div class="type-area"><textarea class="input" id="typeIn" placeholder="Escribe tu frase de memoria…" autocapitalize="sentences" spellcheck="false">${esc(this.typed)}</textarea></div>` : ''}
    </main>
    <div class="sess-actions"><div class="inner">${this.actionsHTML()}</div></div>`);
    $('#answer').addEventListener('click', (e) => {
      const w = e.target.closest('.w.ini, .w.hid');
      if (w && this.state === 'ask') { this.revealed.add(Number(w.dataset.wi)); w.classList.add('rev'); }
    });
    const ti = $('#typeIn');
    if (ti) { ti.addEventListener('input', () => { this.typed = ti.value; }); setTimeout(() => ti.focus(), 50); }
  },

  answerHTML() {
    const s = this.s, b = this.b;
    const who = `<div class="who"><span class="me-name">${esc(Model.charName(s, b.chars))}</span>${b.paren ? `<span class="dir" style="text-transform:none;letter-spacing:0;font-weight:500">${esc(b.paren)}</span>` : ''}</div>`;
    if (this.state === 'ask') {
      if (this.mode === 'letters') return who + `<div class="txt">${renderSpeech(b.text, { level: this.level, revealed: this.revealed, seed: seedOf(b) })}</div>`;
      if (this.listening) return who + `<div class="placeholder"><span class="mic-dot"></span><span id="micTxt">${this.micText ? esc(this.micText) : 'Te escucho… di tu frase'}</span><span class="vu"><i id="micVu"></i></span></div>`;
      if (this.mode === 'type') return who + `<div class="placeholder">${icon('keyboard')} Escríbela abajo, de memoria.</div>`;
      return who + `<div class="placeholder">${icon('mic')} ${plural(countWords(b.text), 'palabra', 'palabras')}. Dila en voz alta y luego compruébala.</div>`;
    }
    let html = who + `<div class="txt">${renderSpeech(b.text, { marked: this.align ? this.align.matched : null })}</div>`;
    if (this.align) {
      const pct = Math.round(this.align.score * 100);
      html += `<div class="score-line"><span>${pct}%</span><div class="meter"><i class="${pct >= 90 ? 'ok' : pct >= 60 ? 'warn' : ''}" style="width:${pct}%"></i></div><span class="muted small">${this.align.matched.size}/${wordsOf(b.text).length} palabras</span></div>`;
      if (this.mode === 'type' && this.typed.trim()) html += `<div class="typed">Escribiste: «${esc(this.typed.trim())}»</div>`;
      if (this.mode === 'cards' && this.micText) html += `<div class="typed">Te he entendido: «${esc(this.micText)}»</div>`;
    } else if (this.heard) {
      html += `<div class="typed">Te he oído. Compárala con lo que has dicho y puntúate.${Transcriber.available() ? '' : ' (Con una clave de Gemini en Ajustes, la app entiende tus palabras y te puntúa sola.)'}</div>`;
    }
    if (Coach.available()) html += `<p class="center" style="margin:6px 0 0"><button class="link-btn" data-act="drillCoach">${icon('sparkle', 'sm')} Consejo para decirla</button></p>`;
    return html;
  },

  actionsHTML() {
    if (this.state === 'rate') {
      const sug = this.align ? Model.gradeFromScore(this.align.score) : -1;
      return `<button class="btn grade g0 ${sug === 0 ? 'sug' : ''}" data-act="grade" data-g="0">Otra vez<small>no me la sé</small></button>
        <button class="btn grade g1 ${sug === 1 ? 'sug' : ''}" data-act="grade" data-g="1">Casi<small>con dudas</small></button>
        <button class="btn grade g2 ${sug === 2 ? 'sug' : ''}" data-act="grade" data-g="2">¡La sé!<small>perfecta</small></button>`;
    }
    if (this.mode === 'cards') {
      if (this.listening) return `<button class="btn primary" data-act="drillStopMic">${icon('check')} Ya está, comprobar</button>`;
      return `${canListen() ? `<button class="btn surface" data-act="drillMic">${icon('mic')} Decirla</button>` : ''}<button class="btn primary" data-act="drillShow">${icon('eye')} Ver frase</button>`;
    }
    if (this.mode === 'letters') return `<button class="btn surface" data-act="drillHint">Pista</button><button class="btn primary" data-act="drillShow">Comprobar</button>`;
    return `<button class="btn surface" data-act="drillGiveUp">No me acuerdo</button><button class="btn primary" data-act="drillCheck">Comprobar</button>`;
  },

  show() { this.tick(); this.stopListen(true); this.state = 'rate'; App.keepScroll = true; this.render(); },

  check() {
    this.tick();
    const said = (this.typed.match(new RegExp(WORD_SRC, 'gu')) || []).map(normWord).filter(Boolean);
    this.align = alignWords(wordsOf(this.b.text), said);
    this.state = 'rate';
    this.render();
  },

  hint() {
    const el = $('#answer .w.ini:not(.rev), #answer .w.hid:not(.rev)');
    if (!el) { toast('Ya está toda a la vista'); return; }
    this.revealed.add(Number(el.dataset.wi));
    el.classList.add('rev', 'just');
  },

  listen() {
    const target = wordsOf(this.b.text);
    VAD.unlock();
    this.listening = true;
    this.micText = '';
    this.align = null;
    App.keepScroll = true;
    this.render();
    // termina solo al decir el final de la frase o al quedarte en silencio
    const token = ++this._lt;
    this.heard = false;
    this.listener = listenLine(target, {
      lang: S().lang,
      onUpdate: (al, t) => {
        this.micText = t;
        this.align = al;
        const m = $('#micTxt'); if (m) m.textContent = t;
      },
      // mientras hablas: lo que va entendiendo y un medidor para que veas que te oye
      onLevel: (lv, speaking) => {
        const m = $('#micTxt'), v = $('#micVu');
        if (v) v.style.width = Math.round(Math.max(0, lv) * 10) * 10 + '%';
        if (!m) return;
        m.textContent = lv < 0 ? 'Comprobando lo que has dicho…' : this.micText || (speaking ? 'Te oigo…' : 'Te escucho… di tu frase');
      },
      onDone: (al, t, reason) => {
        if (token !== this._lt) return; // se paró desde fuera
        this.listener = null;
        if (al && al.unscored) { this.heard = true; this.align = null; } // te oyó, pero sin clave de Gemini no entiende las palabras
        else if (t) { this.micText = t; this.align = al; }
        else if (reason === 'nothing') toast('No te he oído. Acércate al micrófono o sube la voz.', 3500);
        this.stopListen();
      },
      onError: (err) => { this.listener = null; this.listening = false; toast(micErrorMsg(err), 4000); App.keepScroll = true; this.render(); },
    });
  },

  _lt: 0,
  stopListen(silent = false) {
    this._lt++;
    if (this.listener) { const l = this.listener; this.listener = null; l.stop(); }
    if (!this.listening) { if (silent) SR.stop(); return; }
    this.listening = false;
    SR.stop();
    if (silent) return;
    this.tick();
    if (!this.align && !this.heard) this.align = { matched: new Set(), extra: [], score: 0 };
    this.state = 'rate';
    App.keepScroll = true;
    this.render();
  },

  grade(g) {
    this.tick();
    const s = this.s, i = this.i;
    Model.rate(s, this.b, g, this.align ? this.align.score : null);
    this.results.push({ i, g });
    if (g === 0) this.queue.splice(Math.min(this.queue.length, this.pos + 4), 0, i); // vuelve a salir dentro de poco
    saveScript(s);
    this.pos++;
    if (this.pos >= this.queue.length) return this.finish();
    this.resetCard();
    this.render();
  },

  finish() {
    const first = new Map();
    for (const r of this.results) if (!first.has(r.i)) first.set(r.i, r);
    const arr = [...first.values()];
    const count = (g) => arr.filter((r) => r.g === g).length;
    const good = count(2), hard = count(1), again = count(0);
    const pct = arr.length ? Math.round(((good + hard * 0.5) / arr.length) * 100) : 0;
    const failed = arr.filter((r) => r.g < 2).map((r) => r.i);
    this.tick();
    const mins = Math.max(1, Math.round(this.acc / 60));
    this.stop();
    App.retry = failed;
    const msg = pct >= 90 ? '¡Te lo sabes!' : pct >= 60 ? '¡Vas muy bien!' : 'Buen comienzo';
    mount(`
    <div class="sess-top"><button class="icon-btn" data-act="sessClose" aria-label="Terminar">${icon('close')}</button><div class="prog"><i style="width:100%"></i></div><span class="count">${arr.length}/${arr.length}</span></div>
    <main class="sess"><div class="done">
      <div class="ring big" style="--p:${pct}"><div><b>${pct}%</b><small>acierto</small></div></div>
      <h2>${msg}</h2>
      <p class="muted">Has repasado ${plural(arr.length, 'frase', 'frases')} en unos ${mins} min.</p>
      <div class="trio"><span class="pill ok">${plural(good, 'sabida', 'sabidas')}</span><span class="pill warn">${hard} con dudas</span><span class="pill bad">${again} para repetir</span></div>
      <div class="btn-col">
        ${failed.length ? `<button class="btn primary big" data-act="drillRetry">Repasar ${plural(failed.length, 'la que falló', 'las que fallaron')}</button>` : ''}
        <button class="btn ${failed.length ? 'surface' : 'primary big'}" data-act="startMode" data-mode="partner">${icon('mic')} Ensayar la escena con voz</button>
        <button class="btn ghost" data-act="sessClose">Volver</button>
      </div></div></main>`);
  },
};

ACT.drillShow = () => Drill.show();
ACT.drillHint = () => Drill.hint();
ACT.drillCheck = () => { const t = $('#typeIn'); if (t) Drill.typed = t.value; Drill.check(); };
ACT.drillGiveUp = () => { Drill.typed = ''; Drill.align = { matched: new Set(), extra: [], score: 0 }; Drill.state = 'rate'; Drill.render(); };
ACT.drillMic = () => Drill.listen();
ACT.drillCoach = () => Coach.open(Drill.s, Drill.i);
ACT.drillStopMic = () => {
  // «Ya está» termina de escuchar y espera a que se compruebe lo dicho
  if (Drill.listener) { Drill.listener.finishNow(); return; }
  Drill.stopListen();
};
ACT.grade = (el) => Drill.grade(Number(el.dataset.g));
ACT.moreCtx = () => { Drill.extra += 2; App.keepScroll = true; Drill.render(); };
ACT.drillLevel = (el) => {
  Drill.level = Number(el.dataset.v);
  S().letterLevel = Drill.level;
  saveSettings();
  Drill.revealed = new Set();
  App.keepScroll = true;
  Drill.render();
};
ACT.drillRetry = () => go(`/s/${App.cur.id}/study/${Drill.mode}?retry=1&scope=${encodeURIComponent(Drill.scope)}`, true);

/* ============ ENSAYO CON APUNTADOR (voz) ============ */
const ANSWER_HELP = {
  voice: 'Di tu frase en voz alta: las palabras aparecen según las aciertas y la app sigue sola.',
  tap: 'Di tu frase y toca «Siguiente» cuando acabes. Puedes ver la frase si te atascas.',
  auto: 'La app deja un silencio del largo de tu frase para que la digas, y continúa.',
};

const Reh = {
  setup(s, mode, q) {
    this.s = s;
    this.mode = mode;
    this.from = q.get('from');
    this.scope = q.get('scope') || validScope(s, s.ui.scope);
    const cfg = Object.assign({}, S().rehearsal);
    if (mode === 'listen') Object.assign(cfg, { mineView: 'show', answer: 'auto', speakMine: true, readDir: true, showOthers: true });
    if (cfg.answer === 'voice' && !canListen()) cfg.answer = 'tap';
    this.cfg = cfg;
    const label = this.from ? 'Desde la frase elegida' : Model.scopeLabel(s, this.scope);
    mount(`
    <header class="topbar"><button class="icon-btn" data-act="sessClose" aria-label="Volver">${icon('back')}</button>
      <div class="tb-title"><h2>${mode === 'listen' ? 'Escuchar la escena' : 'Ensayo con apuntador'}</h2><span class="tb-sub">${esc(label)}</span></div></header>
    <main class="page no-tabs setup">
      ${mode === 'listen' ? '<p class="muted" style="margin:6px 4px 20px">La app lee toda la escena. Antes de cada frase tuya hace una pausa para que la digas, y luego la lee para que compruebes. Perfecto con auriculares.</p>' : ''}
      <div class="opt"><b>Cuando te toque hablar</b>${segHTML('rehOpt', cfg.answer, [['voice', 'La digo'], ['tap', 'Toco seguir'], ['auto', 'Pausa']], 'data-k="answer"')}
        <p class="small muted mt-s" id="ansHelp" style="margin-left:4px">${ANSWER_HELP[cfg.answer]}${!canListen() ? ' (Tu navegador no puede usar el micrófono: usa «Toco seguir».)' : ''}</p></div>
      <div class="opt"><b>Tus frases en pantalla</b>${segHTML('rehOpt', cfg.mineView, [['hid', 'Ocultas'], ['ini', 'Iniciales'], ['show', 'Visibles']], 'data-k="mineView"')}</div>
      <div class="card" style="padding:2px 16px">
        ${switchHTML('rehOptSw', cfg.speakMine, 'Leer tu frase después', 'Para oír cómo era exactamente', 'data-k="speakMine"')}
        ${switchHTML('rehOptSw', cfg.readDir, 'Leer acotaciones', 'Un narrador lee las indicaciones de escena', 'data-k="readDir"')}
        ${switchHTML('rehOptSw', cfg.showOthers, 'Ver el texto de los demás', 'Desactívalo para ensayar solo de oído', 'data-k="showOthers"')}
      </div>
      ${Voices.enabled() ? `<div class="card mt" id="voicePrep"><div class="today"><span class="ri">${icon('sparkle')}</span>
          <div class="grow"><b>Voces naturales (Gemini)</b><p class="small muted" id="vpTxt">Comprobando…</p></div>
          <button class="btn primary sm" data-act="rehPrepare" id="vpBtn" hidden>Preparar</button></div>
          <div class="meter mt-s" id="vpBar" hidden><i style="width:0"></i></div></div>`
        : `<div class="banner mt">${icon('sparkle')}<span class="grow small">¿Quieres voces más humanas? Activa las <b>voces naturales</b> en Ajustes.</span><button class="btn sm soft" data-act="go" data-to="/settings">Ajustes</button></div>`}
      ${!TTS.supported && !Voices.enabled() ? '<div class="banner mt">Este navegador no puede leer en voz alta. Las réplicas se mostrarán en pantalla.</div>' : ''}
      <p class="small muted mt" style="margin-left:4px">Consejo: sube el volumen y, si usas el micrófono, ensaya en un sitio tranquilo.</p>
    </main>
    <div class="sess-actions"><div class="inner"><button class="btn primary big" data-act="rehStart">${icon('play')} Empezar</button></div></div>`);
    if (Voices.enabled()) this.refreshPrep();
  },

  // Frases que sonarán en este ensayo (para preparar las voces)
  voiceItems() {
    return this.buildItems().map((i) => this.speechItem(i)).filter(Boolean);
  },

  async refreshPrep() {
    const items = this.voiceItems();
    const ready = await Voices.readyCount(this.s, items);
    const txt = $('#vpTxt'), btn = $('#vpBtn');
    if (!txt) return;
    txt.textContent = ready >= items.length
      ? `Las ${items.length} réplicas están listas, incluso sin conexión.`
      : `${ready} de ${items.length} réplicas listas. Prepáralas ahora para que el ensayo fluya sin esperas.`;
    if (btn) btn.hidden = ready >= items.length || !Voices.canGenerate();
  },

  async prepareVoices() {
    const items = this.voiceItems();
    const bar = $('#vpBar'), btn = $('#vpBtn'), txt = $('#vpTxt');
    if (btn) btn.hidden = true;
    if (bar) bar.hidden = false;
    const done = await Voices.prepare(this.s, items, (n, total) => {
      if (bar) bar.firstElementChild.style.width = Math.round((n / total) * 100) + '%';
      if (txt) txt.textContent = `Preparando voces… ${n} de ${total}`;
    }, () => !$('#voicePrep'));
    if (bar) bar.hidden = true;
    if (done < items.length && txt) toast('No se han podido preparar todas: las que falten se harán durante el ensayo.');
    this.refreshPrep();
  },

  saveCfg() {
    if (this.mode === 'partner') { S().rehearsal = Object.assign({}, this.cfg); saveSettings(); }
  },

  // Bloques que se van a recorrer
  buildItems() {
    const s = this.s;
    const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
    if (this.from) {
      const i = Model.ix(s).byId.get(this.from);
      const start = i == null ? 0 : i;
      const { cue } = cueInfo(s, start);
      return range(Model.isMine(s, start) && cue >= 0 ? cue : start, s.blocks.length);
    }
    const r = Model.scopeRange(s, this.scope);
    if (r) return range(r.start, r.end);
    // frases sueltas (marcadas, falladas…): cada una con su réplica
    const set = new Set();
    for (const m of Model.scopeMine(s, this.scope)) { set.add(m); const { cue } = cueInfo(s, m); if (cue >= 0) set.add(cue); }
    return [...set].sort((a, b) => a - b);
  },

  start() {
    const s = this.s;
    Voices.unlock();
    VAD.unlock();
    this.saveCfg();
    Object.assign(this, { items: this.buildItems(), pos: 0, playing: false, run: 0, waiters: new Set(), turn: null, listener: null,
      results: new Map(), rev: new Map(), done: new Set(), t0: Date.now(), stopped: false });
    s.log.sessions = (s.log.sessions || 0) + 1;
    mount(`
    <div class="sess-top"><button class="icon-btn" data-act="sessClose" aria-label="Terminar">${icon('close')}</button>
      <div class="prog"><i id="rehProg" style="width:0"></i></div><span class="count" id="rehCount"></span></div>
    <main class="prompter" id="prompter">${this.items.map((i, k) => this.pbHTML(i, k)).join('')}</main>
    <div class="player">
      <div class="status" id="rehStatus"></div>
      <div class="turn-row" id="turnRow" hidden></div>
      <div class="ctrl">
        <button class="icon-btn" data-act="rehPrev" aria-label="Anterior">${icon('prev')}</button>
        <button class="icon-btn play" data-act="rehToggle" id="rehPlay" aria-label="Reproducir o pausar">${icon('play')}</button>
        <button class="icon-btn" data-act="rehNext" aria-label="Siguiente">${icon('next')}</button>
      </div></div>`);
    $('#prompter').addEventListener('click', (e) => {
      const el = e.target.closest('.pb');
      if (!el) return;
      const k = Number(el.dataset.k);
      if (k === this.pos && this.turn) {
        const w = e.target.closest('.w.ini, .w.hid');
        if (w) { this.turn.revealed.add(Number(w.dataset.wi)); w.classList.add('rev'); }
        return;
      }
      this.jump(k);
    });
    Wake.on();
    App.cleanup = () => this.stop();
    this.highlight();
    TTS.init().then(() => { if (!this.stopped) this.play(); });
  },

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.playing = false;
    this.stopAll();
    Wake.off();
    Model.logTime(this.s, (Date.now() - this.t0) / 1000);
    saveScript(this.s, true);
  },

  /* --- pintar --- */
  pbHTML(i, k) {
    const s = this.s, b = s.blocks[i];
    if (b.type === 'scene') return `<div class="pb scene" data-k="${k}">${esc(b.text)}</div>`;
    if (b.type === 'action') return `<div class="pb act" data-k="${k}">${esc(b.text)}</div>`;
    const mine = Model.isMine(s, i);
    const txt = mine ? this.mineTxt(i, k) : (this.cfg.showOthers ? speechPlain(b.text) : '<span class="muted">· · ·</span>');
    return `<div class="pb ${mine ? 'mine' : ''}" data-k="${k}"><div class="who">${whoHTML(s, b, mine)}${b.paren ? `<span class="dir" style="text-transform:none;letter-spacing:0;font-weight:500">${esc(b.paren)}</span>` : ''}<span class="score" id="sc-${k}"></span></div><div class="txt" id="tx-${k}">${txt}</div></div>`;
  },

  mineTxt(i, k) {
    const b = this.s.blocks[i];
    if (this.done.has(k)) {
      const r = this.results.get(k);
      return renderSpeech(b.text, { marked: r && r.matched ? r.matched : null });
    }
    const lvl = { hid: 4, ini: 3, show: 0 }[this.cfg.mineView];
    const rev = this.turn && this.turn.k === k ? this.turn.revealed : this.rev.get(k);
    return renderSpeech(b.text, { level: lvl, revealed: rev, seed: seedOf(b) });
  },

  updateMine(k) {
    const el = document.getElementById('tx-' + k);
    if (el) el.innerHTML = this.mineTxt(this.items[k], k);
  },

  highlight() {
    const els = $$('#prompter .pb');
    els.forEach((el, k) => { el.classList.toggle('now', k === this.pos); el.classList.toggle('past', k < this.pos); });
    if (els[this.pos]) els[this.pos].scrollIntoView({ block: 'center', behavior: 'smooth' });
    const n = this.items.length;
    const p = $('#rehProg'); if (p) p.style.width = (n ? (this.pos / n) * 100 : 0) + '%';
    const c = $('#rehCount'); if (c) c.textContent = `${Math.min(this.pos + 1, n)}/${n}`;
    this.status('');
  },

  status(html) { const el = $('#rehStatus'); if (el) el.innerHTML = html; },

  controls() {
    const pl = $('#rehPlay');
    if (pl) pl.innerHTML = icon(this.playing ? 'pause' : 'play');
    const row = $('#turnRow');
    if (!row) return;
    if (!this.turn) { row.hidden = true; row.innerHTML = ''; return; }
    row.hidden = false;
    row.innerHTML = this.cfg.answer === 'voice'
      ? `<button class="btn soft" data-act="rehHint">Pista</button><button class="btn soft" data-act="rehReveal">${icon('eye', 'sm')} Ver</button><button class="btn primary" data-act="rehDone">${icon('check', 'sm')} Listo</button>`
      : `<button class="btn soft" data-act="rehReveal">${icon('eye', 'sm')} Ver frase</button><button class="btn primary" data-act="rehDone">Siguiente ${icon('right', 'sm')}</button>`;
  },

  /* --- control del flujo (cada «run» se puede cancelar al pausar o saltar) --- */
  wait(ms) {
    return new Promise((res) => {
      const w = () => { clearTimeout(t); this.waiters.delete(w); res(false); };
      const t = setTimeout(() => { this.waiters.delete(w); res(true); }, ms);
      this.waiters.add(w);
    });
  },

  stopAll() {
    this.run++;
    const turn = this.turn;
    this.turn = null; // antes de parar el micrófono, para que no puntúe una frase a medias
    Voices.cancel();
    Voices.stopPrefetch();
    if (this.listener) { const l = this.listener; this.listener = null; l.stop(); }
    SR.stop();
    for (const w of [...this.waiters]) w();
    this.waiters.clear();
    if (turn) turn.resolve(false);
    this.controls();
  },

  async play() {
    if (this.playing || this.stopped) return;
    if (this.pos >= this.items.length) this.pos = 0;
    this.playing = true;
    const run = ++this.run;
    this.controls();
    this.highlight();
    while (run === this.run && this.pos < this.items.length) {
      await this.step(this.items[this.pos], run);
      if (run !== this.run) return;
      this.pos++;
      if (this.pos < this.items.length) this.highlight();
    }
    if (run === this.run) { this.playing = false; this.finish(); }
  },

  pause() { this.playing = false; this.stopAll(); this.status('En pausa'); },

  jump(k) {
    const was = this.playing;
    this.playing = false;
    this.stopAll();
    this.pos = clamp(k, 0, this.items.length - 1);
    this.highlight();
    if (was) this.play();
  },

  move(delta) { this.jump(this.pos + delta); },

  // Qué se dice en voz alta en el bloque i (o null si no suena)
  speechItem(i) {
    const s = this.s, b = s.blocks[i], o = this.cfg;
    if (b.type === 'scene') return o.readDir ? { text: b.text, role: 'narrator' } : null;
    if (b.type === 'action') return o.readDir ? { text: b.text.replace(/[()\[\]]/g, ''), role: 'narrator' } : null;
    if (Model.isMine(s, i)) return o.speakMine ? { text: spokenText(b.text), role: 'me', style: Voices.styleOf(b) } : null;
    return { text: spokenText(b.text), charId: b.chars[0], style: Voices.styleOf(b) };
  },

  async step(i, run) {
    const s = this.s, b = s.blocks[i];
    // mientras suena esta, se van preparando las siguientes (voces naturales)
    Voices.prefetch(s, this.items.slice(this.pos + 1, this.pos + 4).map((j) => this.speechItem(j)));
    const item = this.speechItem(i);
    if (b.type === 'scene' || b.type === 'action') {
      if (item) { this.status(`${icon('volume', 'sm')} Acotación`); await Voices.say(s, item); }
      else await this.wait(b.type === 'scene' ? 500 : 350);
      return;
    }
    if (!Model.isMine(s, i)) {
      this.status(`${icon('volume', 'sm')} Habla ${esc(Model.charName(s, b.chars))}`);
      if (TTS.supported || Voices.enabled()) await Voices.say(s, item);
      else await this.wait(Math.max(1500, countWords(b.text) * 380));
      if (run === this.run) await this.wait(220);
      return;
    }
    await this.myTurn(i, run);
  },

  myTurn(i, run) {
    const s = this.s, b = s.blocks[i], o = this.cfg, k = this.pos;
    const target = wordsOf(b.text);
    return new Promise((resolve) => {
      const turn = { k, i, revealed: new Set(), score: null, matched: null, finished: false, resolve };
      this.turn = turn;
      this.controls();

      const finish = async (withScore) => {
        if (turn.finished || this.turn !== turn) return;
        turn.finished = true;
        if (this.listener) { const l = this.listener; this.listener = null; l.stop(); }
        this.done.add(k);
        if (withScore && turn.matched) {
          this.results.set(k, { score: turn.score, matched: turn.matched });
          Model.rate(s, b, Model.gradeFromScore(turn.score), turn.score);
          saveScript(s);
          const sc = document.getElementById('sc-' + k);
          if (sc) { const pct = Math.round(turn.score * 100); sc.textContent = pct + '%'; sc.className = 'score pill ' + pctClass(pct); }
        }
        this.updateMine(k);
        this.status('');
        if (o.speakMine && (TTS.supported || Voices.enabled())) await Voices.say(s, this.speechItem(i));
        else await this.wait(withScore ? 700 : 300);
        if (this.turn === turn) { this.turn = null; this.controls(); }
        resolve(true);
      };
      turn.finish = finish;

      if (o.answer === 'voice' && canListen()) {
        // escucha hasta que dices la frase: va entendiendo mientras hablas y, al callarte, la comprueba sola
        const listen = (again) => {
          let lastLvl = '', live = '', lv = 0, speaking = false;
          const show = () => {
            if (this.turn !== turn) return;
            const html = lv < 0 ? `${icon('hourglass', 'sm')} Comprobando lo que has dicho…`
              : `<span class="mic-dot"></span> ${live ? esc(live.slice(-70)) : speaking ? 'Te oigo…' : again ? 'Sigo escuchando… di tu frase' : 'Tu turno: te escucho…'}<span class="vu"><i style="width:${Math.round(Math.max(0, lv) * 10) * 10}%"></i></span>`;
            if (html !== lastLvl) { lastLvl = html; this.status(html); }
          };
          show();
          this.listener = listenLine(target, {
            lang: S().lang,
            onUpdate: (al, txt) => {
              if (this.turn !== turn) return;
              turn.score = al.score;
              turn.matched = al.matched;
              for (const w of al.matched) turn.revealed.add(w);
              this.updateMine(k);
              live = txt;
              show();
            },
            onLevel: (l, sp) => { lv = l; speaking = sp; show(); },
            onDone: (al, txt, reason) => {
              this.listener = null;
              if (this.turn !== turn) return;
              // no has dicho nada todavía: se sigue escuchando
              if (reason === 'nothing') { listen(true); return; }
              if (reason === 'manual' && !txt && !al.unscored) { finish(false); return; }
              onHeard(al, reason);
            },
            onError,
          });
        };
        const onError = (err) => {
          this.listener = null;
          toast(micErrorMsg(err), 4000);
          o.answer = 'tap';
          this.status('Tu turno: di tu frase y toca «Siguiente»');
          this.controls();
        };
        const onHeard = (al) => {
          if (al.unscored) {
            // te oyó, pero no pudo entender las palabras: se muestra la frase para que compruebes
            if (!this.warnedKey && !Transcriber.available()) { this.warnedKey = true; toast('Te oigo, pero este navegador no me deja entender las palabras. Usa Chrome o pon tu clave de Gemini en Ajustes para que te puntúe.', 6000); }
            finish(false);
            return;
          }
          turn.score = al.score;
          turn.matched = al.matched;
          finish(true);
        };
        listen(false);
      } else if (o.answer === 'auto') {
        const ms = Math.max(1800, target.length * 430 + 1300);
        this.status(`${icon('hourglass', 'sm')} Tu turno: di tu frase<div class="timer-bar" style="width:140px"><i id="tBar"></i></div>`);
        requestAnimationFrame(() => { const t = $('#tBar'); if (t) { t.style.transition = `width ${ms}ms linear`; t.style.width = '100%'; } });
        this.wait(ms).then((ok) => { if (ok && run === this.run) finish(false); });
      } else {
        this.status(`${icon('hand', 'sm')} Tu turno: di tu frase y toca «Siguiente»`);
      }
    });
  },

  revealWords(all) {
    const t = this.turn;
    if (!t) return;
    const n = wordsOf(this.s.blocks[t.i].text).length;
    for (let w = 0; w < n; w++) {
      if (t.revealed.has(w)) continue;
      t.revealed.add(w);
      if (!all) break;
    }
    this.updateMine(t.k);
  },

  finish() {
    this.status('');
    const s = this.s;
    const scored = [...this.results.values()];
    const avg = scored.length ? Math.round((scored.reduce((a, r) => a + r.score, 0) / scored.length) * 100) : null;
    const mineK = this.items.map((i, k) => [i, k]).filter(([i]) => Model.isMine(s, i));
    const rows = mineK.map(([i, k]) => {
      const r = this.results.get(k);
      const pct = r ? Math.round(r.score * 100) : null;
      const t = s.blocks[i].text;
      return `<div class="row flat"><span class="grow" style="font-size:14.5px">${esc(t.length > 110 ? t.slice(0, 110) + '…' : t)}</span>${pct != null ? `<span class="pill ${pctClass(pct)}">${pct}%</span>` : ''}</div>`;
    }).join('');
    this.stop();
    const title = avg == null ? '¡Escena terminada!' : avg >= 90 ? '¡Escena clavada!' : avg >= 60 ? '¡Muy bien!' : 'Seguimos ensayando';
    mount(`
    <div class="sess-top"><button class="icon-btn" data-act="sessClose" aria-label="Terminar">${icon('close')}</button><div class="prog"><i style="width:100%"></i></div><span class="count"></span></div>
    <main class="sess"><div class="done">
      <div class="ring big" style="--p:${avg == null ? 100 : avg}"><div>${avg != null ? `<b>${avg}%</b><small>precisión</small>` : icon('check', 'lg')}</div></div>
      <h2>${title}</h2>
      <p class="muted">${plural(mineK.length, 'frase tuya', 'frases tuyas')} en este ensayo.</p>
      <div class="btn-col mt">
        <button class="btn primary big" data-act="rehAgain">${icon('reset')} Repetir</button>
        <button class="btn ghost" data-act="sessClose">Volver</button>
      </div></div>
      ${rows ? `<h3 class="section-title">Tus frases</h3><div class="list">${rows}</div>` : ''}
    </main>`);
  },
};

ACT.rehOpt = (el) => {
  const k = el.dataset.k;
  Reh.cfg[k] = el.dataset.v;
  el.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === el));
  if (k === 'answer') { const h = $('#ansHelp'); if (h) h.textContent = ANSWER_HELP[el.dataset.v]; }
};
CHANGE.rehOptSw = (el) => { Reh.cfg[el.dataset.k] = el.checked; };
ACT.rehStart = () => Reh.start();
ACT.rehToggle = () => { Voices.unlock(); if (Reh.playing) Reh.pause(); else Reh.play(); };
ACT.rehPrepare = () => Reh.prepareVoices();
ACT.rehNext = () => Reh.move(1);
ACT.rehPrev = () => Reh.move(-1);
ACT.rehDone = () => {
  // «Listo» termina de escuchar y puntúa lo que has dicho
  if (Reh.turn && Reh.listener) { Reh.listener.finishNow(); return; }
  if (Reh.turn && Reh.turn.finish) Reh.turn.finish(Reh.cfg.answer === 'voice');
};
ACT.rehReveal = () => Reh.revealWords(true);
ACT.rehHint = () => Reh.revealWords(false);
ACT.rehAgain = () => Reh.start();

/* ============ PROGRESO ============ */
function viewProgress(s) {
  const I = Model.ix(s);
  if (!s.me.length) {
    mount(`${scriptHeroHTML(s)}<main class="page">${noCharBanner(s)}</main>${tabbarHTML(s, 'progress')}`);
    return;
  }
  const m = Model.mastery(s);
  const streak = Model.streak(s);
  const share = I.totalWords ? Math.round((I.myWords / I.totalWords) * 100) : 0;
  // escenas «hoja» (sin subescenas dentro) para contar en cuántas sales
  const leaf = I.scenes.filter((sc) => !I.scenes.some((o) => o !== sc && o.start > sc.start && o.end <= sc.end && o.level > sc.level));
  const myScenes = leaf.filter((sc) => sc.mine > 0);
  const days = [];
  const d = new Date();
  d.setDate(d.getDate() - 27);
  for (let k = 0; k < 28; k++) { days.push(s.log.days[todayKey(d)] || 0); d.setDate(d.getDate() + 1); }
  const heat = (x) => (x <= 0 ? '' : x < 300 ? 'l1' : x < 1200 ? 'l2' : 'l3');
  const hardest = I.mine.map((i) => [i, s.prog[s.blocks[i].id]]).filter(([, p]) => p && p.x > 0).sort((a, b) => b[1].x - a[1].x || a[1].l - b[1].l).slice(0, 5);
  const chars = s.characters.map((c) => [c, (I.counts[c.id] || { lines: 0 }).lines]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const maxL = chars.length ? chars[0][1] : 1;
  const stat = (ic, v, l) => `<div class="stat"><div class="si">${icon(ic)}</div><div class="v">${v}</div><div class="l">${l}</div></div>`;

  const sceneRows = I.scenes.filter((sc) => sc.mine > 0).map((sc) => {
    const mm = Model.mastery(s, Model.scopeMine(s, 'sc:' + sc.id));
    return `<button class="row flat" data-act="studyScene" data-sc="${sc.id}" style="${sc.level === 1 ? '' : 'padding-left:28px'}">
      <span class="grow"><b style="${sc.level === 1 ? '' : 'font-weight:600'}">${esc(sc.title)}</b><small>${plural(sc.mine, 'frase', 'frases')} · ${mm.pct}% aprendido</small></span><span class="chev">${icon('right', 'sm')}</span>
      <div class="meter"><i class="ok" style="width:${(mm.ms / mm.n) * 100}%"></i><i class="warn" style="width:${(mm.lr / mm.n) * 100}%"></i></div></button>`;
  }).join('');

  mount(`
  ${scriptHeroHTML(s)}
  <main class="page">
    <div class="card prog-head">
      <div class="ring big" style="--p:${m.pct}"><div><b>${m.pct}%</b><small>aprendido</small></div></div>
      <div class="legend">
        <span><i class="dot" style="--c:var(--ok)"></i>${plural(m.ms, 'dominada', 'dominadas')}</span>
        <span><i class="dot" style="--c:var(--warn)"></i>${m.lr} aprendiendo</span>
        <span><i class="dot" style="--c:var(--surface-3)"></i>${m.nw} sin estudiar</span>
      </div>
    </div>
    <div class="stat-grid mt">
      ${stat('note', I.mine.length, 'frases tuyas')}
      ${stat('words', I.myWords, 'palabras')}
      ${stat('chart', share + '%', 'del texto')}
      ${stat('layers', leaf.length ? `${myScenes.length}/${leaf.length}` : '—', 'escenas')}
      ${stat('flame', streak, streak === 1 ? 'día seguido' : 'días seguidos')}
      ${stat('clock', fmtMinutes(s.log.secs || 0), 'ensayando')}
    </div>
    <h3 class="section-title">Últimas 4 semanas</h3>
    <div class="card"><div class="heat">${days.map((x) => `<i class="${heat(x)}" title="${Math.round(x / 60)} min"></i>`).join('')}</div>
      <p class="small muted mt-s">Cada cuadro es un día. Cuanto más intenso, más rato ensayaste.</p></div>
    ${sceneRows ? `<h3 class="section-title">Por escenas</h3><div class="list scene-prog">${sceneRows}</div>` : ''}
    ${hardest.length ? `<h3 class="section-title">Las que más te cuestan</h3><div class="list">${hardest.map(([i, p]) =>
      `<div class="row flat"><span class="grow" style="font-size:14.5px">${esc(s.blocks[i].text.slice(0, 120))}${s.blocks[i].text.length > 120 ? '…' : ''}</span><span class="pill bad">${p.x} ${p.x === 1 ? 'fallo' : 'fallos'}</span></div>`).join('')}</div>
      <button class="btn primary block mt-s" data-act="startMode" data-mode="cards" data-scope="weak" data-order="seq">Practicar estas frases</button>` : ''}
    <h3 class="section-title">Reparto</h3>
    <div class="card char-bars">${chars.map(([c, n]) => `<div class="cb"><span>${esc(c.name)}</span><div class="meter"><i style="width:${(n / maxL) * 100}%;background:${s.me.includes(c.id) ? 'var(--hl)' : c.color}"></i></div><b>${n}</b></div>`).join('')}
      <p class="small muted">Intervenciones de cada personaje.</p></div>
  </main>
  ${tabbarHTML(s, 'progress')}`);
}

ACT.studyScene = (el) => { const s = App.cur; s.ui.scope = 'sc:' + el.dataset.sc; saveScript(s); go(`/s/${s.id}/study`, true); };
