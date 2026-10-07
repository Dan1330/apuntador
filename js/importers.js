'use strict';
/* Lectura de archivos: PDF, Word, ODT, RTF, Final Draft, Fountain, HTML, TXT y fotos (OCR) */

const Importers = (() => {
  const V = 'vendor/';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();

  async function readText(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let text;
    if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder('utf-16le').decode(buf);
    else if (buf[0] === 0xfe && buf[1] === 0xff) text = new TextDecoder('utf-16be').decode(buf);
    else {
      text = new TextDecoder('utf-8').decode(buf);
      if (text.includes('�')) { try { text = new TextDecoder('windows-1252').decode(buf); } catch (e) { /* nada */ } }
    }
    return text.replace(/^﻿/, '');
  }

  /* ---------------- PDF ---------------- */
  async function loadPDFJS() {
    await loadScript(V + 'pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = V + 'pdf.worker.min.js';
    return window.pdfjsLib;
  }

  const PAGE_NUM = /^[-–—\s]*(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(de|\/|of)\s*\d{1,4})?[-–—\s.]*$/i;
  const MORE = /^\(?\s*(MORE|M[ÁA]S|CONTIN[ÚU]A|CONT\.?|SIGUE|CONTINUED)\s*\)?$/i;

  async function fromPDF(file, progress, opts) {
    const lib = await loadPDFJS();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = [];
    let chars = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      progress && progress((p - 1) / pdf.numPages, `Leyendo página ${p} de ${pdf.numPages}…`);
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items
        .filter((it) => typeof it.str === 'string' && it.str.length)
        .map((it) => {
          const [a, b, c, d, e, f] = it.transform;
          const fs = Math.hypot(c, d) || Math.hypot(a, b) || 10;
          return { x: e, y: f, w: it.width, s: it.str, fs };
        });
      items.sort((A, B) => B.y - A.y || A.x - B.x);
      const rows = [];
      for (const it of items) {
        const last = rows[rows.length - 1];
        if (last && Math.abs(last.y - it.y) <= Math.max(2, it.fs * 0.4)) last.items.push(it);
        else rows.push({ y: it.y, fs: it.fs, items: [it] });
      }
      const lines = [];
      for (const r of rows) {
        r.items.sort((A, B) => A.x - B.x);
        const parts = [''];
        let end = null;
        for (const it of r.items) {
          if (end !== null) {
            const gap = it.x - end;
            if (gap > it.fs * 2.5 && parts[parts.length - 1].trim()) parts.push('');
            else if (gap > it.fs * 0.18 && !/\s$/.test(parts[parts.length - 1]) && !/^\s/.test(it.s)) parts[parts.length - 1] += ' ';
          }
          parts[parts.length - 1] += it.s;
          end = it.x + it.w;
        }
        const clean = parts.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (!clean.length) continue;
        let t = clean.join(' ');
        // Columnas "NOMBRE ······ texto" (guiones de doblaje / tablas)
        if (clean.length >= 2 && !/[:.—–]$/.test(clean[0]) && Parser.nameInfo(clean[0]) && clean[0] === clean[0].toUpperCase()) {
          t = clean[0] + ': ' + clean.slice(1).join(' ');
        }
        chars += t.length;
        lines.push({ t, y: r.y, fs: r.fs, x: r.items[0].x });
      }
      pages.push({ lines });
      page.cleanup && page.cleanup();
    }

    if (chars < 40 * pdf.numPages) {
      const ok = opts && opts.confirmOCR ? await opts.confirmOCR(pdf.numPages) : false;
      if (!ok) throw new Error('Este PDF parece escaneado (son imágenes, no texto). Puedes probar a reconocer el texto con la opción de fotos/escaneo.');
      const text = await ocrPages(pdf.numPages, async (i) => {
        const page = await pdf.getPage(i + 1);
        const vp = page.getViewport({ scale: 2 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        return c;
      }, progress, opts && opts.ocrLang);
      return { lines: Parser.textToLines(text) };
    }

    // Quitar cabeceras/pies repetidos y números de página
    const keyOf = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const edge = new Map();
    for (const pg of pages) {
      const ks = new Set([...pg.lines.slice(0, 2), ...pg.lines.slice(-2)].map((l) => keyOf(l.t)));
      for (const k of ks) edge.set(k, (edge.get(k) || 0) + 1);
    }
    const minRep = Math.max(3, Math.ceil(pages.length * 0.5));
    for (const pg of pages) {
      const n = pg.lines.length;
      pg.lines = pg.lines.filter((l, i) => {
        if (PAGE_NUM.test(l.t) || MORE.test(l.t)) return false;
        if ((i < 2 || i >= n - 2) && pages.length >= 3 && edge.get(keyOf(l.t)) >= minRep) return false;
        return true;
      });
    }
    // Huecos verticales grandes = separación de párrafos
    const deltas = [];
    for (const pg of pages) {
      for (let i = 1; i < pg.lines.length; i++) {
        const d = pg.lines[i - 1].y - pg.lines[i].y;
        if (d > 0 && d < pg.lines[i].fs * 4) deltas.push(d);
      }
    }
    deltas.sort((a, b) => a - b);
    const base = deltas.length ? deltas[Math.floor(deltas.length * 0.2)] : 14;
    const out = [];
    for (const pg of pages) {
      pg.lines.forEach((l, i) => {
        if (i > 0 && pg.lines[i - 1].y - l.y > base * 1.45) out.push({ blank: true });
        out.push({ t: l.t, x: Math.round(l.x) });
      });
    }
    return { lines: out };
  }

  /* ---------------- Word (.docx) ---------------- */
  async function fromDOCX(file) {
    await loadScript(V + 'mammoth.browser.min.js');
    const styleMap = [
      "p[style-name='Character'] => p.cue:fresh", "p[style-name='Personaje'] => p.cue:fresh", "p[style-name='Nombre'] => p.cue:fresh",
      "p[style-name='Dialogue'] => p.dia:fresh", "p[style-name='Diálogo'] => p.dia:fresh", "p[style-name='Dialogo'] => p.dia:fresh",
      "p[style-name='Parenthetical'] => p.par:fresh", "p[style-name='Paréntesis'] => p.par:fresh",
      "p[style-name='Action'] => p.act:fresh", "p[style-name='Acción'] => p.act:fresh", "p[style-name='Acotación'] => p.act:fresh", "p[style-name='Acotacion'] => p.act:fresh",
      "p[style-name='Scene Heading'] => p.scene:fresh", "p[style-name='Encabezado de escena'] => p.scene:fresh", "p[style-name='Escena'] => p.scene:fresh",
      "p[style-name='Transition'] => p.trans:fresh", "p[style-name='Transición'] => p.trans:fresh",
    ];
    const r = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { styleMap, ignoreEmptyParagraphs: false });
    return { lines: htmlToLines(r.value), styled: true };
  }

  /* ---------------- HTML → líneas (también usado por Word y ODT) ---------------- */
  function htmlToLines(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript,template').forEach((n) => n.remove());
    const lines = [];
    const PARA = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'DT', 'DD', 'BLOCKQUOTE']);
    const hasBlockChild = (el) => Array.from(el.children).some((c) => PARA.has(c.tagName) || ['DIV', 'TABLE', 'UL', 'OL', 'SECTION', 'ARTICLE'].includes(c.tagName));

    function paragraph(el) {
      const runs = [];
      (function collect(n, it, b) {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) runs.push({ s: c.nodeValue, it, b });
          else if (c.nodeType === 1) {
            const t = c.tagName;
            const st = c.getAttribute('style') || '';
            if (t === 'BR') runs.push({ br: true });
            else collect(c, it || t === 'EM' || t === 'I' || /italic/i.test(st), b || t === 'STRONG' || t === 'B' || /font-weight:\s*(bold|[6-9]00)/i.test(st));
          }
        }
      })(el, false, false);
      const groups = [[]];
      for (const r of runs) { if (r.br) groups.push([]); else groups[groups.length - 1].push(r); }
      if (!groups.some((g) => g.some((r) => r.s.trim()))) { lines.push({ blank: true }); return; }
      const cls = ' ' + (el.className || '') + ' ';
      let first = true;
      for (const g of groups) {
        const text = g.map((r) => r.s).join('').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const len = (r) => r.s.replace(/\s/g, '').length;
        const letters = g.reduce((n, r) => n + len(r), 0);
        const itl = g.reduce((n, r) => n + (r.it ? len(r) : 0), 0);
        const ln = { t: text, hard: true };
        if (!first) ln.br = true;
        if (letters && itl / letters > 0.85) ln.it = true;
        const fr = g.find((r) => r.s.trim());
        if (fr && fr.b) {
          let bt = '';
          for (const r of g) { if (!r.b && r.s.trim()) break; bt += r.s; }
          bt = bt.replace(/\s+/g, ' ').trim();
          if (bt === text) { const ni = Parser.nameInfo(text); if (ni && (ni.caps || ni.titled)) ln.cue = true; }
          else { ln.boldName = true; ln.boldText = bt.replace(/[\s:.\-–—]+$/, ''); }
        }
        if (cls.includes(' cue ')) ln.kind = 'cue';
        else if (cls.includes(' dia ')) ln.kind = 'dialogue';
        else if (cls.includes(' par ')) ln.kind = 'paren';
        else if (cls.includes(' act ') || cls.includes(' trans ')) ln.kind = 'action';
        else if (cls.includes(' scene ')) ln.kind = 'scene';
        else if (/^H[1-3]$/.test(el.tagName) && first && text.length < 80) {
          const ni = Parser.nameInfo(text);
          if (!ni || !(ni.caps || ni.titled) || ni.words > 3) { ln.kind = 'scene'; ln.level = el.tagName === 'H1' ? 1 : 2; delete ln.cue; }
        }
        lines.push(ln);
        first = false;
      }
    }

    function table(tb) {
      for (const tr of tb.querySelectorAll('tr')) {
        const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
        const tx = cells.map((c) => c.textContent.replace(/\s+/g, ' ').trim());
        let ni = 0;
        if (cells.length >= 3 && /^[\d:.,;\s-]+$/.test(tx[0])) ni = 1; // columna de código de tiempo
        const rest = tx.slice(ni + 1).filter(Boolean).join(' ');
        if (cells.length - ni >= 2 && tx[ni] && rest && Parser.nameInfo(tx[ni].replace(/[:.]+$/, ''))) {
          const name = tx[ni].replace(/[:.]+$/, '');
          lines.push({ t: `${name}: ${rest}`, hard: true, boldName: true, boldText: name });
        } else {
          for (const c of cells) { if (hasBlockChild(c)) walk(c); else paragraph(c); }
        }
      }
    }

    function walk(node) {
      for (const el of Array.from(node.children)) {
        if (el.tagName === 'TABLE') table(el);
        else if (PARA.has(el.tagName) && !hasBlockChild(el)) paragraph(el);
        else if (el.tagName === 'DIV' && !hasBlockChild(el)) paragraph(el);
        else walk(el);
      }
    }
    walk(doc.body);
    return lines;
  }

  /* ---------------- OpenDocument (.odt) ---------------- */
  async function fromODT(file) {
    await loadScript(V + 'jszip.min.js');
    const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
    const NS = {
      text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
      style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
      fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
      table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
      office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
    };
    const ital = new Set(), bold = new Set();
    const scan = (doc) => {
      for (const st of doc.getElementsByTagNameNS(NS.style, 'style')) {
        const name = st.getAttributeNS(NS.style, 'name');
        const tp = st.getElementsByTagNameNS(NS.style, 'text-properties')[0];
        if (!tp) continue;
        if (tp.getAttributeNS(NS.fo, 'font-style') === 'italic') ital.add(name);
        const fw = tp.getAttributeNS(NS.fo, 'font-weight');
        if (fw === 'bold' || Number(fw) >= 600) bold.add(name);
      }
    };
    const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
    if (zip.file('styles.xml')) scan(parse(await zip.file('styles.xml').async('string')));
    const doc = parse(await zip.file('content.xml').async('string'));
    scan(doc);
    const h = (s) => esc(s);
    const wrap = (sn, s) => { if (ital.has(sn)) s = `<em>${s}</em>`; if (bold.has(sn)) s = `<strong>${s}</strong>`; return s; };
    function inline(node) {
      let out = '';
      for (const c of node.childNodes) {
        if (c.nodeType === 3) out += h(c.nodeValue);
        else if (c.nodeType === 1) {
          const ln = c.localName;
          if (ln === 's') out += ' '.repeat(Number(c.getAttributeNS(NS.text, 'c')) || 1);
          else if (ln === 'tab') out += ' ';
          else if (ln === 'line-break') out += '<br>';
          else if (ln === 'note' || ln === 'annotation') continue;
          else if (ln === 'span') out += wrap(c.getAttributeNS(NS.text, 'style-name'), inline(c));
          else out += inline(c);
        }
      }
      return out;
    }
    const html = [];
    function block(node) {
      for (const c of Array.from(node.children)) {
        const ln = c.localName;
        if (ln === 'p' || ln === 'h') {
          const tag = ln === 'h' ? 'h2' : 'p';
          html.push(`<${tag}>${wrap(c.getAttributeNS(NS.text, 'style-name'), inline(c))}</${tag}>`);
        } else if (ln === 'table') {
          html.push('<table>');
          for (const row of c.getElementsByTagNameNS(NS.table, 'table-row')) {
            html.push('<tr>');
            for (const cell of row.getElementsByTagNameNS(NS.table, 'table-cell')) { html.push('<td>'); block(cell); html.push('</td>'); }
            html.push('</tr>');
          }
          html.push('</table>');
        } else if (['list', 'list-item', 'section', 'text', 'body', 'list-header'].includes(ln)) block(c);
      }
    }
    block(doc.getElementsByTagNameNS(NS.office, 'text')[0] || doc.documentElement);
    return { lines: htmlToLines(html.join('')), styled: true };
  }

  /* ---------------- RTF ---------------- */
  function rtfToText(rtf) {
    const DEST = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'headerf', 'footerl',
      'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore',
      'xmlnstbl', 'generator', 'mmathPr', 'fldinst', 'object', 'objdata', 'filetbl', 'revtbl', 'private', 'annotation', 'atnid',
      'atnauthor', 'nonshppict', 'shp', 'shpinst', 'sp', 'sn', 'sv', 'footnote', 'wgrffmtfilter', 'pgdsctbl']);
    const cp = new TextDecoder('windows-1252');
    const re = /\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z])|([{}])|([^\\{}\r\n]+)|[\r\n]+/g;
    const stack = [];
    let out = '', ignore = false, uc = 1, skip = 0, m;
    while ((m = re.exec(rtf))) {
      if (m[5]) {
        if (m[5] === '{') stack.push({ ignore, uc });
        else { const s = stack.pop(); if (s) { ignore = s.ignore; uc = s.uc; } }
        continue;
      }
      if (m[1]) {
        const w = m[1], n = m[2];
        if (DEST.has(w)) { ignore = true; continue; }
        if (w === 'uc') { uc = Number(n) || 0; continue; }
        if (ignore) continue;
        if (w === 'par' || w === 'line' || w === 'sect' || w === 'page' || w === 'row') out += '\n';
        else if (w === 'tab' || w === 'cell') out += ' ';
        else if (w === 'emdash') out += '—';
        else if (w === 'endash') out += '–';
        else if (w === 'lquote') out += '‘';
        else if (w === 'rquote') out += '’';
        else if (w === 'ldblquote') out += '“';
        else if (w === 'rdblquote') out += '”';
        else if (w === 'bullet') out += '•';
        else if (w === 'u') { let c = Number(n); if (c < 0) c += 65536; out += String.fromCharCode(c); skip = uc; }
        continue;
      }
      if (m[3]) { if (skip > 0) { skip--; continue; } if (!ignore) out += cp.decode(new Uint8Array([parseInt(m[3], 16)])); continue; }
      if (m[4]) {
        if (m[4] === '*') { ignore = true; continue; }
        if (ignore) continue;
        if (m[4] === '~') out += ' ';
        else if (m[4] === '_') out += '-';
        else if ('\\{}'.includes(m[4])) out += m[4];
        continue;
      }
      if (m[6]) {
        let s = m[6];
        if (skip > 0) { const k = Math.min(skip, s.length); s = s.slice(k); skip -= k; }
        if (!ignore) out += s;
      }
    }
    return out;
  }

  /* ---------------- Final Draft (.fdx) ---------------- */
  function fromFDX(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const KIND = { 'Scene Heading': 'scene', Character: 'cue', Dialogue: 'dialogue', Parenthetical: 'paren', Action: 'action', General: 'action', Shot: 'scene', Transition: 'action', 'Cast List': 'action', Lyrics: 'dialogue' };
    const lines = [];
    for (const p of doc.querySelectorAll('FinalDraft > Content > Paragraph')) {
      const t = Array.from(p.querySelectorAll('Text')).map((x) => x.textContent).join('').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      lines.push({ t, kind: KIND[p.getAttribute('Type')] || 'action', hard: true, level: 2 });
    }
    return { lines, styled: true };
  }

  /* ---------------- OCR (fotos o PDF escaneado) ---------------- */
  async function toCanvas(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close && bmp.close();
    return c;
  }

  async function ocrPages(count, getImage, progress, lang = 'spa') {
    progress && progress(null, 'Preparando el lector de texto (la primera vez tarda un poco)…');
    await loadScript(TESS);
    let cur = 0;
    const worker = await window.Tesseract.createWorker(lang, 1, {
      logger: (m) => {
        if (!progress) return;
        if (m.status === 'recognizing text') progress((cur + m.progress) / count, `Reconociendo texto · página ${cur + 1} de ${count}…`);
        else progress(null, 'Preparando el lector de texto (la primera vez tarda un poco)…');
      },
    });
    let text = '';
    try {
      for (cur = 0; cur < count; cur++) {
        const img = await getImage(cur);
        const { data } = await worker.recognize(img);
        text += data.text + '\n\n';
      }
    } finally {
      await worker.terminate();
    }
    return text;
  }

  async function fromImages(files, progress, lang) {
    const text = await ocrPages(files.length, (i) => toCanvas(files[i]), progress, lang);
    return { lines: Parser.textToLines(text) };
  }

  /* ---------------- Entrada principal ---------------- */
  const IMG_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp', 'gif'];
  const isImage = (f) => /^image\//.test(f.type || '') || IMG_EXT.includes(extOf(f.name));

  async function fromFile(file, progress, opts = {}) {
    const ext = extOf(file.name);
    const type = file.type || '';
    let res;
    if (ext === 'pdf' || type === 'application/pdf') res = await fromPDF(file, progress, opts);
    else if (ext === 'docx' || type.includes('wordprocessingml')) res = await fromDOCX(file);
    else if (ext === 'odt' || type.includes('opendocument.text')) res = await fromODT(file);
    else if (ext === 'rtf' || type.includes('rtf')) res = { lines: Parser.textToLines(rtfToText(await readText(file))) };
    else if (ext === 'fdx') res = fromFDX(await readText(file));
    else if (ext === 'fountain' || ext === 'spmd') { const f = Parser.fountainToLines(await readText(file)); res = { lines: f.lines, title: f.title }; }
    else if (ext === 'html' || ext === 'htm' || type === 'text/html') res = { lines: htmlToLines(await readText(file)), styled: true };
    else if (isImage(file)) res = await fromImages([file], progress, opts.ocrLang);
    else if (ext === 'doc') throw new Error('Los archivos .doc antiguos no se pueden leer aquí. Ábrelo en Word o Google Docs y guárdalo como .docx o PDF.');
    else if (ext === 'pages') throw new Error('Los archivos de Pages no se pueden leer. Expórtalo como Word (.docx) o PDF.');
    else {
      const text = await readText(file);
      const head = text.slice(0, 600);
      if (/<FinalDraft/i.test(head)) res = fromFDX(text);
      else if (/^\s*\{\\rtf/.test(head)) res = { lines: Parser.textToLines(rtfToText(text)) };
      else if (/[\x00-\x08\x0E-\x1A]/.test(text.slice(0, 3000))) throw new Error('No reconozco este tipo de archivo. Prueba con PDF, Word (.docx) o texto (.txt).');
      else res = { lines: Parser.textToLines(text) };
    }
    res.title = res.title || file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    return res;
  }

  return { fromFile, fromImages, isImage, htmlToLines, rtfToText };
})();
