// Copyright (c) 2026 Ehsan Madadi
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Turns the merged policy sections plus the instructor's draft into a document model
// that both renderers (HTML preview/PDF and Word) understand:
//   { title, subtitle: [string], fileName, blocks: [block] }
// Blocks are the Markdown blocks from markdown.js plus
//   { t: 'h', level: 1 | 2, runs } and
//   { t: 'table', head: [string], rows: [[runs]], widths: [number], caption, rowHeaders? }.

import { parseMarkdown, parseInline, runsToText } from './markdown.js';

export const DEFAULT_GRADING = [
  { letter: 'A', range: '90–100%' },
  { letter: 'B', range: '80–89%' },
  { letter: 'C', range: '70–79%' },
  { letter: 'D', range: '60–69%' },
  { letter: 'F', range: 'Below 60%' },
];

export function emptyDraft() {
  return {
    v: 1,
    semester: '',
    college: '',
    department: '',
    course: { code: '', title: '', units: '', section: '', classNumber: '',
      description: '', prerequisites: '', ge: '' },
    instructor: { name: '', email: '', phone: '', office: '', officeHours: '', officeHoursWhere: '' },
    meetings: { times: '', location: '' },
    modality: '',
    methods: [],
    slos: [''],
    assessments: [{ name: '', slo: '', weight: '' }, { name: '', slo: '', weight: '' },
      { name: '', slo: '', weight: '' }],
    grading: DEFAULT_GRADING.map((g) => ({ ...g })),
    schedule: [],
    sections: {},
    custom: [],
  };
}

const ph = (text) => [{ text: `[${text}]`, ph: true }];
const para = (runs) => ({ t: 'p', runs });
const md = (text) => parseMarkdown(text);
const has = (v) => typeof v === 'string' ? v.trim() !== '' : v != null;

export function parseCourseCode(code) {
  const m = /^\s*([A-Za-z]{2,5})[\s-]*(\d{1,3}[A-Za-z]{0,2})\s*$/.exec(code || '');
  return m ? { prefix: m[1].toUpperCase(), number: m[2].toUpperCase() } : null;
}

/** Bulleted "**Label:** text" items in a section body, keyed by label. */
export function labeledItems(body) {
  const out = [];
  for (const b of parseMarkdown(body)) {
    if (b.t !== 'ul') continue;
    for (const item of b.items) {
      if (item[0] && item[0].b) {
        const label = item[0].text.replace(/:\s*$/, '').trim();
        const rest = item.slice(1);
        if (rest[0]) rest[0] = { ...rest[0], text: rest[0].text.replace(/^\s+/, '') };
        out.push({ label, runs: rest });
      }
    }
  }
  return out;
}

/** Body paragraphs that are not part of a labeled list (intro text). */
function introBlocks(body) {
  return parseMarkdown(body).filter((b) => b.t !== 'ul');
}

export function isIncluded(section, draft) {
  if (section.lock !== 'optional') return true;
  const st = draft.sections[section.id];
  if (st && typeof st.include === 'boolean') return st.include;
  return section.start !== 'off';
}

/** The provided text of a section after any personalization by the instructor. */
export function sectionText(section, draft) {
  const st = draft.sections[section.id];
  const editable = section.lock === 'personalize' || section.lock === 'optional';
  if (editable && section.field === 'none' && st && typeof st.text === 'string') return st.text;
  return section.body;
}

function instructorText(section, draft) {
  const st = draft.sections[section.id];
  return st && typeof st.text === 'string' ? st.text : '';
}

const FIELD_RENDERERS = {
  none(s, d) {
    return md(sectionText(s, d));
  },

  text(s, d) {
    const own = instructorText(s, d);
    const blocks = md(s.body);
    if (has(own)) blocks.push(...md(own));
    else blocks.push(para(ph(`Add: ${s.title.split(':')[0]}`)));
    return blocks;
  },

  info(s, d) {
    const i = d.instructor;
    const rows = [
      ['Instructor', i.name, 'Instructor name'],
      ['Email', i.email, 'CSULB email'],
      ['Phone', i.phone, null],
      ['Office', i.office, null],
      ['Office Hours', i.officeHours, 'Office hour days and times'],
      ['Office Hours Location', i.officeHoursWhere, null],
      ['Class Days and Times', d.meetings.times, 'Class days and times'],
      ['Class Location', d.meetings.location, 'Room number, Zoom link, or off-campus location'],
    ]
      .filter(([, value, required]) => has(value) || required)
      .map(([label, value, required]) => [
        [{ text: label, b: true }],
        has(value) ? parseInline(value) : ph(required),
      ]);
    const blocks = [{ t: 'table', head: ['Item', 'Details'], rows, widths: [30, 70],
      caption: 'Class meetings and instructor contact information', rowHeaders: true }];
    blocks.push(...md(s.body));
    const own = instructorText(s, d);
    if (has(own)) blocks.push(...md(own));
    return blocks;
  },

  catalog(s, d) {
    const c = d.course;
    const blocks = md(s.body);
    if (has(c.description)) blocks.push(...md(c.description));
    else blocks.push(para(ph('Catalog description')));
    if (has(c.prerequisites)) {
      blocks.push(para([{ text: 'Prerequisites: ', b: true }, ...parseInline(c.prerequisites)]));
    }
    if (has(c.ge)) {
      blocks.push(para([{ text: 'General Education: ', b: true }, ...parseInline(c.ge)]));
    }
    const own = instructorText(s, d);
    if (has(own)) blocks.push(...md(own));
    return blocks;
  },

  slos(s, d) {
    const blocks = md(s.body);
    const slos = d.slos.filter(has);
    if (slos.length) blocks.push({ t: 'ol', items: slos.map((x) => parseInline(x)) });
    else blocks.push(para(ph('List the student learning outcomes from the Standard Course Outline')));
    const own = instructorText(s, d);
    if (has(own)) blocks.push(...md(own));
    return blocks;
  },

  modality(s, d) {
    const modes = labeledItems(s.body);
    const chosen = modes.find((m) => m.label === d.modality);
    const blocks = [];
    if (chosen) {
      blocks.push(para([{ text: 'This course is offered as ' }, { text: chosen.label, b: true },
        { text: '. ' }, ...chosen.runs]));
    } else {
      blocks.push(para(ph('Select the course modality')));
    }
    blocks.push(...introBlocks(s.body));
    const own = instructorText(s, d);
    if (has(own)) blocks.push(...md(own));
    return blocks;
  },

  methods(s, d) {
    const blocks = md(s.body);
    const methods = d.methods.filter(has);
    if (methods.length) {
      blocks.push(para([{ text: 'This course uses the following methods of presentation:' }]));
      blocks.push({ t: 'ul', items: methods.map((m) => [{ text: m }]) });
    }
    const own = instructorText(s, d);
    if (has(own)) blocks.push(...md(own));
    if (!methods.length && !has(own)) blocks.push(para(ph('Select the methods of presentation')));
    return blocks;
  },

  assessments(s, d) {
    const blocks = md(s.body);
    const rows = d.assessments.filter((a) => has(a.name) || has(a.weight));
    if (rows.length) {
      const total = sumWeights(rows);
      const tableRows = rows.map((a) => [
        has(a.name) ? parseInline(a.name) : ph('Assessment'),
        has(a.slo) ? parseInline(a.slo) : [{ text: '' }],
        has(a.weight) ? [{ text: formatWeight(a.weight) }] : ph('%'),
      ]);
      if (total !== null) tableRows.push([[{ text: 'Total', b: true }], [{ text: '' }],
        [{ text: `${round(total)}%`, b: true }]]);
      blocks.push({ t: 'table', head: ['Assessment', 'Linked SLOs', '% of Course Grade'],
        rows: tableRows, widths: [55, 22, 23], caption: 'Course assessments' });
    } else {
      blocks.push(para(ph('List the course assessments, linked SLOs, and percentage of the course grade')));
    }
    const own = instructorText(s, d);
    if (has(own)) blocks.push(...md(own));
    return blocks;
  },

  'grading-scale'(s, d) {
    const descriptors = Object.fromEntries(labeledItems(s.body).map((x) => [x.label, x.runs]));
    const blocks = introBlocks(s.body);
    const rows = d.grading.filter((g) => has(g.letter));
    const withDesc = rows.some((g) => descriptors[g.letter.trim()]);
    blocks.push({
      t: 'table',
      head: withDesc ? ['Grade', 'Range', 'Description'] : ['Grade', 'Range'],
      rows: rows.map((g) => {
        const cells = [[{ text: g.letter, b: true }], [{ text: g.range || '' }]];
        if (withDesc) cells.push(descriptors[g.letter.trim()] || [{ text: '' }]);
        return cells;
      }),
      widths: withDesc ? [12, 20, 68] : [40, 60],
      caption: 'Grading scale',
    });
    const own = instructorText(s, d);
    if (has(own)) blocks.push(...md(own));
    return blocks;
  },

  schedule(s, d) {
    const blocks = md(s.body);
    const rows = d.schedule.filter((r) => has(r.week) || has(r.date) || has(r.topic) || has(r.work) || has(r.due));
    if (rows.length) {
      const withDue = rows.some((r) => has(r.due));
      const head = ['Week', 'Date', 'Topics', 'Readings and Assignments'];
      if (withDue) head.push('Due');
      blocks.push({
        t: 'table', head, caption: 'Course schedule',
        widths: withDue ? [9, 13, 30, 33, 15] : [10, 14, 36, 40],
        rows: rows.map((r) => {
          const cells = [[{ text: r.week || '' }], [{ text: r.date || '' }],
            parseInline(r.topic || ''), parseInline(r.work || '')];
          if (withDue) cells.push(parseInline(r.due || ''));
          return cells;
        }),
      });
    } else {
      blocks.push(para(ph('Add the weekly schedule of topics, readings, assignments, and assessments')));
    }
    const own = instructorText(s, d);
    if (has(own)) blocks.push(...md(own));
    return blocks;
  },
};

export function sumWeights(rows) {
  let total = 0;
  for (const r of rows) {
    if (!has(r.weight)) continue;
    const n = parseFloat(String(r.weight).replace('%', ''));
    if (Number.isNaN(n)) return null;
    total += n;
  }
  return total;
}

const round = (n) => Math.round(n * 100) / 100;

function formatWeight(w) {
  const s = String(w).trim();
  return /%$/.test(s) ? s : `${s}%`;
}

export function renderSectionBlocks(section, draft) {
  const fn = FIELD_RENDERERS[section.field] || FIELD_RENDERERS.none;
  return fn(section, draft);
}

export function buildDocument({ semester, college, department, sections, draft }) {
  const c = draft.course;
  const code = parseCourseCode(c.code);
  const codeText = code ? `${code.prefix} ${code.number}` : (c.code || '').trim();
  const title = codeText || c.title
    ? [codeText, c.title].filter(has).join(': ')
    : 'Course Number and Title';

  const line1 = [semester.label];
  if (has(c.section)) line1.push(`Section ${c.section}`);
  if (has(c.classNumber)) line1.push(`Class ${c.classNumber}`);
  if (has(c.units)) line1.push(`${c.units} ${/^1(\.0)?$/.test(c.units.trim()) ? 'unit' : 'units'}`);
  const line2 = [college && college.name, department && department.name].filter(Boolean);
  const subtitle = [line1.join(' · '), line2.join(' · '), 'California State University, Long Beach']
    .filter(has);

  const blocks = [];
  let pendingHeading = null;
  const customs = (draft.custom || []).filter((x) => has(x.title) || has(x.text));
  const placed = new Set();
  const ids = new Set(sections.map((s) => s.id));

  const emitCustoms = (afterId) => {
    for (const x of customs) {
      if (x.after === afterId && !placed.has(x)) {
        placed.add(x);
        blocks.push({ t: 'h', level: 2, runs: [{ text: x.title || 'Additional Information' }] });
        blocks.push(...md(x.text));
      }
    }
  };

  for (const s of sections) {
    if (s.kind === 'heading') {
      pendingHeading = s;
      continue;
    }
    if (!isIncluded(s, draft)) continue;
    if (pendingHeading) {
      blocks.push({ t: 'h', level: 1, runs: [{ text: pendingHeading.title }] });
      pendingHeading = null;
    }
    if (!s.hideTitle) blocks.push({ t: 'h', level: 2, runs: [{ text: s.title }] });
    blocks.push(...renderSectionBlocks(s, draft));
    emitCustoms(s.id);
  }
  const leftovers = customs.filter((x) => !placed.has(x) && !ids.has(x.after));
  if (leftovers.length) {
    for (const x of leftovers) {
      blocks.push({ t: 'h', level: 2, runs: [{ text: x.title || 'Additional Information' }] });
      blocks.push(...md(x.text));
    }
  }

  const fileBase = [codeText.replace(/\s+/g, ''), has(c.section) ? `Sec${c.section}` : '',
    semester.label.replace(/\s+/g, ''), 'Syllabus']
    .filter(has).join('_').replace(/[^\w.-]+/g, '');

  return { title, subtitle, fileName: fileBase || 'Syllabus', blocks,
    author: draft.instructor.name || '', courseLine: [codeText, semester.label].filter(has).join(' · ') };
}

/** Count of unfilled placeholders, used by the checklist. */
export function countPlaceholders(doc) {
  let n = 0;
  const scan = (runs) => runs.forEach((r) => { if (r.ph) n++; });
  for (const b of doc.blocks) {
    if (b.runs) scan(b.runs);
    if (b.items) b.items.forEach(scan);
    if (b.rows) b.rows.forEach((row) => row.forEach(scan));
  }
  return n;
}

export { runsToText };
