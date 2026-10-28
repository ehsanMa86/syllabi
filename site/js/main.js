// Copyright (c) 2026 Ehsan Madadi. All rights reserved.
// See LICENSE in the project root.

import { h, debounce, fetchJson, downloadBlob, loadScript } from './util.js';
import { buildDocument, emptyDraft, countPlaceholders, isIncluded, sectionText, sumWeights, parseCourseCode } from './document.js';
import { renderHtml, runsHtml } from './render-html.js';
import { parseInline } from './markdown.js';
import { docxBlob } from './render-docx.js';
import { sectionCard, customSectionsCard } from './editors.js';
import { loadDraft, saveDraft, clearDraft, draftFile, readDraftFile } from './store.js';
import { lookupCourse, catalogIndex } from './catalog.js';

const app = {
  semesters: [],
  index: null, // current semester index.json
  sections: [],
  draft: null,
};

const $ = (sel) => document.querySelector(sel);
const formEl = $('#form-sections');
const setupEl = $('#setup');
const previewEl = $('#preview');
const statusEl = $('#status');

function announce(message, kind = 'info') {
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
  statusEl.classList.add('show');
  clearTimeout(announce.t);
  announce.t = setTimeout(() => statusEl.classList.remove('show'), 6000);
}

const persist = debounce(() => saveDraft(app.draft), 400);
const refreshPreview = debounce(() => renderPreview(), 180);

function changed() {
  persist();
  refreshPreview();
}

const currentCollege = () => app.index?.colleges.find((c) => c.id === app.draft.college) || null;
const currentDepartment = () => currentCollege()?.departments.find((d) => d.id === app.draft.department) || null;
const currentSemester = () => app.semesters.find((s) => s.id === app.draft.semester);

function currentDoc() {
  return buildDocument({
    semester: currentSemester(),
    college: currentCollege(),
    department: currentDepartment(),
    sections: app.sections,
    draft: app.draft,
  });
}

// ------------------------------------------------------------------ loading

async function loadSemester(id) {
  app.index = await fetchJson(`data/${id}/index.json`);
}

async function loadSections() {
  const college = currentCollege();
  if (!college) {
    app.sections = [];
    return;
  }
  const dep = currentDepartment();
  const key = dep ? `${college.id}.${dep.id}` : college.id;
  app.sections = (await fetchJson(`data/${app.draft.semester}/${key}.json`)).sections;
}

async function reload() {
  try {
    await loadSections();
  } catch (e) {
    announce('Could not load the policy text for this selection.', 'error');
    console.error(e);
    app.sections = [];
  }
  renderSetup();
  renderForm();
  renderPreview();
}

// ------------------------------------------------------------------ setup card

function select(label, options, value, onChange, attrs = {}) {
  const id = attrs.id || `sel-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const el = h('select', { id, onchange: (e) => onChange(e.target.value), ...attrs },
    ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
  return h('div', { class: 'field' }, h('label', { for: id }, label), el);
}

function input(label, obj, key, attrs = {}) {
  const id = attrs.id || `in-${key}`;
  return h('div', { class: 'field' }, h('label', { for: id }, label),
    h('input', { id, type: 'text', value: obj[key] || '', oninput: (e) => { obj[key] = e.target.value; changed(); }, ...attrs }));
}

function markdownBlock(text, cls) {
  if (!text) return null;
  const html = text.split('\n').filter((l) => l.trim()).map((l) => `<p>${runsHtml(parseInline(l))}</p>`).join('');
  return h('div', { class: cls, html });
}

function relevantChanges() {
  const d = app.draft;
  return (app.index?.changes || []).filter((c) => !c.college
    || (c.college === d.college && (!c.department || c.department === d.department)));
}

function renderSetup() {
  const d = app.draft;
  const college = currentCollege();
  const course = d.course;

  const lookupStatus = h('p', { class: 'hint', id: 'lookup-status', 'aria-live': 'polite' });
  const codeInput = h('input', { id: 'in-code', type: 'text', value: course.code || '', placeholder: 'e.g. ENGR 102',
    'aria-describedby': 'lookup-status', autocomplete: 'off',
    oninput: (e) => { course.code = e.target.value; changed(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); doLookup(); } } });

  async function doLookup() {
    lookupStatus.textContent = 'Looking up…';
    const res = await lookupCourse(codeInput.value);
    let moved = false;
    if (res.code) {
      course.code = `${res.code.prefix} ${res.code.number}`;
      codeInput.value = course.code;
      moved = autoSelectDepartment(res.code.prefix);
    }
    if (res.error) {
      changed();
      if (moved) await reload();
      $('#lookup-status').textContent = res.error;
      return;
    }
    const c = res.course;
    for (const key of ['title', 'units', 'description', 'prerequisites', 'ge']) {
      if (c[key]) course[key] = c[key];
    }
    const idx = await catalogIndex();
    saveDraft(d);
    await reload();
    $('#lookup-status').textContent = `Filled in from the ${idx.name || 'university catalog'}. Please check the details.`;
  }

  const changes = relevantChanges();
  const prev = app.index?.previous;
  const notes = [
    markdownBlock(app.index?.notes, 'note'),
    college && markdownBlock(college.notes, 'note'),
    currentDepartment() && markdownBlock(currentDepartment().notes, 'note'),
    changes.length ? h('details', { class: 'note changes' },
      h('summary', {}, `${changes.length} policy ${changes.length === 1 ? 'change' : 'changes'} since ${prev}`),
      h('ul', {}, ...changes.map((c) => h('li', {}, `${c.title} (${c.change})`)))) : null,
  ].filter(Boolean);

  setupEl.replaceChildren(...[
    h('div', { class: 'card-head' }, h('h2', { id: 'setup-title' }, 'Start here'),
      h('span', { class: 'badge badge-fill' }, 'You complete')),
    h('div', { class: 'grid2' },
      select('Semester', app.semesters.map((s) => [s.id, s.label]), d.semester, async (v) => {
        d.semester = v;
        await loadSemester(v);
        if (!currentCollege()) { d.college = ''; d.department = ''; }
        if (!currentDepartment()) d.department = '';
        changed();
        reload();
      }),
      select('College', [['', 'Choose your college…'], ...app.index.colleges.map((c) => [c.id, c.name])], d.college, (v) => {
        d.college = v;
        d.department = '';
        changed();
        reload();
      }, { required: true }),
    ),
    college && college.departments.length
      ? select('Department or school', [['', 'Not listed / none'], ...college.departments.map((x) => [x.id, x.name])],
        d.department, (v) => { d.department = v; changed(); reload(); })
      : null,
    h('div', { class: 'lookup' },
      h('div', { class: 'field' }, h('label', { for: 'in-code' }, 'Course'), codeInput),
      h('button', { type: 'button', onclick: doLookup }, 'Look up in catalog')),
    lookupStatus,
    input('Course title', course, 'title'),
    h('div', { class: 'grid3' },
      input('Units', course, 'units', { inputmode: 'decimal' }),
      input('Section', course, 'section', { placeholder: 'e.g. 01' }),
      input('Class number', course, 'classNumber', { inputmode: 'numeric' })),
    ...notes,
  ].filter(Boolean));
}

/** Select the department (and college) that owns a course prefix. Returns true if it changed. */
function autoSelectDepartment(prefix) {
  const d = app.draft;
  for (const c of app.index.colleges) {
    for (const dep of c.departments) {
      if (dep.prefixes.includes(prefix) && (!d.college || d.college === c.id)) {
        if (d.college === c.id && d.department === dep.id) return false;
        d.college = c.id;
        d.department = dep.id;
        return true;
      }
    }
  }
  return false;
}

// ------------------------------------------------------------------ form + checklist

function renderForm() {
  if (!app.sections.length) {
    formEl.replaceChildren(h('p', { class: 'empty' }, 'Choose your college above to load the syllabus sections.'));
    return;
  }
  const ctx = { changed };
  formEl.replaceChildren(
    ...app.sections.map((s) => sectionCard(s, app.draft, ctx)),
    customSectionsCard(app.sections, app.draft, ctx),
  );
}

function checklist(doc) {
  const d = app.draft;
  const items = [];
  const need = (cond, text, target) => { if (!cond) items.push({ text, target }); };
  const filled = (v) => v && String(v).trim();
  need(d.college, 'Choose your college', 'setup');
  need(filled(d.course.code) && parseCourseCode(d.course.code), 'Enter the course prefix and number', 'setup');
  need(filled(d.course.title), 'Enter the course title', 'setup');
  if (!app.sections.length) return items;

  const byField = (f) => app.sections.find((s) => s.field === f && isIncluded(s, d));
  const target = (f) => byField(f)?.id;
  if (byField('info')) {
    need(filled(d.instructor.name), 'Add the instructor name', target('info'));
    need(filled(d.instructor.email), 'Add your CSULB email', target('info'));
    need(filled(d.instructor.officeHours), 'Add office hours (PS 14-15)', target('info'));
    need(filled(d.meetings.times) || /asynchronous/i.test(d.modality), 'Add class days and times', target('info'));
  }
  if (byField('catalog')) need(filled(d.course.description), 'Add the catalog description', target('catalog'));
  if (byField('modality')) need(d.modality, 'Select the course modality', target('modality'));
  if (byField('slos')) need(d.slos.some(filled), 'List the student learning outcomes', target('slos'));
  if (byField('assessments')) {
    const named = d.assessments.filter((a) => filled(a.name));
    need(named.length >= 3, 'List at least three assessments (PS 12-03)', target('assessments'));
    const total = sumWeights(d.assessments);
    need(total === null || !named.length || Math.abs(total - 100) < 0.01,
      `Assessment weights add up to ${total === null ? 'an invalid number' : `${total}%`}, not 100%`, target('assessments'));
    need(!d.assessments.some((a) => parseFloat(a.weight) > 33.34),
      'No single assessment may exceed 33 1/3% without the dean\'s approval', target('assessments'));
  }
  if (byField('schedule')) need(d.schedule.some((r) => filled(r.topic)), 'Add the course schedule', target('schedule'));
  for (const s of app.sections) {
    if (s.kind !== 'section' || !isIncluded(s, d)) continue;
    if (s.field === 'text' && !filled(d.sections[s.id]?.text)) need(false, `Complete "${s.title.split(':')[0]}"`, s.id);
    if (s.field === 'none' && s.lock !== 'required') {
      const text = sectionText(s, d);
      if (/\[(Add|Insert|Provide)[^\]]*\]|\bX%/.test(text)) need(false, `Fill in the placeholder in "${s.title.split(':')[0]}"`, s.id);
    }
  }
  for (const x of d.custom) {
    if (filled(x.title) && !filled(x.text)) need(false, `Add text to "${x.title}"`, 'custom');
  }
  if (!items.length && countPlaceholders(doc)) need(false, 'Fill in the highlighted placeholders', null);
  return items;
}

function renderChecklist(doc) {
  const items = checklist(doc);
  const el = $('#checklist');
  const count = $('#check-count');
  count.textContent = items.length ? `${items.length} to finish` : 'Ready';
  count.classList.toggle('ok', !items.length);
  el.replaceChildren(
    h('h2', {}, 'Checklist'),
    items.length
      ? h('ul', {}, ...items.map((it) => h('li', {}, it.target
        ? h('a', { href: `#form-${it.target}`, onclick: (e) => {
          e.preventDefault();
          showPane('edit');
          const t = document.getElementById(`form-${it.target}`);
          t?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          t?.querySelector('input, textarea, select, summary')?.focus({ preventScroll: true });
        } }, it.text)
        : it.text)))
      : h('p', { class: 'ok' }, 'Everything required is filled in. Download your syllabus when you are ready.'),
  );
}

function renderPreview() {
  if (!currentSemester()) return;
  const doc = currentDoc();
  previewEl.innerHTML = app.sections.length
    ? renderHtml(doc)
    : '<p class="empty">Your syllabus preview appears here once you choose a college.</p>';
  renderChecklist(doc);
}

// ------------------------------------------------------------------ actions

async function downloadWord() {
  if (!app.sections.length) return announce('Choose your college first.', 'error');
  const button = $('#btn-docx');
  button.disabled = true;
  try {
    await loadScript('vendor/docx/docx.iife.js');
    const doc = currentDoc();
    downloadBlob(await docxBlob(window.docx, doc), `${doc.fileName}.docx`);
    const left = checklist(doc).length;
    announce(left ? `Word file downloaded. ${left} checklist item(s) still need attention; placeholders are highlighted in yellow.`
      : 'Word file downloaded.');
  } catch (e) {
    console.error(e);
    announce('The Word file could not be created. Please try again.', 'error');
  } finally {
    button.disabled = false;
  }
}

function savePdf() {
  if (!app.sections.length) return announce('Choose your college first.', 'error');
  const dialog = $('#pdf-dialog');
  renderPreview();
  if (dialog.dataset.shown !== 'yes' && typeof dialog.showModal === 'function') {
    dialog.dataset.shown = 'yes';
    dialog.showModal();
    return;
  }
  printNow();
}

function printNow() {
  const doc = currentDoc();
  const original = document.title;
  document.title = doc.fileName;
  window.addEventListener('afterprint', () => { document.title = original; }, { once: true });
  window.print();
}

function showPane(which) {
  document.body.dataset.pane = which;
  for (const b of document.querySelectorAll('[data-show]')) {
    b.setAttribute('aria-pressed', String(b.dataset.show === which));
  }
}

function wireActions() {
  $('#btn-docx').addEventListener('click', downloadWord);
  $('#btn-pdf').addEventListener('click', savePdf);
  $('#pdf-continue').addEventListener('click', () => { $('#pdf-dialog').close(); setTimeout(printNow, 50); });
  $('#pdf-cancel').addEventListener('click', () => $('#pdf-dialog').close());
  $('#btn-save').addEventListener('click', () => {
    const doc = currentDoc();
    downloadBlob(draftFile(app.draft), `${doc.fileName}_draft.json`);
    announce('Draft saved. Open it here next semester to start from it.');
  });
  $('#file-open').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const draft = readDraftFile(await file.text());
      const latest = app.semesters[0].id;
      const fromOlder = draft.semester && draft.semester !== latest;
      draft.semester = app.semesters.some((s) => s.id === draft.semester) ? draft.semester : latest;
      app.draft = draft;
      await loadSemester(draft.semester);
      if (!currentCollege()) draft.college = '';
      if (!currentDepartment()) draft.department = '';
      saveDraft(draft);
      await reload();
      announce(fromOlder ? `Draft opened. It was made for an earlier semester; switch the semester to ${app.semesters[0].label} to use this semester's policy text.`
        : 'Draft opened.');
    } catch (err) {
      announce(err.message || 'That file could not be opened.', 'error');
    }
  });
  $('#btn-reset').addEventListener('click', async () => {
    if (!confirm('Start over? This clears everything you have entered on this computer. Save a draft file first if you want to keep it.')) return;
    const { semester, college, department } = app.draft;
    clearDraft();
    app.draft = { ...emptyDraft(), semester, college, department };
    await reload();
    announce('Started a new syllabus.');
  });
  for (const b of document.querySelectorAll('[data-show]')) {
    b.addEventListener('click', () => showPane(b.dataset.show));
  }
  $('#check-count').addEventListener('click', () => {
    $('#checklist').scrollIntoView({ behavior: 'smooth' });
  });
}

// ------------------------------------------------------------------ start

async function init() {
  wireActions();
  showPane('edit');
  try {
    app.semesters = (await fetchJson('data/semesters.json')).semesters;
  } catch (e) {
    setupEl.replaceChildren(h('p', { class: 'empty' }, 'The syllabus data could not be loaded. Please refresh the page.'));
    console.error(e);
    return;
  }
  app.draft = loadDraft() || emptyDraft();
  if (!app.semesters.some((s) => s.id === app.draft.semester)) app.draft.semester = app.semesters[0].id;
  await loadSemester(app.draft.semester);
  if (!currentCollege()) app.draft.college = '';
  if (!currentDepartment()) app.draft.department = '';
  await reload();
}

init();
