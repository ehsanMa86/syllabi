// Copyright (c) 2026 Ehsan Madadi
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Renders the document model as a tagged (accessible) PDF with PDFKit (site/vendor/pdfkit)
// and the Carlito fonts (metric-compatible with Calibri, so the layout matches the Word file).
// Headings, paragraphs, lists and tables are tagged; borders, shading and page numbers are
// marked as artifacts. Table header rows repeat on each page.

const PT = 72; // points per inch
const PAGE = { width: 8.5 * PT, height: 11 * PT, margin: 1 * PT };
const BODY = 11;
const LINE_GAP = 2.2;
const COLORS = { text: '#000000', muted: '#404040', link: '#0B5394', placeholder: '#9A5B00',
  border: '#8C8C8C', shade: '#EDEDED' };
// Heading levels in the model: 1 = group, 2 = section, 3/4 = subheadings inside a section.
// The document title is H1 in the PDF, so model levels shift down by one.
const HEADINGS = {
  1: { tag: 'H2', size: 15, before: 16, after: 6 },
  2: { tag: 'H3', size: 12.5, before: 11, after: 4 },
  3: { tag: 'H4', size: 11.5, before: 8, after: 3 },
  4: { tag: 'H5', size: 11, before: 6, after: 2 },
};

let fontCache = null;

export async function loadPdfFonts(base = 'vendor/fonts/') {
  if (!fontCache) {
    const files = { regular: 'Carlito-Regular.ttf', bold: 'Carlito-Bold.ttf',
      italic: 'Carlito-Italic.ttf', boldItalic: 'Carlito-BoldItalic.ttf' };
    const entries = await Promise.all(Object.entries(files).map(async ([key, file]) => {
      const res = await fetch(base + file);
      if (!res.ok) throw new Error(`Could not load ${file}`);
      return [key, await res.arrayBuffer()];
    }));
    fontCache = Object.fromEntries(entries);
  }
  return fontCache;
}

export function buildPdf(PDFDocument, fonts, doc) {
  const pdf = new PDFDocument({
    size: 'LETTER',
    margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    tagged: true,
    lang: 'en-US',
    displayTitle: true,
    pdfVersion: '1.7',
    info: { Title: doc.title, Author: doc.author || '', Subject: 'Course syllabus', Creator: 'CSULB Syllabus Builder' },
  });
  pdf.registerFont('regular', fonts.regular);
  pdf.registerFont('bold', fonts.bold);
  pdf.registerFont('italic', fonts.italic);
  pdf.registerFont('boldItalic', fonts.boldItalic);

  const left = PAGE.margin;
  const width = PAGE.width - 2 * PAGE.margin;
  const bottom = () => pdf.page.height - pdf.page.margins.bottom;
  const fontKey = (r, bold) => {
    const b = r.b || r.ph || bold;
    return b && r.i ? 'boldItalic' : b ? 'bold' : r.i ? 'italic' : 'regular';
  };
  const ensure = (space) => {
    if (pdf.y + space > bottom()) pdf.addPage();
  };
  const artifact = (draw) => {
    pdf.markContent('Artifact');
    draw();
    pdf.endMarkedContent();
  };

  /** Write a run list as one flowing paragraph. */
  const writeRuns = (runs, { x = left, y = pdf.y, w = width, size = BODY, bold = false, color = COLORS.text,
    align } = {}) => {
    const list = runs.filter((r) => r.text);
    if (!list.length) return;
    list.forEach((r, i) => {
      pdf.font(fontKey(r, bold)).fontSize(size)
        .fillColor(r.href ? COLORS.link : r.ph ? COLORS.placeholder : color);
      const opts = { continued: i < list.length - 1, link: r.href || null, underline: !!r.href,
        lineGap: LINE_GAP, ...(align ? { align } : {}) };
      if (i === 0) pdf.text(r.text, x, y, { ...opts, width: w });
      else pdf.text(r.text, opts);
    });
    pdf.x = left;
  };

  const heightOf = (runs, w, size = BODY, bold = false) => {
    const text = runs.map((r) => r.text).join('') || ' ';
    const anyBold = bold || runs.some((r) => r.b || r.ph);
    pdf.font(anyBold ? 'bold' : 'regular').fontSize(size);
    return pdf.heightOfString(text, { width: w, lineGap: LINE_GAP });
  };

  const root = pdf.struct('Document');
  pdf.addStructure(root);

  // Title block
  root.add(pdf.struct('H1', () => writeRuns([{ text: doc.title }], { size: 20, bold: true })));
  pdf.y += 2;
  for (const line of doc.subtitle) {
    root.add(pdf.struct('P', () => writeRuns([{ text: line }], { color: COLORS.muted })));
  }
  pdf.y += 12;

  const paragraph = (runs) => {
    ensure(BODY * 1.4);
    root.add(pdf.struct('P', () => writeRuns(runs)));
    pdf.y += 5;
  };

  const heading = (b, next) => {
    const style = HEADINGS[b.level] || HEADINGS[3];
    // Keep the heading with at least the start of what follows it.
    const follow = next && next.t === 'table' ? 60 : 40;
    pdf.y += style.before;
    if (pdf.y + style.size * 1.5 + follow > bottom()) pdf.addPage();
    root.add(pdf.struct(style.tag, () => writeRuns(b.runs, { size: style.size, bold: true })));
    pdf.y += style.after;
  };

  const list = (b) => {
    const L = pdf.struct('L');
    root.add(L);
    const indent = 22;
    b.items.forEach((item, i) => {
      ensure(BODY * 1.4);
      const LI = pdf.struct('LI');
      L.add(LI);
      const y = pdf.y;
      const label = b.t === 'ol' ? `${i + 1}.` : '•';
      LI.add(pdf.struct('Lbl', () => {
        pdf.font('regular').fontSize(BODY).fillColor(COLORS.text)
          .text(label, left + 6, y, { width: indent - 6, lineBreak: false, lineGap: LINE_GAP });
      }));
      LI.add(pdf.struct('LBody', () => writeRuns(item, { x: left + indent, y, w: width - indent })));
      LI.end();
      pdf.y += 2;
    });
    L.end();
    pdf.y += 4;
  };

  const table = (b) => {
    const widths = (b.widths || b.head.map(() => 100 / b.head.length)).map((p) => (p / 100) * width);
    const xs = widths.reduce((acc, w, i) => [...acc, acc[i] + w], [left]);
    const pad = 5;
    const T = pdf.struct('Table');
    root.add(T);

    const rowHeight = (cells, header) => Math.max(...cells.map((runs, i) =>
      heightOf(runs, widths[i] - 2 * pad, BODY, header || (b.rowHeaders && i === 0)))) + 2 * pad;

    const drawRow = (cells, { header = false, tagged = true, parent = T }) => {
      const h = rowHeight(cells, header);
      const y = pdf.y;
      artifact(() => {
        cells.forEach((_, i) => {
          const shaded = header || (b.rowHeaders && i === 0);
          if (shaded) pdf.rect(xs[i], y, widths[i], h).fill(COLORS.shade);
          pdf.lineWidth(0.6).strokeColor(COLORS.border).rect(xs[i], y, widths[i], h).stroke();
        });
      });
      const draw = (runs, i) => writeRuns(runs.length ? runs : [{ text: '' }],
        { x: xs[i] + pad, y: y + pad, w: widths[i] - 2 * pad, bold: header || (b.rowHeaders && i === 0) });
      if (tagged) {
        const TR = pdf.struct('TR');
        parent.add(TR);
        cells.forEach((runs, i) => {
          const tag = header || (b.rowHeaders && i === 0) ? 'TH' : 'TD';
          TR.add(pdf.struct(tag, () => draw(runs, i)));
        });
        TR.end();
      } else {
        // A repeated header row on a continuation page is decoration, not content.
        artifact(() => cells.forEach((runs, i) => draw(runs, i)));
      }
      pdf.y = y + h;
      pdf.x = left;
    };

    const head = b.rowHeaders ? null : b.head.map((text) => [{ text }]);
    let THead = null;
    if (head) {
      ensure(rowHeight(head, true) + rowHeight(b.rows[0] || head, false));
      THead = pdf.struct('THead');
      T.add(THead);
      drawRow(head, { header: true, parent: THead });
      THead.end();
    }
    const TBody = pdf.struct('TBody');
    T.add(TBody);
    for (const row of b.rows) {
      const h = rowHeight(row, false);
      if (pdf.y + h > bottom()) {
        pdf.addPage();
        if (head) drawRow(head, { header: true, tagged: false });
      }
      drawRow(row, { parent: TBody });
    }
    TBody.end();
    T.end();
    pdf.y += 10;
  };

  doc.blocks.forEach((b, i) => {
    if (b.t === 'h') heading(b, doc.blocks[i + 1]);
    else if (b.t === 'p') paragraph(b.runs);
    else if (b.t === 'ul' || b.t === 'ol') list(b);
    else if (b.t === 'table') table(b);
  });
  root.end();

  // Footer with page numbers on every page.
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    const saved = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    pdf.markContent('Artifact', { type: 'Pagination' });
    const label = `${doc.courseLine ? `${doc.courseLine} · ` : ''}Page ${i + 1} of ${range.count}`;
    pdf.font('regular').fontSize(9).fillColor(COLORS.muted)
      .text(label, left, pdf.page.height - 0.55 * PT, { width, align: 'right', lineBreak: false });
    pdf.endMarkedContent();
    pdf.page.margins.bottom = saved;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' })));
    pdf.on('error', reject);
    pdf.end();
  });
}
