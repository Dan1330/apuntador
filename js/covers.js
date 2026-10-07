'use strict';
/* Portadas: reconocer la obra, buscar su imagen en Wikipedia y pintar carteles */

const Covers = (() => {
  const TEMPLATES = [
    { id: 'velvet', name: 'Telón', art: 'art/poster-velvet.jpg' },
    { id: 'spot', name: 'Foco', art: 'art/poster-spot.jpg' },
    { id: 'masks', name: 'Máscaras', art: 'art/poster-masks.jpg' },
    { id: 'moon', name: 'Decorado', art: 'art/poster-moon.jpg' },
    { id: 'paper', name: 'Programa', art: 'art/poster-paper.jpg' },
    { id: 'deco', name: 'Art déco' },
    { id: 'swiss', name: 'Moderno' },
  ];
  const CONDENSED = new Set(['masks', 'paper', 'deco', 'swiss']);
  const SWISS = [['#e4572e', '#160d0a'], ['#1d3557', '#f1ece2'], ['#2a9d8f', '#08201d'], ['#f2a541', '#24140a'], ['#6a4c93', '#fbf1dd'], ['#d62839', '#fff4e6'], ['#264653', '#e9c46a']];
  const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'a', 'al', 'con', 'por', 'para', 'sin', 'un', 'una', 'of', 'the', 'and']);
  const GENERIC = /^(gui[oó]n|texto pegado|sin t[ií]tulo|ejemplo|documento|nuevo documento|untitled|script|libreto|obra)\b/i;
  const THEATRE = /(obra de teatro|obra teatral|teatr|tragedia|tragicomedia|comedia|drama|zarzuela|musical|[oó]pera|sainete|entrem[eé]s|auto sacramental|esperpento|play\b|tragedy|comedy)/i;
  const SCREEN = /(pel[ií]cula|film|serie|cortometraje|largometraje|screenplay|television)/i;
  const DATA_IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

  const norm = (s) => deaccent(String(s || '')).toLowerCase().replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

  function hash(s) {
    let h = 2166136261;
    for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ---------- título y autor ---------- */
  function smartCase(t) {
    if (!t || t !== t.toUpperCase() || !/\p{L}/u.test(t)) return t;
    return t.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }

  function cleanFileTitle(name) {
    return String(name || '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\b(gui[oó]n|script|libreto|texto|final|definitivo|borrador|versi[oó]n|copia|v\d+|\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}|\d{4} \d{2} \d{2})\b/gi, ' ')
      .replace(/\(\d+\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const AUTHOR_LINE = /^(?:de|por|by|autor(?:a)?:?|original de|escrita por|texto de|written by|una obra de)\s+(.{3,60})$/i;
  const NOT_TITLE = /^(personajes|reparto|dramatis|lugar|[eé]poca|acto|escena|cuadro|comedia en|drama en|tragedia en|obra en|pieza en|versi[oó]n|adaptaci[oó]n|copyright|©|todos los derechos|isbn|nota|sinopsis|pr[oó]logo|dedicatoria)/i;

  function guessMeta(blocks, fileTitle) {
    const head = [];
    for (const b of blocks) {
      if (b.type === 'dialogue') break;
      head.push(...String(b.text).split('\n'));
      if (head.length > 14) break;
    }
    let title = '', author = '';
    for (let k = 0; k < head.length; k++) {
      const t = head[k].trim().replace(/[.:;,]+$/, '');
      if (!t || t.length > 70) continue;
      const am = t.match(AUTHOR_LINE);
      if (am) { if (!author) author = am[1].trim(); continue; }
      if (NOT_TITLE.test(deaccent(t)) || Parser.headingLevel(t)) { if (title) break; continue; }
      if (!title) {
        if (t.split(' ').length <= 10 && /\p{L}{2}/u.test(t)) title = t;
        continue;
      }
      // línea siguiente al título con aspecto de nombre propio: posible autor
      if (!author && /^(\p{Lu}[\p{L}.'’-]+\s?){2,5}$/u.test(t) && t !== t.toUpperCase()) author = t;
      break;
    }
    const fromFile = cleanFileTitle(fileTitle);
    if (!title || (fromFile && norm(fromFile) === norm(title))) title = title || fromFile;
    return { title: smartCase(title || fromFile || 'Obra sin título'), author: smartCase(author) };
  }

  /* ---------- búsqueda en Wikipedia / Commons ---------- */
  async function getJSON(url) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  function pagesOf(j, lang) {
    return Object.values((j.query && j.query.pages) || {})
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => ({
        lang, title: p.title, desc: p.description || '', extract: p.extract || '',
        img: p.thumbnail ? p.thumbnail.source : null,
        w: p.original ? p.original.width : (p.thumbnail || {}).width, h: p.original ? p.original.height : (p.thumbnail || {}).height,
        en: p.langlinks && p.langlinks[0] ? p.langlinks[0]['*'] : null,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
      }));
  }

  const WIKI_PROPS = 'prop=pageimages|description|extracts|langlinks&piprop=thumbnail|original&pithumbsize=900&exintro=1&explaintext=1&exsentences=2&lllang=en&redirects=1';

  async function wikiSearch(lang, query, limit = 6) {
    const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit}&${WIKI_PROPS}`;
    return pagesOf(await getJSON(u), lang);
  }

  async function wikiTitle(lang, title) {
    const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&titles=${encodeURIComponent(title)}&${WIKI_PROPS}`;
    return pagesOf(await getJSON(u), lang)[0] || null;
  }

  async function commonsSearch(query, limit = 12) {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit}&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=700`;
    const j = await getJSON(u);
    return Object.values((j.query && j.query.pages) || {})
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => p.imageinfo && p.imageinfo[0])
      .filter((ii) => ii && /image\/(jpeg|png)/.test(ii.mime) && ii.thumburl && ii.width >= 300)
      .map((ii) => ({ img: ii.thumburl, w: ii.width, h: ii.height, credit: 'Wikimedia Commons' }));
  }

  function authorFrom(desc) {
    const m = String(desc || '').match(/(?:\bde|\bpor|\bby)\s+(\p{Lu}[\p{L}.'’-]+(?:\s+(?:(?:de|del|la|y|van|von)\s+)?\p{Lu}[\p{L}.'’-]+){0,4})\s*$/u);
    return m ? m[1] : '';
  }

  function score(p, title, author, format) {
    const nt = norm(title);
    const np = norm(p.title.replace(/\s*\(.*\)\s*$/, ''));
    if (!nt || !np) return -99;
    const txt = `${p.desc} ${p.extract}`;
    if (/desambiguaci|disambiguation/i.test(txt)) return -99;
    let sc;
    if (np === nt) sc = 6;
    else if (np.replace(/^(el|la|los|las|the) /, '') === nt.replace(/^(el|la|los|las|the) /, '')) sc = 5;
    else return -99;
    const theatre = THEATRE.test(txt), screen = SCREEN.test(txt);
    if (theatre) sc += 4;
    else if (screen) sc += format === 'screenplay' ? 4 : 0;
    else return -99;
    if (author) {
      const last = norm(author).split(' ').pop();
      if (last && last.length > 2 && norm(txt).includes(last)) sc += 3;
    }
    if (p.img) sc += 1;
    return sc;
  }

  // Devuelve { meta: {title, author, desc, url}, image: {img, w, h, credit} | null } o null si no la reconoce
  async function lookup(title, author, format) {
    if (!title || GENERIC.test(title) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    let meta = null, image = null;
    for (const lang of ['es', 'en']) {
      let pages = [];
      try {
        pages = await wikiSearch(lang, author ? `${title} ${author}` : title);
        if (author && !pages.some((p) => score(p, title, author, format) > 0)) pages = pages.concat(await wikiSearch(lang, title));
      } catch (e) { continue; }
      const ranked = pages.map((p) => ({ p, sc: score(p, title, author, format) })).filter((x) => x.sc >= 10).sort((a, b) => b.sc - a.sc);
      if (!ranked.length) continue;
      const top = ranked[0].p;
      if (!meta) meta = top;
      const withImg = ranked.find((x) => x.p.img);
      if (withImg) { image = { img: withImg.p.img, w: withImg.p.w, h: withImg.p.h, credit: 'Wikipedia' }; break; }
      // la versión inglesa del mismo artículo suele tener imagen
      if (lang === 'es' && top.en) {
        try {
          const en = await wikiTitle('en', top.en);
          if (en && en.img) { image = { img: en.img, w: en.w, h: en.h, credit: 'Wikipedia' }; break; }
        } catch (e) { /* sigue */ }
      }
    }
    if (!meta) return null;
    if (!image) {
      try { const c = await commonsSearch(meta.title.replace(/\s*\(.*\)\s*$/, ''), 6); if (c.length) image = c[0]; } catch (e) { /* sin imagen */ }
    }
    const cleanTitle = meta.title.replace(/\s*\(.*\)\s*$/, '');
    return { meta: { title: cleanTitle, author: authorFrom(meta.desc), desc: meta.desc, url: meta.url }, image };
  }

  // Imágenes candidatas para el selector de portada
  async function candidates(query) {
    const out = [];
    const seen = new Set();
    const add = (x) => { if (x && x.img && !seen.has(x.img)) { seen.add(x.img); out.push(x); } };
    const jobs = [
      wikiSearch('es', query, 5).catch(() => []),
      wikiSearch('en', query, 5).catch(() => []),
      commonsSearch(query, 14).catch(() => []),
    ];
    const [es, en, cm] = await Promise.all(jobs);
    for (const p of [...es, ...en]) if (p.img && score(p, query, '', 'screenplay') > 0) add({ img: p.img, w: p.w, h: p.h, credit: 'Wikipedia' });
    for (const p of [...es, ...en]) if (p.img) add({ img: p.img, w: p.w, h: p.h, credit: 'Wikipedia' });
    cm.forEach(add);
    return out.slice(0, 15);
  }

  /* ---------- imagen → dataURL (para guardarla y verla sin conexión) ---------- */
  async function decode(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch (e) { /* respaldo */ } }
    return new Promise((res, rej) => {
      const im = new Image();
      const url = URL.createObjectURL(blob);
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo abrir la imagen')); };
      im.src = url;
    });
  }

  // 640 px bastan para el cartel más grande (×3 en pantallas retina) y ocupan ~90 KB
  async function toDataURL(source, max = 640) {
    const blob = source instanceof Blob ? source : await (await fetch(source, { mode: 'cors' })).blob();
    const im = await decode(blob);
    const W = im.width, H = im.height;
    const k = Math.min(1, max / Math.max(W, H));
    const c = document.createElement('canvas');
    c.width = Math.round(W * k);
    c.height = Math.round(H * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    if (im.close) im.close();
    return { src: c.toDataURL('image/jpeg', 0.82), w: c.width, h: c.height };
  }

  // La portada se guarda como dataURL (para IndexedDB y copias), pero se pinta con una URL blob: corta,
  // así el HTML no arrastra cientos de KB cada vez que se redibuja la cartelera.
  const blobURLs = new WeakMap();
  function imgURL(c) {
    let u = blobURLs.get(c);
    if (!u) {
      const [head, b64] = c.src.split(',');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      u = URL.createObjectURL(new Blob([bytes], { type: head.slice(5, head.indexOf(';')) }));
      blobURLs.set(c, u);
    }
    return u;
  }

  /* ---------- automático: reconocer y poner portada ---------- */
  async function auto(s) {
    s.coverTried = true;
    const r = await lookup(s.title, s.author, s.format);
    if (!r) return false;
    if (norm(r.meta.title) === norm(s.title)) s.title = r.meta.title;
    if (!s.author && r.meta.author) s.author = r.meta.author;
    s.work = { desc: r.meta.desc, url: r.meta.url };
    if (r.image && !(s.cover && s.cover.kind === 'user')) {
      try {
        const d = await toDataURL(r.image.img);
        s.cover = { kind: 'image', src: d.src, w: d.w, h: d.h, credit: r.image.credit };
      } catch (e) { console.warn('portada', e); }
    }
    return true;
  }

  /* ---------- pintar el cartel ---------- */
  function titleSize(title, condensed) {
    const n = String(title).length;
    const longest = Math.max(...String(title).split(/\s+/).map((w) => w.length));
    let v = n <= 6 ? 19 : n <= 10 ? 16 : n <= 16 ? 13.5 : n <= 26 ? 11.5 : n <= 40 ? 9.5 : 8;
    v = Math.min(v, 100 / Math.max(5, longest * 0.62));
    if (condensed) v *= 1.3;
    return v.toFixed(1) + 'cqw';
  }

  function autoTemplate(s) { return TEMPLATES[hash(s.title || s.id) % TEMPLATES.length].id; }

  function templateHTML(tplId, title, author, seed, cls = '', inner = '') {
    const t = TEMPLATES.find((x) => x.id === tplId) || TEMPLATES[0];
    const cond = CONDENSED.has(t.id);
    const ts = titleSize(title, cond);
    const art = t.art ? `<div class="p-art" style="background-image:url(${t.art})"></div>` : '';
    let extra = '', style = `--ts:${ts}`;
    let kicker = 'Teatro';
    if (t.id === 'swiss') {
      const [bg, ink] = SWISS[hash(seed + '·color') % SWISS.length]; // hash distinto al de la plantilla
      style += `;--bgc:${bg};--ink:${ink}`;
      extra = `<div class="p-big" aria-hidden="true">${esc((title.match(/\p{L}/u) || ['A'])[0].toUpperCase())}</div>`;
      kicker = 'Temporada';
    }
    if (t.id === 'deco') extra = '<div class="p-deco" aria-hidden="true"></div>';
    if (t.id === 'paper') kicker = 'Gran teatro · Función';
    return `<div class="poster tpl-${t.id} ${cls}" style="${style}">${art}${extra}<div class="p-shade"></div>
      <div class="p-txt"><div class="p-kicker">${esc(kicker)}</div><div class="p-title">${esc(title)}</div><div class="p-rule"></div>${author ? `<div class="p-sub">${esc(author)}</div>` : ''}</div>${inner}</div>`;
  }

  const hasImage = (c) => (c.kind === 'image' || c.kind === 'user') && DATA_IMG.test(c.src || '');

  // inner: HTML extra dentro del cartel (p. ej. la barra de progreso)
  function posterHTML(s, cls = '', inner = '') {
    const c = s.cover || {};
    const title = s.title || 'Sin título';
    const author = s.author || '';
    if (hasImage(c)) {
      const ts = titleSize(title, false);
      const src = imgURL(c);
      if (c.h / c.w >= 1.15) {
        return `<div class="poster tpl-photo ${cls}" style="--ts:${ts}"><img class="p-img" src="${src}" alt="" decoding="async"><div class="p-shade"></div>
          <div class="p-txt">${author ? `<div class="p-kicker">${esc(author)}</div>` : ''}<div class="p-title">${esc(title)}</div></div>${inner}</div>`;
      }
      return `<div class="poster tpl-framed ${cls}" style="--ts:${ts}"><div class="p-frame"><img class="p-img" src="${src}" alt="" decoding="async"></div>
        <div class="p-txt"><div class="p-title">${esc(title)}</div>${author ? `<div class="p-sub">${esc(author)}</div>` : ''}</div>${inner}</div>`;
    }
    return templateHTML(c.kind === 'tpl' ? c.tpl : autoTemplate(s), title, author, s.title || s.id, cls, inner);
  }

  // Imagen de fondo para cabeceras (difuminada)
  function backdrop(s) {
    const c = s.cover || {};
    if (hasImage(c)) return imgURL(c);
    const t = TEMPLATES.find((x) => x.id === (c.kind === 'tpl' ? c.tpl : autoTemplate(s)));
    return (t && t.art) || 'art/poster-velvet.jpg';
  }

  return { TEMPLATES, guessMeta, smartCase, cleanFileTitle, lookup, candidates, toDataURL, auto, posterHTML, templateHTML, backdrop, GENERIC, DATA_IMG };
})();
