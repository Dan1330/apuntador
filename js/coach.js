'use strict';
/*
 * Consejos de interpretación con Claude.
 * Usa la clave de cada persona (Ajustes), que se guarda solo en este dispositivo y nunca va en el código.
 * Se envían a Anthropic la escena alrededor de la frase, tu personaje y tu pregunta; nada más.
 */
const Coach = (() => {
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
  const MODEL = 'claude-opus-5-5';
  const SYSTEM = `Eres un director de escena y profesor de interpretación con mucha experiencia en teatro en español.
Un actor o actriz está preparando su papel y te pide consejo para decir una frase concreta de su texto.
Responde siempre en español, de tú, con un tono cercano y práctico, como en un ensayo.
Basa tus consejos en la escena que se te da: qué quiere el personaje en ese momento (objetivo), qué hay debajo de las palabras (subtexto), cómo viene de la réplica anterior y adónde lleva.
Da indicaciones que se puedan probar ya: intención, emoción, ritmo y pausas, palabras que conviene subrayar, respiración, volumen, mirada o gesto.
Propón también una o dos formas distintas de decirla para que pruebe cuál le funciona.
No reescribas el texto del autor. Si la obra es conocida, puedes apoyarte en lo que sabes de ella y de su personaje.
Sé breve: unas 200 palabras, con títulos cortos en negrita y listas. Sin introducciones ni despedidas.`;

  let sdk = null;
  const key = () => (S().claudeKey || '').trim();
  const available = () => !!key();

  async function client() {
    if (!sdk) {
      try { sdk = (await import(SDK_URL)).default; } catch (e) { throw Object.assign(new Error('sdk'), { msg: 'No he podido cargar Claude. ¿Tienes conexión?' }); }
    }
    return new sdk({ apiKey: key(), dangerouslyAllowBrowser: true, maxRetries: 2 });
  }

  // Mensaje claro para cada tipo de fallo
  function errorMsg(e) {
    if (e && e.msg) return e.msg;
    if (!sdk) return 'No se pudo hablar con Claude.';
    if (e instanceof sdk.AuthenticationError) return 'Tu clave de Claude no es válida. Revísala en Ajustes.';
    if (e instanceof sdk.PermissionDeniedError) return 'Tu clave de Claude no tiene permiso para usar este modelo.';
    if (e instanceof sdk.RateLimitError) return 'Has hecho muchas consultas seguidas. Espera un momento y vuelve a probar.';
    if (e instanceof sdk.BadRequestError) return 'Claude no ha aceptado la consulta: ' + (e.message || '') + ' (si dice «credit balance», recarga saldo en tu cuenta de Anthropic).';
    if (e instanceof sdk.APIConnectionError) return 'Sin conexión con Claude. Comprueba internet.';
    if (e instanceof sdk.APIError && e.status >= 500) return 'Claude está saturado ahora mismo. Prueba en un momento.';
    if (e instanceof sdk.APIError) return `Error de Claude (${e.status}): ${e.message}`;
    return 'No se pudo hablar con Claude.';
  }

  /*
   * Pregunta a Claude y va entregando el texto mientras lo escribe.
   * messages es el historial (se añade la respuesta completa al final, para poder seguir preguntando).
   */
  async function ask(messages, { onText, signal } = {}) {
    const c = await client();
    const stream = c.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      // si el modelo rechaza la consulta, la API la repite sola con otro modelo
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages,
    }, { signal });
    let txt = '';
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') { txt += ev.delta.text; if (onText) onText(txt); }
    }
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw Object.assign(new Error('refusal'), { msg: 'Claude no ha querido responder a esta consulta.' });
    messages.push({ role: 'assistant', content: msg.content });
    const final = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return final || txt;
  }

  // La escena alrededor de la frase, como texto de guion
  function sceneText(s, i) {
    let a = i;
    while (a > 0 && s.blocks[a].type !== 'scene' && i - a < 40) a--;
    const z = Math.min(s.blocks.length - 1, i + 4);
    const line = (b, k) => {
      const t = b.type === 'dialogue' ? `${Model.charName(s, b.chars).toUpperCase()}${b.paren ? ' ' + b.paren : ''}: ${b.text}`
        : b.type === 'scene' ? `[${b.text}]` : `(${b.text})`;
      return k === i ? `>>> ${t} <<<` : t;
    };
    let out = '';
    for (let k = a; k <= z; k++) out += line(s.blocks[k], k) + '\n';
    return out.length > 9000 ? '…' + out.slice(-9000) : out;
  }

  function firstPrompt(s, i, question) {
    const b = s.blocks[i];
    const who = Model.charName(s, b.chars);
    return `Obra: «${s.title}»${s.author ? ` de ${s.author}` : ''}
Mi personaje: ${who}

Escena (la frase que preparo va marcada con >>> <<<):
${sceneText(s, i)}
Frase: «${b.text}»${b.note ? `\nMi nota de ensayo: ${b.note}` : ''}

${question ? `Mi duda: ${question}` : '¿Cómo me aconsejas decir esta frase?'}`;
  }

  // Markdown sencillo → HTML seguro (negritas, títulos y listas)
  function md(t) {
    const inline = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    let html = '', list = false;
    for (const raw of String(t).split('\n')) {
      const l = raw.trim();
      const li = l.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
      if (li) { if (!list) { html += '<ul>'; list = true; } html += `<li>${inline(li[1])}</li>`; continue; }
      if (list) { html += '</ul>'; list = false; }
      if (!l) continue;
      const h = l.match(/^#{1,4}\s+(.*)/);
      html += h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(l)}</p>`;
    }
    return html + (list ? '</ul>' : '');
  }

  // Hoja con el consejo de una frase: empieza sola y deja seguir preguntando
  function open(s, i) {
    const b = s.blocks[i];
    if (!b || b.type !== 'dialogue') return;
    const who = Model.charName(s, b.chars);
    const short = b.text.length > 120 ? b.text.slice(0, 120) + '…' : b.text;
    if (!available()) {
      const el = Sheet.open(`<div class="sheet-body"><h3>${icon('sparkle', 'sm')} Consejo de interpretación</h3>
        <p class="muted">Para que Claude te dé consejos sobre cómo decir tus frases, pon tu clave de Claude en <b>Ajustes → Consejos de interpretación</b>.</p>
        <div class="sheet-actions"><button class="btn soft" data-r="0">Ahora no</button><button class="btn primary" data-r="1">Ir a Ajustes</button></div></div>`);
      el.querySelector('[data-r="0"]').onclick = () => Sheet.close();
      el.querySelector('[data-r="1"]').onclick = async () => { await Sheet.close(); go('/settings'); };
      return;
    }
    let ctl = null, last = '', busy = false;
    const messages = [];
    const el = Sheet.open(`<div class="sheet-body coach"><h3>${icon('sparkle', 'sm')} Consejo de interpretación</h3>
      <p class="sheet-sub"><b>${esc(who)}</b> · «${esc(short)}»</p>
      <div class="coach-out" id="cOut" aria-live="polite"></div>
      <label class="field mt-s"><span id="cAskL">¿Quieres preguntarle algo más?</span><input type="text" id="cAsk" placeholder="Ej.: ¿la grito o la susurro?" autocomplete="off"></label>
      <div class="sheet-actions"><button class="btn soft" id="cSave" disabled>${icon('note', 'sm')} Guardar en la nota</button><button class="btn primary" id="cGo" disabled>Preguntar</button></div>
      <p class="small muted center">Claude · se envía la escena a Anthropic con tu clave</p></div>`,
    { onClose: () => { if (ctl) ctl.abort(); } });
    const out = el.querySelector('#cOut'), inp = el.querySelector('#cAsk'), goBtn = el.querySelector('#cGo'), save = el.querySelector('#cSave');

    const run = async (question) => {
      if (busy) return;
      busy = true;
      goBtn.disabled = save.disabled = true;
      messages.push({ role: 'user', content: messages.length ? question : firstPrompt(s, i, question) });
      const box = document.createElement('div');
      box.className = 'coach-msg';
      if (messages.length > 1) out.insertAdjacentHTML('beforeend', `<p class="coach-q">${esc(question)}</p>`);
      box.innerHTML = `<p class="muted">${icon('hourglass', 'sm')} Pensando cómo la diría…</p>`;
      out.appendChild(box);
      box.scrollIntoView({ block: 'nearest' });
      ctl = new AbortController();
      try {
        last = await ask(messages, { signal: ctl.signal, onText: (t) => { box.innerHTML = md(t); } });
        box.innerHTML = md(last);
        save.disabled = false;
      } catch (e) {
        if (ctl.signal.aborted) return;
        messages.pop(); // la pregunta no tuvo respuesta: se puede repetir
        box.innerHTML = `<p class="coach-err">${esc(errorMsg(e))}</p>`;
      } finally {
        ctl = null;
        busy = false;
        goBtn.disabled = false;
      }
    };
    goBtn.onclick = () => {
      const q = inp.value.trim();
      if (!q && messages.length) { inp.focus(); return; }
      inp.value = '';
      run(q);
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') goBtn.click(); });
    save.onclick = () => {
      if (!last) return;
      b.note = (b.note ? b.note + '\n\n' : '') + last.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
      saveScript(s);
      save.disabled = true;
      toast('Guardado en la nota de esta frase');
    };
    run('');
  }

  // Prueba de la clave desde Ajustes
  async function test() {
    const c = await client();
    const r = await c.messages.create({ model: MODEL, max_tokens: 2000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Responde solo: «Listo para ensayar».' }] });
    return r.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  }

  return { available, open, test, errorMsg };
})();
