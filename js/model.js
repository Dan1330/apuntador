'use strict';
/* Modelo de datos de un guion: índices, ámbitos de estudio, progreso */

const Model = (() => {
  // Intervalos de repaso por nivel (repetición espaciada sencilla)
  const INTERVALS = [0, 10 * 60e3, 20 * 3600e3, 2 * 864e5, 4 * 864e5, 8 * 864e5];

  function create({ title, author, blocks, characters, format, verse, source }) {
    return {
      id: uid(), title: (title || 'Obra sin título').trim(), author: (author || '').trim(), cover: null, coverTried: false, work: null,
      created: Date.now(), updated: Date.now(), opened: Date.now(),
      format: format || 'theatre', verse: !!verse, source: source || '',
      characters: characters || [], blocks: blocks || [], me: [], groupLines: true,
      prog: {}, log: { days: {}, secs: 0, sessions: 0 }, ui: { scope: 'all', pos: null }, _v: 1,
    };
  }

  function normalize(s) {
    s.me = s.me || []; s.prog = s.prog || {}; s.ui = s.ui || { scope: 'all' };
    s.log = s.log || { days: {}, secs: 0, sessions: 0 };
    s.log.days = s.log.days || {};
    s.characters = s.characters || []; s.blocks = s.blocks || [];
    s.author = s.author || '';
    s._v = 1;
    return s;
  }

  const charOf = (s, id) => s.characters.find((c) => c.id === id);

  function ix(s) {
    if (s._ix && s._ixv === s._v) return s._ix;
    const cm = new Map(s.characters.map((c) => [c.id, c]));
    const me = new Set(s.me || []);
    const isMineB = (b) => b.type === 'dialogue' && me.size > 0 &&
      (b.chars.some((c) => me.has(c)) || (s.groupLines !== false && b.chars.some((c) => cm.get(c) && cm.get(c).group)));
    const n = s.blocks.length;
    const mine = [], mineSet = new Set(), byId = new Map(), counts = {};
    let totalWords = 0, myWords = 0, totalLines = 0;
    const heads = [];
    s.blocks.forEach((b, i) => {
      byId.set(b.id, i);
      if (b.type === 'scene') heads.push(i);
      if (b.type === 'dialogue') {
        const w = countWords(b.text);
        totalWords += w; totalLines++;
        for (const c of b.chars) { const e = counts[c] || (counts[c] = { lines: 0, words: 0 }); e.lines++; e.words += w; }
        if (isMineB(b)) { mine.push(i); mineSet.add(i); myWords += w; }
      }
    });
    const scenes = [];
    const firstHead = heads.length ? heads[0] : n;
    const hasPre = heads.length > 0 && s.blocks.slice(0, firstHead).some((b) => b.type === 'dialogue');
    if (hasPre) scenes.push({ id: '_start', title: 'Inicio', level: 2, start: 0, end: firstHead });
    heads.forEach((h, k) => {
      const lvl = s.blocks[h].level || 2;
      let end = n;
      for (let k2 = k + 1; k2 < heads.length; k2++) { if ((s.blocks[heads[k2]].level || 2) <= lvl) { end = heads[k2]; break; } }
      scenes.push({ id: s.blocks[h].id, title: s.blocks[h].text, level: lvl, start: h, end });
    });
    for (const sc of scenes) {
      sc.mine = 0; sc.lines = 0;
      for (let i = sc.start; i < sc.end; i++) { if (s.blocks[i].type === 'dialogue') { sc.lines++; if (mineSet.has(i)) sc.mine++; } }
    }
    // escena "más interna" de cada bloque
    const sceneOf = new Int32Array(n).fill(-1);
    let k = hasPre ? 0 : -1;
    const headToScene = new Map(scenes.map((sc, j) => [sc.start, j]));
    for (let i = 0; i < n; i++) {
      if (s.blocks[i].type === 'scene' && headToScene.has(i) && scenes[headToScene.get(i)].id !== '_start') k = headToScene.get(i);
      sceneOf[i] = k;
    }
    s._ix = { mine, mineSet, byId, counts, totalWords, myWords, totalLines, scenes, sceneOf, isMineB };
    s._ixv = s._v;
    return s._ix;
  }

  const isMine = (s, i) => ix(s).mineSet.has(i);

  function sceneTitleOf(s, i) {
    const I = ix(s);
    const k = I.sceneOf[i];
    if (k < 0) return '';
    const sc = I.scenes[k];
    // incluir el acto padre si lo hay
    if (sc.level >= 2) {
      for (let j = k - 1; j >= 0; j--) { if (I.scenes[j].level < sc.level && I.scenes[j].end >= sc.end) return I.scenes[j].title + ' · ' + sc.title; }
    }
    return sc.title;
  }

  /* ---------- Ámbitos de estudio ---------- */
  function scopeOptions(s) {
    const I = ix(s);
    const opts = [{ v: 'all', label: 'Todo el guion', n: I.mine.length }];
    for (const sc of I.scenes) if (sc.mine > 0) opts.push({ v: 'sc:' + sc.id, label: sc.title, n: sc.mine, level: sc.level });
    const st = I.mine.filter((i) => s.blocks[i].star).length;
    if (st) opts.push({ v: 'star', label: '★ Marcadas como difíciles', n: st });
    const wk = scopeMine(s, 'weak').length;
    if (wk) opts.push({ v: 'weak', label: 'Las que más fallo', n: wk });
    return opts;
  }

  function scopeLabel(s, scope) {
    const o = scopeOptions(s).find((x) => x.v === scope);
    return o ? o.label : 'Todo el guion';
  }

  function scopeRange(s, scope) {
    if (!scope || scope === 'all') return { start: 0, end: s.blocks.length };
    if (scope.startsWith('sc:')) {
      const sc = ix(s).scenes.find((x) => x.id === scope.slice(3));
      if (sc) return { start: sc.start, end: sc.end };
      return { start: 0, end: s.blocks.length };
    }
    return null;
  }

  function scopeMine(s, scope) {
    const I = ix(s);
    const r = scopeRange(s, scope);
    if (r) return I.mine.filter((i) => i >= r.start && i < r.end);
    if (scope === 'star') return I.mine.filter((i) => s.blocks[i].star);
    if (scope === 'weak') {
      return I.mine.filter((i) => { const p = s.prog[s.blocks[i].id]; return p && (p.x > 0 || p.l <= 1) && p.r > 0; })
        .sort((a, b) => { const pa = s.prog[s.blocks[a].id], pb = s.prog[s.blocks[b].id]; return (pb.x - pa.x) || (pa.l - pb.l) || (a - b); });
    }
    if (scope === 'due') {
      const now = Date.now();
      return I.mine.filter((i) => { const p = s.prog[s.blocks[i].id]; return !p || p.d <= now; });
    }
    return I.mine.slice();
  }

  /* ---------- Progreso ---------- */
  function rate(s, b, grade, score) {
    const p = s.prog[b.id] || (s.prog[b.id] = { l: 0, r: 0, x: 0 });
    p.r++;
    p.t = Date.now();
    if (grade === 0) { p.l = 0; p.x++; }
    else if (grade === 1) p.l = Math.max(1, Math.min(p.l, 3));
    else p.l = Math.min(5, p.l + 1);
    p.d = Date.now() + INTERVALS[p.l];
    p.g = grade;
    if (score != null) p.s = Math.round(score * 100);
  }

  function gradeFromScore(score) { return score >= 0.9 ? 2 : score >= 0.6 ? 1 : 0; }

  function mastery(s, idxs) {
    idxs = idxs || ix(s).mine;
    let sum = 0, nw = 0, lr = 0, ms = 0;
    for (const i of idxs) {
      const p = s.prog[s.blocks[i].id];
      const l = p ? p.l : 0;
      sum += l;
      if (!p) nw++; else if (l >= 4) ms++; else lr++;
    }
    const n = idxs.length;
    return { pct: n ? Math.round((sum / (5 * n)) * 100) : 0, n, nw, lr, ms };
  }

  function dueCount(s) { return scopeMine(s, 'due').length; }

  function logTime(s, secs) {
    secs = Math.round(secs);
    if (secs < 3) return;
    secs = Math.min(secs, 3 * 3600);
    const k = todayKey();
    s.log.days[k] = (s.log.days[k] || 0) + secs;
    s.log.secs = (s.log.secs || 0) + secs;
  }

  function streak(s) {
    const d = new Date();
    if (!s.log.days[todayKey(d)]) d.setDate(d.getDate() - 1);
    let n = 0;
    while (s.log.days[todayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function lastStudy(s) {
    const ks = Object.keys(s.log.days || {}).sort();
    return ks.length ? new Date(ks[ks.length - 1] + 'T12:00:00').getTime() : 0;
  }

  /* ---------- Personajes ---------- */
  function renameChar(s, id, name) { const c = charOf(s, id); if (c && name.trim()) { c.name = name.trim(); c.group = Parser.GROUP_RE.test(Parser.keyOf(c.name)); } }

  function mergeChar(s, fromId, intoId) {
    if (fromId === intoId) return;
    for (const b of s.blocks) {
      if (b.type === 'dialogue' && b.chars.includes(fromId)) b.chars = [...new Set(b.chars.map((c) => (c === fromId ? intoId : c)))];
    }
    s.characters = s.characters.filter((c) => c.id !== fromId);
    s.me = [...new Set(s.me.map((c) => (c === fromId ? intoId : c)))];
  }

  function removeChar(s, id) {
    const c = charOf(s, id);
    if (!c) return;
    for (const b of s.blocks) {
      if (b.type !== 'dialogue' || !b.chars.includes(id)) continue;
      if (b.chars.length > 1) { b.chars = b.chars.filter((x) => x !== id); continue; }
      b.type = 'action';
      b.text = `${c.name}${b.paren ? ' ' + b.paren : ''}: ${b.text}`;
      delete b.chars; delete b.paren;
    }
    s.characters = s.characters.filter((x) => x.id !== id);
    s.me = s.me.filter((x) => x !== id);
  }

  function addChar(s, name) {
    const c = { id: 'c' + uid(), name: name.trim(), color: CHAR_COLORS[s.characters.length % CHAR_COLORS.length], group: Parser.GROUP_RE.test(Parser.keyOf(name)) };
    s.characters.push(c);
    return c;
  }

  function charName(s, ids) { return (ids || []).map((id) => (charOf(s, id) || { name: '?' }).name).join(' y '); }

  function toText(s) {
    const out = [];
    for (const b of s.blocks) {
      if (b.type === 'scene') out.push('', b.text.toUpperCase(), '');
      else if (b.type === 'action') out.push(b.text, '');
      else out.push(`${charName(s, b.chars).toUpperCase()}${b.paren ? ' ' + b.paren : ''}: ${b.text}`, '');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  return { create, normalize, ix, isMine, charOf, sceneTitleOf, scopeOptions, scopeLabel, scopeRange, scopeMine, rate, gradeFromScore,
    mastery, dueCount, logTime, streak, lastStudy, renameChar, mergeChar, removeChar, addChar, charName, toText };
})();
