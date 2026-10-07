'use strict';
/* Lector del guion: maquetación, subrayado de tus frases, notas y edición */

function scriptClasses(s, print = false) {
  const st = S();
  const style = st.style === 'auto' ? (s.format === 'screenplay' ? 'screen' : 'theatre') : st.style;
  return `script st-${style} ff-${print ? 'serif' : st.font} ${st.showNotes ? '' : 'hide-notes'} ${st.charColors ? '' : 'no-colors'}`;
}

function seedOf(b) {
  let h = 7;
  for (const c of String(b.id)) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// ¿El primer bloque es la portada de la obra (título + autor)?
function isTitlePage(s, b) {
  const lines = b.text.split('\n');
  const n = (t) => deaccent(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return lines.length <= 4 && n(lines[0]) !== '' && n(lines[0]) === n(s.title || '');
}

function speechPlain(text) {
  return segments(text).map((g) => (g.dir ? `<i class="dir">${esc(g.s)}</i>` : esc(g.s))).join('');
}

function whoHTML(s, b, mine) {
  return b.chars.map((id) => {
    const c = Model.charOf(s, id) || { name: '?', color: '#888' };
    const isMe = s.me.includes(id) || (mine && c.group);
    return `<span class="dot" style="--c:${c.color}"></span><span class="${isMe ? 'me-name' : ''}">${esc(c.name)}</span>`;
  }).join('<span class="muted"> y </span>');
}

function blockHTML(s, b, i, { mineView = 'full', revealed = null } = {}) {
  const note = b.note ? `<div class="note">${esc(b.note)}</div>` : '';
  const star = b.star ? `<span class="star-ic">${icon('star')}</span>` : '';
  if (b.type === 'scene') return `<h3 class="b b-scene lvl${b.level === 1 ? 1 : 2}" id="b-${b.id}" data-i="${i}">${esc(b.text)}</h3>${note ? `<div class="b">${note}</div>` : ''}`;
  if (b.type === 'action' && i === 0 && isTitlePage(s, b)) {
    const [first, ...rest] = b.text.split('\n');
    return `<div class="b b-titlepage" id="b-${b.id}" data-i="${i}"><h1>${esc(first)}</h1>${rest.map((l) => `<p>${esc(l)}</p>`).join('')}${note}</div>`;
  }
  if (b.type === 'action') return `<div class="b b-act" id="b-${b.id}" data-i="${i}">${esc(b.text)}${star}${note}</div>`;
  const mine = Model.isMine(s, i);
  let txt;
  if (mine) {
    const hidden = mineView !== 'full' && !(revealed && revealed.has(i));
    if (!hidden) txt = `<span class="hl">${speechPlain(b.text)}</span>`;
    else if (mineView === 'ini') txt = `<span class="hl">${renderSpeech(b.text, { level: 3, seed: seedOf(b) })}</span>`;
    else txt = `<span class="hidden-line">Tu frase · ${plural(countWords(b.text), 'palabra', 'palabras')} — toca para verla</span>`;
  } else txt = speechPlain(b.text);
  return `<div class="b b-dia ${mine ? 'mine' : ''}" id="b-${b.id}" data-i="${i}">
    <div class="who">${whoHTML(s, b, mine)}${b.paren ? `<span class="par">${esc(b.paren)}</span>` : ''}</div>
    <div class="txt">${txt}</div>${star}${note}</div>`;
}

/* ---------- qué bloques se ven según el filtro ---------- */
function visibleIndices(s, filter) {
  const I = Model.ix(s);
  const n = s.blocks.length;
  if (filter === 'scenes') {
    if (!I.scenes.length) return [...Array(n).keys()];
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = s.blocks[i];
      if (b.type === 'scene') {
        const sc = I.scenes.find((x) => x.start === i && x.id !== '_start');
        if (sc && sc.mine > 0) out.push(i);
        continue;
      }
      const k = I.sceneOf[i];
      if (k < 0 || I.scenes[k].mine > 0) out.push(i);
    }
    return out;
  }
  if (filter === 'cues') {
    const set = new Set();
    for (const m of I.mine) {
      set.add(m);
      for (let j = m - 1; j >= 0; j--) {
        const b = s.blocks[j];
        if (b.type === 'scene') { set.add(j); break; }
        if (b.type === 'dialogue') { set.add(j); break; }
      }
      const k = I.sceneOf[m];
      if (k >= 0 && I.scenes[k].id !== '_start') set.add(I.scenes[k].start);
    }
    return [...set].sort((a, b) => a - b);
  }
  return [...Array(n).keys()];
}

function readerBodyHTML(s) {
  const st = S();
  const filter = App.readerFilter || 'all';
  const idx = visibleIndices(s, filter);
  if (!idx.length) return `<div class="empty">${icon('book')}<p>No hay nada que mostrar con este filtro.</p></div>`;
  const opts = { mineView: st.mineView, revealed: App.revealed };
  let html = '';
  let prev = -1;
  for (const i of idx) {
    if (filter === 'cues' && prev >= 0 && i > prev + 1 && s.blocks[i].type !== 'scene') html += '<p class="gap-sep">· · ·</p>';
    html += blockHTML(s, s.blocks[i], i, opts);
    prev = i;
  }
  return html;
}

/* ---------- vista ---------- */
function viewReader(s, q) {
  const st = S();
  const I = Model.ix(s);
  App.revealed = App.revealedFor === s.id ? App.revealed : new Set();
  App.revealedFor = s.id;
  const f = App.readerFilter || 'all';
  const mvLabel = { full: 'Visibles', ini: 'Iniciales', hid: 'Ocultas' }[st.mineView];
  mount(`
  ${scriptTop(s, `<button class="icon-btn" data-act="search" aria-label="Buscar">${icon('search')}</button>
    <button class="icon-btn" data-act="scenes" aria-label="Escenas">${icon('list')}</button>
    <button class="icon-btn" data-act="readerOpts" aria-label="Opciones de lectura"><span class="txt-ic">Aa</span></button>`)}
  ${s.me.length ? '' : `<div style="padding:12px 16px 0;max-width:760px;margin:0 auto">${noCharBanner(s)}</div>`}
  <div class="filterbar">
    <button class="chip ${f === 'all' ? 'on' : ''}" data-act="rFilter" data-v="all">Todo</button>
    ${I.scenes.length && s.me.length ? `<button class="chip ${f === 'scenes' ? 'on' : ''}" data-act="rFilter" data-v="scenes">Mis escenas</button>` : ''}
    ${s.me.length ? `<button class="chip ${f === 'cues' ? 'on' : ''}" data-act="rFilter" data-v="cues">Solo réplicas</button>` : ''}
    ${s.me.length ? `<button class="chip" data-act="cycleMine">${icon(st.mineView === 'full' ? 'eye' : 'eyeoff', 'sm')} Mis frases: ${mvLabel}</button>` : ''}
  </div>
  <div class="reader-wrap ${I.scenes.length ? '' : 'solo'}">
    ${I.scenes.length ? `<aside class="scene-side" aria-label="Escenas"><h4>Escenas</h4>${I.scenes.map((sc) =>
      `<button class="${sc.level === 1 ? '' : 'sub'}" data-act="sideScene" data-sc="${sc.id}"><span class="grow">${esc(sc.title)}</span>${sc.mine ? `<span class="pill brand">${sc.mine}</span>` : ''}</button>`).join('')}</aside>` : ''}
    <main class="${scriptClasses(s)}" id="scriptView">${readerBodyHTML(s)}</main>
  </div>
  ${I.mine.length ? `<div class="jump"><button data-act="jumpMine" data-dir="-1" aria-label="Mi frase anterior">${icon('up')}</button><button class="hl-btn" data-act="jumpMine" data-dir="1" aria-label="Mi siguiente frase">${icon('down')}</button></div>` : ''}
  ${tabbarHTML(s, 'read')}`);

  const view = $('#scriptView');
  view.addEventListener('click', (e) => onBlockTap(s, e));

  // recuperar la posición de lectura
  const target = q.get('b') || (App.firstOpen === s.id ? null : s.ui.pos);
  if (target) {
    const el = document.getElementById('b-' + target);
    if (el) { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -8); if (q.get('b')) flash(el); }
  }
  if (App.firstOpen === s.id) {
    App.firstOpen = null;
    setTimeout(() => toast('Tus frases están subrayadas. Usa las flechas para saltar de una a otra.', 5000), 400);
  }

  const onScroll = debounce(() => {
    const el = firstVisibleBlock();
    if (el && s.blocks[el.dataset.i]) { s.ui.pos = s.blocks[el.dataset.i].id; saveScript(s); }
  }, 500);
  window.addEventListener('scroll', onScroll, { passive: true });
  App.cleanup = () => { window.removeEventListener('scroll', onScroll); onScroll.flush(); };
  App.onSettings = () => refreshReader(s);
}

function refreshReader(s) {
  const view = $('#scriptView');
  if (!view) return;
  const anchor = firstVisibleBlock();
  const id = anchor && s.blocks[anchor.dataset.i] ? s.blocks[anchor.dataset.i].id : null;
  const off = anchor ? anchor.getBoundingClientRect().top : 0;
  view.className = scriptClasses(s);
  view.innerHTML = readerBodyHTML(s);
  const chip = $('[data-act="cycleMine"]');
  if (chip) chip.innerHTML = `${icon(S().mineView === 'full' ? 'eye' : 'eyeoff', 'sm')} Mis frases: ${{ full: 'Visibles', ini: 'Iniciales', hid: 'Ocultas' }[S().mineView]}`;
  if (id) { const el = document.getElementById('b-' + id); if (el) window.scrollBy(0, el.getBoundingClientRect().top - off); }
}

function firstVisibleBlock() {
  const els = $$('#scriptView .b[data-i]');
  let lo = 0, hi = els.length - 1, ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (els[mid].getBoundingClientRect().bottom > 72) { ans = els[mid]; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

function scrollToBlock(s, id, { smooth = true, doFlash = true } = {}) {
  let el = document.getElementById('b-' + id);
  if (!el && (App.readerFilter || 'all') !== 'all') { App.readerFilter = 'all'; refreshReader(s); el = document.getElementById('b-' + id); $$('[data-act="rFilter"]').forEach((c) => c.classList.toggle('on', c.dataset.v === 'all')); }
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  if (doFlash) flash(el);
}

function onBlockTap(s, e) {
  if (String(window.getSelection ? window.getSelection() : '').length > 0) return;
  const el = e.target.closest('.b[data-i]');
  if (!el) return;
  const i = Number(el.dataset.i);
  const st = S();
  if (Model.isMine(s, i) && st.mineView !== 'full' && !App.revealed.has(i)) {
    const w = e.target.closest('.w.ini');
    if (w && !w.classList.contains('rev')) { w.classList.add('rev'); return; }
    App.revealed.add(i);
    el.outerHTML = blockHTML(s, s.blocks[i], i, { mineView: st.mineView, revealed: App.revealed });
    return;
  }
  blockMenu(s, i);
}

ACT.rFilter = (el) => {
  App.readerFilter = el.dataset.v;
  $$('[data-act="rFilter"]').forEach((c) => c.classList.toggle('on', c === el));
  refreshReader(App.cur);
  if (el.dataset.v !== 'all') window.scrollTo(0, 0);
};

ACT.cycleMine = () => {
  const order = ['full', 'ini', 'hid'];
  S().mineView = order[(order.indexOf(S().mineView) + 1) % 3];
  App.revealed = new Set();
  saveSettings();
  refreshReader(App.cur);
  toast({ full: 'Tus frases se ven completas', ini: 'Tus frases se ven solo con las iniciales', hid: 'Tus frases están ocultas: toca para verlas' }[S().mineView]);
};

ACT.jumpMine = (el) => {
  const dir = Number(el.dataset.dir);
  const els = $$('#scriptView .b-dia.mine');
  if (!els.length) return;
  const vh = window.innerHeight;
  const mid = vh * 0.42;
  let target = null;
  if (dir > 0) target = els.find((x) => x.getBoundingClientRect().top > mid + 10);
  else target = els.slice().reverse().find((x) => x.getBoundingClientRect().top < mid - 10);
  if (!target) { toast(dir > 0 ? 'Era tu última frase' : 'Es tu primera frase'); return; }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  flash(target);
};

/* ---------- escenas ---------- */
function goToScene(s, id) {
  if (id === '_start') window.scrollTo({ top: 0, behavior: 'smooth' });
  else scrollToBlock(s, id, { doFlash: false });
}
ACT.sideScene = (el) => goToScene(App.cur, el.dataset.sc);

ACT.scenes = () => {
  const s = App.cur;
  const I = Model.ix(s);
  if (!I.scenes.length) { toast('Este guion no tiene escenas marcadas'); return; }
  const rows = I.scenes.map((sc) => {
    const m = sc.mine ? Model.mastery(s, Model.scopeMine(s, 'sc:' + sc.id)).pct : null;
    return `<button class="row flat" data-sc="${sc.id}" style="padding-left:${sc.level === 1 ? 20 : 38}px">
      <span class="grow"><b style="${sc.level === 1 ? '' : 'font-weight:600'}">${esc(sc.title)}</b><small>${sc.mine ? plural(sc.mine, 'frase tuya', 'frases tuyas') : 'No sales'}</small></span>
      ${m != null ? `<span class="pill ${m >= 80 ? 'ok' : 'brand'}">${m}%</span>` : ''}</button>`;
  }).join('');
  const el = Sheet.open(`<div class="sheet-body" style="padding-bottom:4px"><h3>Escenas</h3></div><div class="list">${rows}</div>`);
  el.querySelectorAll('[data-sc]').forEach((b) => {
    b.onclick = async () => { await Sheet.close(); goToScene(s, b.dataset.sc); };
  });
};

/* ---------- búsqueda ---------- */
function normIdx(text) {
  let norm = '';
  const map = [];
  for (let k = 0; k < text.length; k++) {
    const n = deaccent(text[k]).toLowerCase();
    for (const ch of n) { norm += ch; map.push(k); }
  }
  return { norm, map };
}

ACT.search = () => {
  const s = App.cur;
  const el = Sheet.open(`<div class="sheet-body"><h3>Buscar en el guion</h3><input class="input" id="qIn" type="search" placeholder="Palabra o frase…" autocomplete="off"></div><div class="list" id="qRes"></div>`);
  const inp = el.querySelector('#qIn');
  const res = el.querySelector('#qRes');
  setTimeout(() => inp.focus(), 260);
  inp.addEventListener('input', debounce(() => {
    const q = deaccent(inp.value.trim()).toLowerCase();
    if (q.length < 2) { res.innerHTML = ''; return; }
    const out = [];
    for (let i = 0; i < s.blocks.length && out.length < 60; i++) {
      const b = s.blocks[i];
      const { norm, map } = normIdx(b.text);
      const k = norm.indexOf(q);
      const who = b.type === 'dialogue' ? Model.charName(s, b.chars) : b.type === 'scene' ? 'Escena' : 'Acotación';
      if (k < 0 && !(b.type === 'dialogue' && deaccent(who).toLowerCase().includes(q))) continue;
      let snip;
      if (k >= 0) {
        const a = map[k], z = map[Math.min(map.length - 1, k + q.length - 1)] + 1;
        const from = Math.max(0, a - 40), to = Math.min(b.text.length, z + 60);
        snip = (from > 0 ? '…' : '') + esc(b.text.slice(from, a)) + '<mark>' + esc(b.text.slice(a, z)) + '</mark>' + esc(b.text.slice(z, to)) + (to < b.text.length ? '…' : '');
      } else snip = esc(b.text.slice(0, 100));
      out.push(`<button class="row flat" data-bid="${b.id}"><span class="grow"><b class="small" style="text-transform:uppercase;letter-spacing:.08em;font-size:12px">${esc(who)}${Model.isMine(s, i) ? ' · tuya' : ''}</b><small style="color:var(--text);font-size:14.5px">${snip}</small></span></button>`);
    }
    res.innerHTML = out.length ? out.join('') : '<p class="empty small">Sin resultados</p>';
  }, 160));
  res.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bid]');
    if (!b) return;
    await Sheet.close();
    scrollToBlock(s, b.dataset.bid);
  });
};

/* ---------- opciones de lectura ---------- */
ACT.readerOpts = () => {
  const st = S();
  Sheet.open(`<div class="sheet-body"><h3>Lectura</h3>
    <div class="field"><span>Tamaño de letra</span><div class="range-row"><input type="range" min="14" max="30" step="1" value="${st.fontSize}" data-input="fontSize"><output class="fsOut">${st.fontSize}</output></div></div>
    <div class="field"><span>Tus frases</span>${segHTML('setOpt', st.mineView, [['full', 'Visibles'], ['ini', 'Iniciales'], ['hid', 'Ocultas']], 'data-k="mineView"')}</div>
    <div class="field"><span>Tipo de letra</span>${segHTML('setOpt', st.font, [['serif', 'Libro'], ['mono', 'Máquina'], ['sans', 'Moderna']], 'data-k="font"')}</div>
    <div class="field"><span>Maquetación</span>${segHTML('setOpt', st.style, [['auto', 'Automática'], ['theatre', 'Teatro'], ['screen', 'Cine']], 'data-k="style"')}</div>
    <div class="field"><span>Color del subrayado</span>${swatchesHTML()}</div>
    ${switchHTML('showNotes', st.showNotes, 'Mostrar mis notas')}
    ${switchHTML('charColors', st.charColors, 'Colores de los personajes')}
  </div>`);
};

/* ---------- menú de un bloque ---------- */
async function blockMenu(s, i) {
  const b = s.blocks[i];
  if (!b) return;
  const isDia = b.type === 'dialogue';
  const head = b.type === 'scene' ? 'Título de escena' : b.type === 'action' ? 'Acotación' : Model.charName(s, b.chars);
  const opts = [];
  if (s.me.length) opts.push({ value: 'rehearse', label: 'Ensayar desde aquí', sub: 'Con el apuntador por voz', icon: 'target' });
  opts.push({ value: 'note', label: b.note ? 'Editar nota' : 'Añadir nota', sub: 'Intención, movimiento, pausas…', icon: 'note' });
  if (isDia) opts.push({ value: 'star', label: b.star ? 'Quitar marca de difícil' : 'Marcar como difícil', icon: 'star' });
  opts.push({ value: 'edit', label: 'Editar texto', sub: 'También para dividirlo en dos', icon: 'edit' });
  if (isDia) opts.push({ value: 'who', label: 'Cambiar personaje', icon: 'user' });
  opts.push({ value: 'type', label: 'Convertir en…', sub: 'Diálogo, acotación o título de escena', icon: 'swap' });
  if (i > 0) opts.push({ value: 'merge', label: 'Unir con el bloque anterior', icon: 'merge' });
  opts.push({ value: 'delete', label: 'Eliminar', icon: 'trash', danger: true });
  const short = b.text.length > 160 ? b.text.slice(0, 160) + '…' : b.text;
  const v = await chooseSheet({ title: head, sub: esc(short), options: opts });
  if (!v) return;

  if (v === 'rehearse') { go(`/s/${s.id}/study/partner?from=${b.id}`); return; }
  if (v === 'note') {
    const t = await promptSheet({ title: 'Nota', value: b.note || '', multiline: true, placeholder: 'Ej.: «Aquí cruzo al proscenio» · «Con rabia contenida»' });
    if (t == null) return;
    if (t.trim()) b.note = t.trim(); else delete b.note;
    saveScript(s);
  } else if (v === 'star') {
    if (b.star) delete b.star; else b.star = true;
    saveScript(s);
    toast(b.star ? 'Marcada como difícil: la encontrarás en Ensayar' : 'Marca quitada');
  } else if (v === 'edit') {
    if (!(await editBlockSheet(s, i))) return;
  } else if (v === 'who') {
    const id = await pickCharacter(s, b.chars[0], 'Cambiar personaje');
    if (!id) return;
    b.chars = [id];
    structural(s);
  } else if (v === 'type') {
    const t = await chooseSheet({ title: 'Convertir en…', options: [
      { value: 'dialogue', label: 'Diálogo', icon: 'user', on: b.type === 'dialogue' },
      { value: 'action', label: 'Acotación', icon: 'note', on: b.type === 'action' },
      { value: 'scene', label: 'Título de escena', icon: 'list', on: b.type === 'scene' },
    ] });
    if (!t || t === b.type) return;
    if (t === 'dialogue') {
      const id = await pickCharacter(s, null, '¿Quién lo dice?');
      if (!id) return;
      const m = b.text.match(/^([^:]{1,40}):\s*([\s\S]+)$/);
      if (m && Model.charOf(s, id) && deaccent(m[1]).toUpperCase().trim() === deaccent(Model.charOf(s, id).name).toUpperCase().trim()) b.text = m[2];
      b.type = 'dialogue'; b.chars = [id]; b.paren = '';
    } else if (t === 'action') {
      b.type = 'action'; delete b.chars; delete b.paren;
    } else {
      b.type = 'scene'; b.level = 2; delete b.chars; delete b.paren;
    }
    structural(s);
  } else if (v === 'merge') {
    const p = s.blocks[i - 1];
    p.text = (p.text + (p.type === 'dialogue' && b.type === 'dialogue' ? '\n' : ' ') + b.text).trim();
    if (b.note) p.note = [p.note, b.note].filter(Boolean).join('\n');
    s.blocks.splice(i, 1);
    structural(s);
  } else if (v === 'delete') {
    const ok = await confirmSheet({ title: '¿Eliminar este bloque?', text: esc(short), ok: 'Eliminar', danger: true });
    if (!ok) return;
    s.blocks.splice(i, 1);
    structural(s);
  }
  refreshReader(s);
}

function pickCharacter(s, current, title) {
  return new Promise(async (res) => {
    const opts = s.characters.map((c) => ({ value: c.id, label: c.name, dot: c.color, on: c.id === current }));
    opts.push({ value: '__new', label: 'Nuevo personaje…', icon: 'plus' });
    const v = await chooseSheet({ title, options: opts });
    if (v === '__new') {
      const n = await promptSheet({ title: 'Nuevo personaje', placeholder: 'Nombre' });
      if (!n || !n.trim()) return res(null);
      const c = Model.addChar(s, n);
      structural(s);
      return res(c.id);
    }
    res(v);
  });
}

function editBlockSheet(s, i) {
  const b = s.blocks[i];
  return new Promise((res) => {
    let done = false;
    const el = Sheet.open(`<div class="sheet-body"><h3>Editar texto</h3>
      ${b.type === 'dialogue' ? `<label class="field"><span>Acotación junto al nombre (opcional)</span><input type="text" id="eParen" value="${esc(b.paren || '')}" placeholder="(enfadado)"></label>` : ''}
      <label class="field"><span>Texto</span><textarea id="eText" rows="7">${esc(b.text)}</textarea></label>
      <p class="small muted">Para dividir este bloque en dos, coloca el cursor donde quieras cortar y pulsa «Dividir».</p>
      <div class="sheet-actions"><button class="btn soft" id="eSplit">${icon('scissors', 'sm')} Dividir</button><button class="btn primary" id="eSave">Guardar</button></div></div>`,
    { onClose: () => { if (!done) { done = true; res(false); } } });
    const ta = el.querySelector('#eText');
    const paren = el.querySelector('#eParen');
    el.querySelector('#eSave').onclick = async () => {
      if (done) return;
      done = true;
      b.text = ta.value.trim();
      if (paren) b.paren = paren.value.trim();
      structural(s);
      await Sheet.close();
      res(true);
    };
    el.querySelector('#eSplit').onclick = async () => {
      const pos = ta.selectionStart;
      const a = ta.value.slice(0, pos).trim(), z = ta.value.slice(pos).trim();
      if (!a || !z) { toast('Pon el cursor en mitad del texto'); return; }
      done = true;
      b.text = a;
      if (paren) b.paren = paren.value.trim();
      const nb = { id: uid(), type: b.type, text: z };
      if (b.type === 'dialogue') { nb.chars = b.chars.slice(); nb.paren = ''; }
      if (b.type === 'scene') nb.type = 'action';
      s.blocks.splice(i + 1, 0, nb);
      structural(s);
      await Sheet.close();
      toast('Bloque dividido. Toca la segunda parte para cambiar su tipo o personaje.');
      res(true);
    };
  });
}
