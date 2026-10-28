// Copyright (c) 2026 Ehsan Madadi. All rights reserved.
// See LICENSE in the project root.
//
// One form card per syllabus section, in document order. The kind of editor follows the
// section's "lock" and "field" settings from the content files.

import { h, uid, hashString } from './util.js';
import { parseMarkdown, parseInline } from './markdown.js';
import { runsHtml } from './render-html.js';
import { isIncluded, labeledItems, sumWeights, DEFAULT_GRADING } from './document.js';

const LOCK_LABELS = {
  required: ['Required text', 'Provided by the university or college. It is included as written.'],
  personalize: ['Editable', 'Starts with the provided text. You may personalize it.'],
  optional: ['Optional', 'You choose whether to include it, and you may edit it.'],
};

function prose(markdown) {
  const html = parseMarkdown(markdown).map((b) => {
    if (b.t === 'p') return `<p>${runsHtml(b.runs)}</p>`;
    if (b.t === 'h') return `<h5>${runsHtml(b.runs)}</h5>`;
    return `<${b.t}>${b.items.map((it) => `<li>${runsHtml(it)}</li>`).join('')}</${b.t}>`;
  }).join('');
  return h('div', { class: 'prose', html });
}

const state = (draft, id) => (draft.sections[id] ||= {});

function field(label, input, hint) {
  const id = input.id || (input.id = uid('f'));
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null);
}

function textInput(value, onInput, attrs = {}) {
  return h('input', { type: 'text', value: value || '', oninput: (e) => onInput(e.target.value), ...attrs });
}

function textArea(value, onInput, attrs = {}) {
  return h('textarea', { rows: 4, oninput: (e) => onInput(e.target.value), ...attrs }, value || '');
}

const FORMAT_HINT = 'One paragraph per line. Start a line with "- " for a bullet. **bold**, [link text](https://...)';

/** Editor for the instructor's own text attached to any section. */
function ownText(draft, s, ctx, label, attrs = {}) {
  const st = state(draft, s.id);
  return field(label, textArea(st.text, (v) => { st.text = v; ctx.changed(); }, attrs), FORMAT_HINT);
}

function listEditor({ rows, columns, onChange, addLabel, rowLabel, minRows = 0 }) {
  const wrap = h('div', { class: 'rows' });
  const render = () => {
    wrap.replaceChildren();
    rows.forEach((row, i) => {
      const cells = columns.map((col) => {
        const input = textInput(row[col.key], (v) => { row[col.key] = v; onChange(false); },
          { 'aria-label': `${col.label}, ${rowLabel} ${i + 1}`, placeholder: col.placeholder || col.label,
            class: col.class || '' });
        return h('div', { class: `cell ${col.class || ''}`, 'data-label': col.label }, input);
      });
      const remove = h('button', {
        type: 'button', class: 'icon-btn', title: `Remove ${rowLabel} ${i + 1}`,
        'aria-label': `Remove ${rowLabel} ${i + 1}`, disabled: rows.length <= minRows,
        onclick: () => { rows.splice(i, 1); render(); onChange(true); },
      }, '×');
      wrap.append(h('div', { class: 'row', style: `--cols:${columns.map((c) => c.width || '1fr').join(' ')}` }, ...cells, remove));
    });
  };
  render();
  const add = h('button', { type: 'button', class: 'link-btn', onclick: () => {
    rows.push(Object.fromEntries(columns.map((c) => [c.key, ''])));
    render();
    onChange(true);
    wrap.querySelector('.row:last-child input')?.focus();
  } }, `+ ${addLabel}`);
  const head = h('div', { class: 'row row-head', 'aria-hidden': 'true', style: `--cols:${columns.map((c) => c.width || '1fr').join(' ')}` },
    ...columns.map((c) => h('span', { class: `cell ${c.class || ''}` }, c.label)), h('span'));
  return { el: h('div', { class: 'list-editor' }, head, wrap, add), render };
}

const EDITORS = {
  info(s, draft, ctx) {
    const i = draft.instructor;
    const m = draft.meetings;
    const bind = (obj, key) => (v) => { obj[key] = v; ctx.changed(); };
    return [
      h('div', { class: 'grid2' },
        field('Instructor name', textInput(i.name, bind(i, 'name'), { autocomplete: 'name' })),
        field('CSULB email', textInput(i.email, bind(i, 'email'), { type: 'email', autocomplete: 'email' })),
        field('Phone (optional)', textInput(i.phone, bind(i, 'phone'), { type: 'tel' })),
        field('Office', textInput(i.office, bind(i, 'office'), { placeholder: 'Building and room' })),
        field('Office hours', textInput(i.officeHours, bind(i, 'officeHours'), { placeholder: 'e.g. Wednesdays 5:00–6:00 pm' })),
        field('Office hours location', textInput(i.officeHoursWhere, bind(i, 'officeHoursWhere'), { placeholder: 'Office, Zoom link, or both' })),
        field('Class days and times', textInput(m.times, bind(m, 'times'), { placeholder: 'e.g. MW 10:00–11:15 am' })),
        field('Class location', textInput(m.location, bind(m, 'location'), { placeholder: 'Room, Zoom link, or off-campus site' })),
      ),
    ];
  },

  catalog(s, draft, ctx) {
    const c = draft.course;
    return [
      h('p', { class: 'hint' }, 'Filled in when you look up the course above. You may add detail, but the catalog description must be included.'),
      field('Catalog description', textArea(c.description, (v) => { c.description = v; ctx.changed(); }, { rows: 5, 'data-bind': 'description' })),
      h('div', { class: 'grid2' },
        field('Prerequisites', textInput(c.prerequisites, (v) => { c.prerequisites = v; ctx.changed(); }, { 'data-bind': 'prerequisites' })),
        field('General Education category', textInput(c.ge, (v) => { c.ge = v; ctx.changed(); }, { 'data-bind': 'ge' }))),
      ownText(draft, s, ctx, 'Additional detail (optional)', { rows: 3 }),
    ];
  },

  slos(s, draft, ctx) {
    const rows = draft.slos.map((text) => ({ text }));
    const sync = (structural) => { draft.slos = rows.map((r) => r.text); ctx.changed(structural); };
    const editor = listEditor({ rows, columns: [{ key: 'text', label: 'Learning outcome', placeholder: 'Students will be able to…' }],
      onChange: sync, addLabel: 'Add outcome', rowLabel: 'outcome' });
    return [editor.el];
  },

  text(s, draft, ctx) {
    return [ownText(draft, s, ctx, 'Your text', { rows: 5, placeholder: s.prompt || '' })];
  },

  modality(s, draft, ctx) {
    const name = uid('modality');
    const options = labeledItems(s.body).map((m) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name, value: m.label, checked: draft.modality === m.label,
        onchange: () => { draft.modality = m.label; ctx.changed(); } }),
      h('span', {}, h('strong', {}, m.label), h('span', { class: 'hint', html: ` ${runsHtml(m.runs)}` }))));
    return [h('fieldset', { class: 'choices' }, h('legend', {}, 'Mode of instruction'), ...options),
      ownText(draft, s, ctx, 'Notes about how the course meets (optional)', { rows: 2 })];
  },

  methods(s, draft, ctx) {
    const boxes = s.options.map((opt) => h('label', { class: 'choice inline' },
      h('input', { type: 'checkbox', checked: draft.methods.includes(opt), onchange: (e) => {
        draft.methods = e.target.checked ? [...draft.methods, opt] : draft.methods.filter((x) => x !== opt);
        draft.methods.sort((a, b) => s.options.indexOf(a) - s.options.indexOf(b));
        ctx.changed();
      } }), h('span', {}, opt)));
    return [h('fieldset', { class: 'choices cols' }, h('legend', {}, 'Methods used in this course'), ...boxes),
      ownText(draft, s, ctx, 'Other methods or description (optional)', { rows: 2 })];
  },

  assessments(s, draft, ctx) {
    const status = h('p', { class: 'calc', 'aria-live': 'polite' });
    const update = () => {
      const named = draft.assessments.filter((a) => a.name.trim());
      const total = sumWeights(draft.assessments);
      const over = draft.assessments.filter((a) => parseFloat(a.weight) > 33.34);
      const notes = [];
      notes.push(total === null ? 'Weights must be numbers.' : `Total: ${Math.round(total * 100) / 100}%`);
      if (total !== null && Math.abs(total - 100) > 0.01 && named.length) notes.push('should be 100%');
      if (named.length < 3) notes.push('PS 12-03 needs at least three assessments');
      if (over.length) notes.push(`${over.map((a) => a.name || 'an assessment').join(', ')} exceeds 33 1/3%`);
      status.textContent = notes.join(' · ');
      status.classList.toggle('warn', notes.length > 1 || total === null);
    };
    const editor = listEditor({
      rows: draft.assessments,
      columns: [
        { key: 'name', label: 'Assessment', placeholder: 'e.g. Midterm exam', width: '2.2fr' },
        { key: 'slo', label: 'Linked SLOs', placeholder: 'e.g. SLO 1, 3', width: '1.1fr' },
        { key: 'weight', label: '% of grade', placeholder: '%', width: '0.8fr', class: 'num' },
      ],
      onChange: (structural) => { update(); ctx.changed(structural); },
      addLabel: 'Add assessment', rowLabel: 'assessment',
    });
    update();
    return [editor.el, status, ownText(draft, s, ctx, 'Description of assessments (optional)', { rows: 3 })];
  },

  'grading-scale'(s, draft, ctx) {
    const editor = listEditor({
      rows: draft.grading,
      columns: [{ key: 'letter', label: 'Grade', width: '0.7fr' }, { key: 'range', label: 'Range', width: '2fr' }],
      onChange: (structural) => ctx.changed(structural), addLabel: 'Add grade', rowLabel: 'grade',
    });
    const reset = h('button', { type: 'button', class: 'link-btn', onclick: () => {
      draft.grading.splice(0, draft.grading.length, ...DEFAULT_GRADING.map((g) => ({ ...g })));
      editor.render();
      ctx.changed(true);
    } }, 'Restore the PS 12-03 scale');
    return [editor.el, reset, ownText(draft, s, ctx, 'Grading notes (optional)', { rows: 2 })];
  },

  schedule(s, draft, ctx) {
    const editor = listEditor({
      rows: draft.schedule,
      columns: [
        { key: 'week', label: 'Week', width: '0.55fr' },
        { key: 'date', label: 'Date', width: '0.9fr' },
        { key: 'topic', label: 'Topics', width: '1.6fr' },
        { key: 'work', label: 'Readings and assignments', width: '1.6fr' },
        { key: 'due', label: 'Due', width: '0.9fr' },
      ],
      onChange: (structural) => ctx.changed(structural), addLabel: 'Add row', rowLabel: 'row',
    });
    const start = h('input', { type: 'date', id: uid('start') });
    const weeks = h('input', { type: 'number', min: 1, max: 20, value: '16', id: uid('weeks'), class: 'num' });
    const fill = h('button', { type: 'button', onclick: () => {
      const n = Math.max(1, Math.min(20, parseInt(weeks.value, 10) || 16));
      const first = start.value ? new Date(`${start.value}T12:00:00`) : null;
      const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
      for (let w = 0; w < n; w++) {
        const row = draft.schedule[w] || (draft.schedule[w] = { week: '', date: '', topic: '', work: '', due: '' });
        if (!row.week) row.week = String(w + 1);
        if (first && !row.date) row.date = fmt.format(new Date(first.getTime() + w * 7 * 86400000));
      }
      if (!draft.schedule.some((r) => /final/i.test(r.week))) {
        draft.schedule.push({ week: 'Finals', date: '', topic: 'Final assessment', work: '', due: '' });
      }
      editor.render();
      ctx.changed(true);
    } }, 'Create weekly rows');
    return [
      h('div', { class: 'toolbar-row' },
        field('First class date (optional)', start),
        field('Weeks', weeks),
        fill),
      editor.el,
      ownText(draft, s, ctx, 'Schedule notes (optional)', { rows: 2 }),
    ];
  },
};

function personalizeEditor(s, draft, ctx) {
  const st = state(draft, s.id);
  const base = hashString(s.body);
  const area = textArea(typeof st.text === 'string' ? st.text : s.body, (v) => {
    st.text = v;
    st.base = base;
    ctx.changed();
  }, { rows: Math.min(14, Math.max(4, Math.ceil(s.body.length / 90))) });
  const reset = h('button', { type: 'button', class: 'link-btn', onclick: () => {
    delete st.text;
    delete st.base;
    area.value = s.body;
    notice?.remove();
    ctx.changed();
  } }, 'Restore the provided text');
  let notice = null;
  if (typeof st.text === 'string' && st.base && st.base !== base) {
    notice = h('div', { class: 'notice' },
      h('p', {}, 'The provided text for this section was updated after you personalized it. Review the new version:'),
      h('details', {}, h('summary', {}, 'Show the new provided text'), prose(s.body)));
  }
  return [notice, field('Text', area, FORMAT_HINT), reset];
}

export function sectionCard(s, draft, ctx) {
  if (s.kind === 'heading') {
    return h('h2', { class: 'group-title', id: `form-${s.id}` }, s.title);
  }
  const [badge, badgeHelp] = s.field !== 'none' && s.lock !== 'optional'
    ? ['You complete', 'Fill in this section for your course.']
    : LOCK_LABELS[s.lock];
  const card = h('section', { class: `card lock-${s.lock}`, id: `form-${s.id}`, 'aria-labelledby': `t-${s.id}` });
  const header = h('div', { class: 'card-head' },
    h('h3', { id: `t-${s.id}` }, s.hideTitle ? `${s.title} (shown without a heading)` : s.title),
    h('span', { class: `badge badge-${s.field !== 'none' && s.lock !== 'optional' ? 'fill' : s.lock}`, title: badgeHelp }, badge));
  card.append(header);
  card.append(h('p', { class: 'layers' }, `From: ${s.layers.join(' → ')}`));
  if (s.prompt) card.append(h('p', { class: 'prompt', html: runsHtml(parseInline(s.prompt)) }));

  const body = h('div', { class: 'card-body' });
  if (s.field !== 'none') body.append(...EDITORS[s.field](s, draft, ctx).filter(Boolean));
  else if (s.lock === 'required') {
    body.append(h('details', { class: 'provided' }, h('summary', {}, 'Read the text'), prose(s.body)));
  } else body.append(...personalizeEditor(s, draft, ctx).filter(Boolean));

  if (s.lock === 'optional') {
    const st = state(draft, s.id);
    const box = h('input', { type: 'checkbox', checked: isIncluded(s, draft), onchange: (e) => {
      st.include = e.target.checked;
      body.hidden = !e.target.checked;
      card.classList.toggle('excluded', !e.target.checked);
      ctx.changed();
    } });
    body.hidden = !box.checked;
    card.classList.toggle('excluded', !box.checked);
    header.after(h('label', { class: 'include' }, box, ' Include this section in my syllabus'));
  }
  card.append(body);
  return card;
}

export function customSectionsCard(sections, draft, ctx) {
  const list = h('div', { class: 'customs' });
  const placeable = sections.filter((s) => s.kind !== 'heading');
  const render = () => {
    list.replaceChildren();
    draft.custom.forEach((x, i) => {
      const where = h('select', { onchange: (e) => { x.after = e.target.value; ctx.changed(true); } },
        ...placeable.map((s) => h('option', { value: s.id, selected: x.after === s.id }, s.title)));
      list.append(h('div', { class: 'custom' },
        field('Section title', textInput(x.title, (v) => { x.title = v; ctx.changed(); })),
        field('Text', textArea(x.text, (v) => { x.text = v; ctx.changed(); }, { rows: 4 }), FORMAT_HINT),
        field('Place it after', where),
        h('button', { type: 'button', class: 'link-btn danger', onclick: () => {
          draft.custom.splice(i, 1);
          render();
          ctx.changed(true);
        } }, 'Remove this section')));
    });
  };
  render();
  return h('section', { class: 'card', id: 'form-custom', 'aria-labelledby': 't-custom' },
    h('div', { class: 'card-head' }, h('h3', { id: 't-custom' }, 'Your additional sections'),
      h('span', { class: 'badge badge-optional' }, 'Optional')),
    h('p', { class: 'prompt' }, 'Add anything else your course needs, such as lab safety rules, field trip details, or a teaching philosophy.'),
    list,
    h('button', { type: 'button', class: 'link-btn', onclick: () => {
      draft.custom.push({ id: uid('custom'), title: '', text: '', after: placeable.at(-1)?.id || '' });
      render();
      ctx.changed(true);
      list.querySelector('.custom:last-child input')?.focus();
    } }, '+ Add a section'));
}
