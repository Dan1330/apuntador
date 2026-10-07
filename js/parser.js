'use strict';
/*
 * Analizador de guiones.
 * Entrada: lista de líneas { t, blank?, hard?, it?, cue?, boldName?, kind? }
 *   t        texto de la línea
 *   blank    línea vacía (separa párrafos)
 *   hard     salto de línea real (Word/ODT) — no es un ajuste de línea del PDF
 *   it       párrafo en cursiva (suele ser acotación)
 *   cue      el origen indica que es el nombre de un personaje (negrita sola, estilo "Personaje")
 *   boldName la línea empieza por un nombre en negrita
 *   kind     tipo forzado: scene | cue | dialogue | paren | action
 * Salida: { blocks, characters, format }
 */
const Parser = (() => {
  const CONNECT = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'da', 'do', 'van', 'von', 'di', 'le', 'en']);

  const STOP = new Set(`NOTA NOTAS PERSONAJES PERSONAJE DRAMATIS PERSONAE REPARTO LUGAR EPOCA TIEMPO DECORADO ESCENARIO FIN TELON
OSCURO MUTIS PAUSA SILENCIO INT EXT CORTE FUNDIDO TRANSICION DISOLVENCIA PROLOGO EPILOGO PAGINA PAG CAPITULO SECUENCIA PLANO
INSERTO INSERT TITULO TITULOS MUSICA LUZ LUCES SONIDO EFECTO EFECTOS ATENCION IMPORTANTE AUTOR AUTORA VERSION BORRADOR COPYRIGHT
DIA NOCHE MANANA TARDE MEDIODIA ATARDECER AMANECER CONTINUA CONTINUARA MAS MORE CONTD FLASHBACK MONTAJE SUPER SOBREIMPRESION
ACOTACION ESCENA ACTO CUADRO SINOPSIS ARGUMENTO OBRA DURACION GENERO FECHA CONTACTO EMAIL TEL TELEFONO WEB ISBN EDITORIAL EDICION
DIRECCION ESCENOGRAFIA VESTUARIO ILUMINACION PRODUCCION INDICE NOTE CHARACTERS CAST SETTING TIME PLACE END BLACKOUT LIGHTS SOUND
MUSIC CURTAIN INTERVAL INTERMISSION OK EJEMPLO TEXTO PS NB OBS OBSERVACIONES APUNTES CANCION ESTRIBILLO VERSO`.split(/\s+/));
  const STOP_MULTI = new Set(['CORTE A', 'FUNDIDO A NEGRO', 'FUNDE A NEGRO', 'FADE IN', 'FADE OUT', 'CUT TO', 'THE END',
    'NOTA DEL AUTOR', 'NOTA DE LA AUTORA', 'DRAMATIS PERSONAE', 'SE APAGAN LAS LUCES', 'FIN DE LA OBRA', 'FIN DEL ACTO',
    'FIN DEL PRIMER ACTO', 'FIN DEL SEGUNDO ACTO', 'CAE EL TELON']);

  const GROUP_RE = /^(TODOS|TODAS|AMBOS|AMBAS|LOS DOS|LAS DOS|LOS TRES|LAS TRES|LOS CUATRO|CORO|EL CORO|VARIOS|VARIAS|TODO EL MUNDO|GRUPO|ALL|BOTH|EVERYONE|CHORUS)\b/;

  const ORD = '(?:PRIMER[OA]?|SEGUND[OA]|TERCER[OA]?|CUART[OA]|QUINT[OA]|SEXT[OA]|S[ÉE]PTIM[OA]|OCTAV[OA]|NOVEN[OA]|D[ÉE]CIM[OA]|[ÚU]LTIM[OA]|[ÚU]NIC[OA]|\\d+)';
  const KW1 = '(?:ACTO|PARTE|JORNADA|ACT|PART)';
  const KW2 = '(?:ESCENA|CUADRO|SECUENCIA|SEC\\.|ESC\\.|SCENE|CAP[ÍI]TULO|TABLEAU)';
  const KW0 = '(?:PR[ÓO]LOGO|EP[ÍI]LOGO|INTERMEDIO|ENTREACTO|PROLOGUE|EPILOGUE)';
  const H1 = new RegExp(`^(?:${KW1}\\s*${ORD}|${ORD}\\s+${KW1}\\b)`, 'i');
  const H2 = new RegExp(`^(?:${KW2}\\s*${ORD}|${ORD}\\s+${KW2}\\b)`, 'i');
  // números romanos: solo en mayúsculas (para no confundir "Parte civil" con "PARTE CI")
  const H1R = new RegExp(`^${KW1}\\s+[IVXLC]+\\b`);
  const H2R = new RegExp(`^${KW2}\\s*[IVXLC]+\\b`);
  const H0 = new RegExp(`^${KW0}\\b`, 'i');
  const H2CAPS = new RegExp(`^${KW2}\\s*$`);
  const SLUG = /^(?:\d+[A-Z]?[.)\-]?\s+)?(?:INT|EXT|INT\.?\s*\/\s*EXT|EXT\.?\s*\/\s*INT|I\/E|E\/I)[.\s:\-–—]/;

  const AUTHOR_LINE = /^(?:[Dd]e|[Pp]or|[Bb]y|[Aa]utora?:?|[Oo]riginal de|[Ee]scrita por|[Tt]exto de|[Ww]ritten by|[Uu]na obra de|[Aa]daptaci[oó]n de|[Vv]ersi[oó]n de)\s+\p{Lu}/u;
  const isCaps = (s) => /\p{L}/u.test(s) && s === s.toUpperCase() && s !== s.toLowerCase();
  const keyOf = (name) => deaccent(name).toUpperCase().replace(/\([^)]*\)/g, ' ').replace(/[.:]/g, '')
    .replace(/[^A-Z0-9 '\-&\/,]/g, '').replace(/\s+/g, ' ').trim();

  function headingLevel(t) {
    if (t.length > 90) return 0;
    const up = t.replace(/^\p{L}+\.?/u, (w) => w.toUpperCase());
    if (H1.test(t) || H0.test(t) || H1R.test(up)) return 1;
    if (H2.test(t) || H2CAPS.test(t) || H2R.test(up)) return 2;
    if (SLUG.test(t)) return 2;
    return 0;
  }

  function cleanHeading(t) {
    return t.replace(/^(\d+[A-Z]?)[.)]?\s+(.*?)\s+\1$/, '$1. $2').replace(/\s{2,}/g, ' ').trim();
  }

  function nameInfo(raw, lenient) {
    const name = String(raw).replace(/\s+/g, ' ').trim().replace(/[.:,\-–—\s]+$/, '');
    if (!name || name.length > 36) return null;
    if (/[¿?¡!;"«»“”…]/.test(name)) return null;
    if (!/^\p{L}/u.test(name)) return null;
    if ((name.match(/\p{L}/gu) || []).length < 2 && !lenient) return null;
    const words = name.split(' ');
    if (words.length > 5) return null;
    const caps = isCaps(name);
    const titled = !caps && words.every((w) => /^[\p{Lu}\d]/u.test(w) || CONNECT.has(w.toLowerCase()));
    const key = keyOf(name);
    if (!key) return null;
    if (!lenient) {
      if (STOP.has(key) || STOP_MULTI.has(key)) return null;
      if (headingLevel(name.toUpperCase())) return null;
    }
    return { name, key, caps, titled, words: words.length };
  }

  const isCont = (p) => !!p && /CONT|CONTIN|SIGUE|\bMORE\b/i.test(deaccent(p));

  function firstWordCaps(rest) {
    const w = (rest.match(/\p{L}+/u) || [''])[0];
    return w.length >= 2 && isCaps(w);
  }

  function matchSpeaker(ln) {
    const t = ln.t;
    if (!t || t.length < 2) return null;
    let m;
    if (ln.kind === 'cue' || ln.cue) {
      m = t.match(/^(.*?)\s*(\([^)]{0,50}\))?\s*:?\s*$/);
      const info = m && nameInfo(m[1], true);
      if (info) return { ...info, paren: m[2] || '', rest: '', form: 'block', forced: ln.kind === 'cue', cont: isCont(m[2]) };
      if (ln.kind === 'cue') return null;
    }
    // Línea que es solo el nombre (formato guion de cine o teatro con nombre centrado)
    m = t.match(/^([^():]{1,40}?)\s*(\([^)]{0,50}\))?\s*:?\s*$/);
    if (m) {
      const info = nameInfo(m[1]);
      if (info && (info.caps || ln.cue)) return { ...info, paren: m[2] || '', rest: '', form: 'block', cont: isCont(m[2]) };
    }
    // NOMBRE: texto
    m = t.match(/^([^():]{1,40}?)\s*(\([^)]{0,60}\))?\s*:\s*(.+)$/);
    if (m) {
      const info = nameInfo(m[1]);
      if (info && (info.caps || info.titled || ln.boldName)) return { ...info, paren: m[2] || '', rest: m[3].trim(), form: 'inline', delim: ':' };
    }
    // NOMBRE.— texto  ·  NOMBRE — texto
    m = t.match(/^(.{1,40}?)\s*(\([^)]{0,60}\))?\s*(\.\s*[-–—]+|[—–]+|\s-{1,2}\s)\s*(.+)$/);
    if (m) {
      const info = nameInfo(m[1]);
      const dotDash = m[3].trim().startsWith('.');
      if (info && (info.caps || ((info.titled || ln.boldName) && dotDash))) {
        return { ...info, paren: m[2] || '', rest: m[4].trim(), form: 'inline', delim: dotDash ? '.—' : '—' };
      }
    }
    // NOMBRE. texto (solo nombres en mayúsculas)
    const re = /\.\s+/g;
    let mm, best = null;
    while ((mm = re.exec(t)) && mm.index <= 40) {
      const pre = t.slice(0, mm.index);
      const rest = t.slice(mm.index + mm[0].length);
      const pm = pre.match(/^(.*?)\s*(\([^)]{0,60}\))?$/);
      const info = pm && nameInfo(pm[1]);
      if (info && info.caps && rest && !firstWordCaps(rest)) best = { ...info, paren: pm[2] || '', rest: rest.trim(), form: 'inline', delim: '.' };
    }
    if (best) return best;
    // Nombre en negrita sin separador (Word)
    if (ln.boldName && ln.boldText) {
      const info = nameInfo(ln.boldText);
      const rest = t.slice(ln.boldText.length).replace(/^[\s:.\-–—]+/, '');
      if (info && rest) return { ...info, paren: '', rest, form: 'inline', delim: 'b' };
    }
    return null;
  }

  const isWholeParen = (t) => /^[(\[].*[)\]][.\s]*$/.test(t) && balance(t) === 0;
  function balance(t) {
    let d = 0;
    for (const c of t) { if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--; }
    return d;
  }

  function p90(arr) {
    if (!arr.length) return 60;
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(a.length * 0.9))];
  }

  function parse(lines) {
    // 1) candidatos a personaje
    const stats = new Map();
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.blank || ln.kind === 'scene' || ln.kind === 'action' || ln.kind === 'dialogue' || ln.kind === 'paren') continue;
      if (!ln.kind && headingLevel(ln.t)) { ln.head = headingLevel(ln.t); continue; }
      const sp = matchSpeaker(ln);
      if (!sp) continue;
      if (sp.form === 'block' && !sp.forced) {
        const nx = lines[i + 1];
        if (!nx || nx.blank || nx.kind === 'scene') continue;
        // portada: «MACBETH / de William Shakespeare» no es una intervención
        if (AUTHOR_LINE.test(nx.t)) continue;
        const nsp = matchSpeaker(nx);
        if (nsp && nsp.form === 'block' && isCaps(nx.t) && !/^\(/.test(nx.t)) continue;
      }
      ln.sp = sp;
      let e = stats.get(sp.key);
      if (!e) { e = { n: 0, inline: 0, block: 0, forced: false, caps: sp.caps, names: new Map(), strongDelim: 0, words: sp.words }; stats.set(sp.key, e); }
      e.n++;
      e[sp.form]++;
      if (sp.forced) e.forced = true;
      if (sp.delim === ':' || sp.delim === '.—' || sp.delim === 'b') e.strongDelim++;
      e.names.set(sp.name, (e.names.get(sp.name) || 0) + 1);
    }

    let inl = 0, blk = 0;
    for (const e of stats.values()) if (e.n >= 2 || e.forced) { inl += e.inline; blk += e.block; }
    const dominant = blk > inl ? 'block' : 'inline';

    const accepted = new Map(); // key -> [charKey]
    for (const [key, e] of stats) {
      let ok = e.forced || e.n >= 2;
      if (!ok && e.caps && e.strongDelim > 0) ok = true;
      if (!ok && e.caps && e.block > 0 && dominant === 'block' && e.words <= 3) ok = true;
      if (ok && !e.forced && !e.caps && e.n < 2) ok = false;
      if (ok) accepted.set(key, [key]);
    }
    // personajes combinados: "PEDRO Y MARÍA"
    for (const key of stats.keys()) {
      const parts = key.split(/\s+(?:Y|E|&)\s+|\s*[,\/+]\s*/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2 && parts.every((p) => accepted.has(p) && accepted.get(p).length === 1 && accepted.get(p)[0] === p)) {
        accepted.set(key, parts);
      }
    }

    // 2) construir bloques
    const blocks = [];
    let cur = null, awaiting = false, parenDepth = 0;
    const lastDialogue = () => { for (let k = blocks.length - 1; k >= 0; k--) { if (blocks[k].type === 'scene') return null; if (blocks[k].type === 'dialogue') return blocks[k]; } return null; };
    const newAction = (ln) => { cur = { type: 'action', _l: [] }; blocks.push(cur); awaiting = false; addLine(cur, ln); };
    const addLine = (b, ln, t) => {
      b._l.push({ t: t ?? ln.t, hard: !!(ln.hard || ln.br) });
      if (b._x == null && ln.x != null && t == null) b._x = ln.x;
    };

    for (const ln of lines) {
      if (ln.blank) { if (!awaiting) { cur = null; parenDepth = 0; } continue; }
      const t = ln.t;

      if (parenDepth > 0 && cur) { addLine(cur, ln); parenDepth = Math.max(0, parenDepth + balance(t)); continue; }

      if (ln.kind === 'scene' || ln.head) {
        blocks.push({ type: 'scene', text: cleanHeading(t), level: ln.level || ln.head || headingLevel(t) || 2 });
        cur = null; awaiting = false; continue;
      }
      if (ln.kind === 'action') { newAction(ln); cur = null; continue; }

      const sp = ln.sp && accepted.has(ln.sp.key) ? ln.sp : null;
      if (sp) {
        const ids = accepted.get(sp.key);
        const prev = sp.cont ? lastDialogue() : null;
        if (prev && prev._k.join('|') === ids.join('|')) {
          cur = prev;
        } else {
          cur = { type: 'dialogue', _k: ids, _l: [], paren: sp.cont ? '' : sp.paren.trim() };
          blocks.push(cur);
        }
        if (sp.rest) { addLine(cur, { t: sp.rest, hard: ln.hard }); awaiting = false; parenDepth = Math.max(0, balance(sp.rest)); }
        else awaiting = true;
        continue;
      }

      const whole = isWholeParen(t);
      const opens = /^[(\[]/.test(t) && balance(t) > 0;

      if (cur && cur.type === 'dialogue') {
        if (ln.kind === 'paren' || whole || opens) {
          if (awaiting && !cur._l.length && whole && !cur.paren) { cur.paren = t.replace(/[.\s]+$/, ''); continue; }
          if (awaiting || dominant === 'block' || ln.kind === 'paren') {
            addLine(cur, ln); if (opens) parenDepth = balance(t); continue;
          }
          newAction(ln); if (opens) parenDepth = balance(t); continue;
        }
        if (ln.it && !awaiting && ln.kind !== 'dialogue') { newAction(ln); continue; }
        // PDF de guion de cine: si la línea vuelve al margen izquierdo, ya no es diálogo
        if (!awaiting && dominant === 'block' && ln.x != null && cur._x != null && ln.x < cur._x - 18) { newAction(ln); continue; }
        addLine(cur, ln); awaiting = false; continue;
      }
      if (ln.kind === 'dialogue' && !cur) { newAction(ln); continue; }
      if (cur && cur.type === 'action' && (!ln.hard || ln.br)) { addLine(cur, ln); continue; }
      newAction(ln);
      if (opens) parenDepth = balance(t);
    }

    // 3) unir líneas (ajuste de línea vs. verso)
    const dLines = [], aLines = [];
    let upStart = 0, contTotal = 0;
    for (const b of blocks) {
      if (!b._l) continue;
      for (let i = 0; i < b._l.length; i++) {
        const l = b._l[i];
        if (l.hard) continue;
        (b.type === 'dialogue' ? dLines : aLines).push(l.t.length);
        if (b.type === 'dialogue' && i > 0) { contTotal++; if (/^[¿¡"«“'—\-(]*\p{Lu}/u.test(l.t)) upStart++; }
      }
    }
    const PD = p90(dLines), PA = p90(aLines);
    // ¿Es verso? En verso los renglones cortan pronto y a menudo con puntuación; en prosa ajustada llegan al margen.
    let brk = 0, shortBrk = 0, punctBrk = 0;
    for (const b of blocks) {
      if (b.type !== 'dialogue' || !b._l) continue;
      for (let i = 0; i < b._l.length - 1; i++) {
        const t = b._l[i].t.trim();
        if (b._l[i + 1].hard || /[-­]$/.test(t)) continue;
        brk++;
        if (t.length < PD * 0.72) shortBrk++;
        if (/[,.;:!?…»”)]$/.test(t)) punctBrk++;
      }
    }
    const verse = brk >= 6 && (shortBrk / brk > 0.3 || (contTotal >= 8 && upStart / contTotal > 0.72) || (punctBrk / brk > 0.45 && shortBrk / brk > 0.15));
    const joinLines = (arr, P, isDia) => {
      let out = '';
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i].t.trim();
        if (!t) continue;
        if (!out) { out = t; continue; }
        const prev = arr[i - 1].t.trim();
        if (arr[i].hard) out += '\n' + t;
        else if (/\p{L}[-\u00AD]$/u.test(prev) && /^\p{Ll}/u.test(t)) out = out.replace(/[-\u00AD]$/, '') + t;
        else if (isDia && verse) out += '\n' + t;
        else if (prev.length >= P * 0.72) out += ' ' + t;
        else out += '\n' + t;
      }
      return out;
    };

    const out = [];
    for (const b of blocks) {
      if (b.type === 'scene') { if (b.text) out.push({ id: uid(), type: 'scene', text: b.text, level: b.level }); continue; }
      const text = joinLines(b._l, b.type === 'dialogue' ? PD : PA, b.type === 'dialogue');
      if (b.type === 'dialogue') {
        if (!text && !b.paren) continue;
        out.push({ id: uid(), type: 'dialogue', _k: b._k, text, paren: b.paren || '' });
      } else if (text) {
        out.push({ id: uid(), type: 'action', text });
      }
    }

    // 4) personajes
    const used = new Map();
    for (const b of out) if (b.type === 'dialogue') for (const k of b._k) used.set(k, (used.get(k) || 0) + 1);
    const characters = [];
    const idOf = new Map();
    const sortedKeys = [...used.keys()].sort((a, b) => used.get(b) - used.get(a));
    sortedKeys.forEach((key, i) => {
      const e = stats.get(key);
      let name = key;
      if (e) {
        const variants = [...e.names.entries()].sort((a, b) => b[1] - a[1]);
        name = variants[0][0];
        const accented = variants.find(([n]) => deaccent(n) !== n && deaccent(n).toUpperCase() === deaccent(name).toUpperCase());
        if (accented) name = accented[0];
      }
      const id = 'c' + (i + 1);
      idOf.set(key, id);
      characters.push({ id, name, color: CHAR_COLORS[i % CHAR_COLORS.length], group: GROUP_RE.test(key) });
    });
    for (const b of out) {
      if (b.type === 'dialogue') { b.chars = [...new Set(b._k.map((k) => idOf.get(k)))]; delete b._k; }
    }

    const slugs = out.filter((b) => b.type === 'scene' && SLUG.test(b.text)).length;
    const format = slugs >= 1 ? 'screenplay' : 'theatre';
    return { blocks: out, characters, format, verse };
  }

  /* ---------- Preparación de texto plano ---------- */
  function textToLines(text) {
    text = String(text).replace(/\r\n?/g, '\n').replace(/\u00A0/g, ' ').replace(/\t/g, '    ').replace(/\u200B/g, '');
    return text.split('\n').map((raw) => {
      const t = raw.replace(/\s+/g, ' ').trim();
      return t ? { t } : { blank: true };
    });
  }

  // Fountain (formato de texto para guiones)
  function fountainToLines(text) {
    let title = '';
    text = String(text).replace(/\r\n?/g, '\n');
    text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '');
    const raw = text.split('\n');
    let i = 0;
    if (/^\s*[A-Za-z ]+:\s*\S*/.test(raw[0] || '') && /^(title|credit|author|authors|source|draft date|contact|copyright|notes)\s*:/i.test(raw[0])) {
      while (i < raw.length && raw[i].trim() !== '') {
        const m = raw[i].match(/^title\s*:\s*(.*)$/i);
        if (m) title = m[1].replace(/[_*]/g, '').trim() || (raw[i + 1] || '').trim();
        i++;
      }
    }
    const lines = [];
    for (; i < raw.length; i++) {
      let t = raw[i].trim();
      if (!t) { lines.push({ blank: true }); continue; }
      if (/^={3,}$/.test(t) || /^=\s/.test(t)) continue;
      t = t.replace(/\*{1,3}|_/g, '');
      if (/^#+\s*/.test(t)) { lines.push({ t: t.replace(/^#+\s*/, ''), kind: 'scene', level: 1 }); continue; }
      if (/^\.[^.]/.test(t)) { lines.push({ t: t.slice(1), kind: 'scene', level: 2 }); continue; }
      if (/^@/.test(t)) { lines.push({ t: t.slice(1), kind: 'cue' }); continue; }
      if (/^!/.test(t)) { lines.push({ t: t.slice(1), kind: 'action' }); continue; }
      if (/^>.*<$/.test(t)) { lines.push({ t: t.replace(/^>\s*|\s*<$/g, ''), kind: 'action' }); continue; }
      if (/^>/.test(t) || /TO:$/.test(t)) continue; // transiciones
      if (/^~/.test(t)) t = t.slice(1);
      lines.push({ t });
    }
    return { title, lines };
  }

  return { parse, textToLines, fountainToLines, nameInfo, keyOf, headingLevel, GROUP_RE };
})();

const CHAR_COLORS = ['#c0392b', '#2471a3', '#239b56', '#8e44ad', '#d35400', '#16a085', '#b7950b', '#c2185b', '#5d6d7e', '#6d4c41', '#00838f', '#7b1fa2', '#ef6c00', '#2e7d32', '#3949ab'];
