// Copyright (c) 2026 Ehsan Madadi. All rights reserved.
// See LICENSE in the project root.
//
// Drafts are kept in the browser (autosave) and can be saved to / opened from a .json file
// so a syllabus can be reused next semester or on another computer.

import { emptyDraft } from './document.js';

const KEY = 'csulb-syllabus-builder:draft';
const FILE_TAG = 'csulb-syllabus-builder';

export function loadDraft() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveDraft(draft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* storage unavailable */ }
}

export function draftFile(draft) {
  const data = { app: FILE_TAG, savedAt: new Date().toISOString(), ...draft };
  return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
}

export function readDraftFile(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== FILE_TAG) throw new Error('This file is not a saved syllabus draft.');
  return normalizeDraft(data);
}

/** Fill in anything missing so drafts from older versions still load. */
export function normalizeDraft(data) {
  const base = emptyDraft();
  const d = { ...base, ...data };
  for (const key of ['course', 'instructor', 'meetings']) d[key] = { ...base[key], ...(data[key] || {}) };
  for (const key of ['methods', 'slos', 'assessments', 'grading', 'schedule', 'custom']) {
    if (!Array.isArray(d[key])) d[key] = base[key];
  }
  if (!d.slos.length) d.slos = [''];
  if (!d.sections || typeof d.sections !== 'object') d.sections = {};
  delete d.app;
  delete d.savedAt;
  return d;
}
