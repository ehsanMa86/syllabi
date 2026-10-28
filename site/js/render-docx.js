// Copyright (c) 2026 Ehsan Madadi
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Renders the document model as an editable, accessible Word document using the docx
// library (site/vendor/docx). Headings use Word's built-in heading styles, lists use real
// Word numbering, and table header rows repeat across pages, so the file passes Word's
// accessibility checker and exports to a tagged PDF.

const PAGE_WIDTH = 9360; // 6.5 in of usable width, in twentieths of a point

export function buildDocx(docx, doc) {
  const {
    Document, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, Table, TableRow, TableCell,
    WidthType, ShadingType, Footer, PageNumber, AlignmentType, LevelFormat, BorderStyle,
  } = docx;

  const line = { style: BorderStyle.SINGLE, size: 6, color: '8C8C8C' };
  const BORDERS = { top: line, bottom: line, left: line, right: line };

  let listInstance = 0;

  // Only set bold/italics when on: an explicit "off" would override heading styles.
  const runs = (list, extra = {}) => list.map((r) => {
    const opts = { text: r.text };
    if (r.b || extra.bold) opts.bold = true;
    if (r.i) opts.italics = true;
    if (r.ph) opts.highlight = 'yellow';
    if (r.href) {
      return new ExternalHyperlink({ link: r.href, children: [new TextRun({ ...opts, style: 'Hyperlink' })] });
    }
    return new TextRun(opts);
  });

  const HEADINGS = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };

  const table = (b) => {
    const widths = (b.widths || b.head.map(() => 100 / b.head.length))
      .map((w) => Math.round((w / 100) * PAGE_WIDTH));
    const cell = (children, i, header) => new TableCell({
      children,
      width: { size: widths[i], type: WidthType.DXA },
      borders: BORDERS,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      ...(header ? { shading: { fill: 'EDEDED', type: ShadingType.CLEAR, color: 'auto' } } : {}),
    });
    const rows = [];
    if (!b.rowHeaders) {
      rows.push(new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: b.head.map((h, i) => cell([new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: h, bold: true })] })], i, true)),
      }));
    }
    for (const row of b.rows) {
      rows.push(new TableRow({
        cantSplit: true,
        children: row.map((c, i) => cell(
          [new Paragraph({ spacing: { after: 0 }, children: runs(c, { bold: b.rowHeaders && i === 0 }) })],
          i, b.rowHeaders && i === 0,
        )),
      }));
    }
    return new Table({
      rows, width: { size: PAGE_WIDTH, type: WidthType.DXA }, columnWidths: widths,
      borders: { ...BORDERS, insideHorizontal: line, insideVertical: line },
    });
  };

  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(doc.title)] }),
    ...doc.subtitle.map((s, i) => new Paragraph({
      style: 'Subtitle',
      spacing: { after: i === doc.subtitle.length - 1 ? 240 : 0 },
      children: [new TextRun(s)],
    })),
  ];

  for (const b of doc.blocks) {
    if (b.t === 'h') {
      children.push(new Paragraph({ heading: HEADINGS[b.level] || HeadingLevel.HEADING_3, children: runs(b.runs) }));
    } else if (b.t === 'p') {
      children.push(new Paragraph({ children: runs(b.runs) }));
    } else if (b.t === 'ul' || b.t === 'ol') {
      const instance = ++listInstance;
      b.items.forEach((item, i) => {
        children.push(new Paragraph({
          numbering: { reference: b.t === 'ul' ? 'syllabus-bullets' : 'syllabus-numbers', level: 0, instance },
          spacing: { after: i === b.items.length - 1 ? 120 : 40 },
          children: runs(item),
        }));
      });
    } else if (b.t === 'table') {
      children.push(table(b));
      children.push(new Paragraph({ children: [] }));
    }
  }

  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({
        size: 18,
        children: [doc.courseLine ? `${doc.courseLine} · Page ` : 'Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
      })],
    })],
  });

  const listLevel = (format, text) => ({
    level: 0, format, text, alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720, hanging: 360 } } },
  });

  return new Document({
    creator: doc.author || 'Instructor',
    title: doc.title,
    subject: 'Course syllabus',
    description: doc.subtitle.join(' | '),
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22, language: { value: 'en-US' } },
          paragraph: { spacing: { after: 120, line: 276 } } },
        title: { run: { font: 'Calibri', size: 40, bold: true, color: '000000' },
          paragraph: { spacing: { after: 60 } } },
        heading1: { run: { font: 'Calibri', size: 30, bold: true, color: '000000' },
          paragraph: { spacing: { before: 360, after: 120 }, keepNext: true } },
        heading2: { run: { font: 'Calibri', size: 25, bold: true, color: '000000' },
          paragraph: { spacing: { before: 240, after: 80 }, keepNext: true } },
        heading3: { run: { font: 'Calibri', size: 23, bold: true, color: '1F1F1F' },
          paragraph: { spacing: { before: 200, after: 60 }, keepNext: true } },
        heading4: { run: { font: 'Calibri', size: 22, bold: true, italics: true, color: '1F1F1F' },
          paragraph: { spacing: { before: 160, after: 60 }, keepNext: true } },
        hyperlink: { run: { color: '0B5394', underline: { type: 'single' } } },
      },
      paragraphStyles: [{
        id: 'Normal', name: 'Normal', quickFormat: true,
        run: { font: 'Calibri', size: 22 },
        paragraph: { spacing: { after: 120, line: 276 } },
      }, {
        id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, color: '404040' },
      }],
    },
    numbering: {
      config: [
        { reference: 'syllabus-bullets', levels: [listLevel(LevelFormat.BULLET, '•')] },
        { reference: 'syllabus-numbers', levels: [listLevel(LevelFormat.DECIMAL, '%1.')] },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      footers: { default: footer },
      children,
    }],
  });
}

export async function docxBlob(docx, doc) {
  return docx.Packer.toBlob(buildDocx(docx, doc));
}
