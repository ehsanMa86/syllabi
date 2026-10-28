// Copyright (c) 2026 Ehsan Madadi
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Course lookup against the catalog snapshot published with the site
// (data/catalog/index.json plus one file per course prefix, built from catalog/courses.csv).

import { fetchJson } from './util.js';
import { parseCourseCode } from './document.js';

let index = null;
const byPrefix = {};

export async function catalogIndex() {
  if (!index) {
    try {
      index = await fetchJson('data/catalog/index.json');
    } catch {
      index = { prefixes: [], count: 0 };
    }
  }
  return index;
}

/**
 * Returns { course, code } when found, otherwise { error } with a message for the user.
 */
export async function lookupCourse(text) {
  const code = parseCourseCode(text);
  if (!code) return { error: 'Enter the course as a prefix and number, for example ENGR 102.' };
  const idx = await catalogIndex();
  if (!idx.count) {
    return { code, error: 'The course catalog has not been loaded into this site yet. Please type the course details.' };
  }
  if (!idx.prefixes.includes(code.prefix)) {
    return { code, error: `No ${code.prefix} courses were found in the catalog. Please type the course details.` };
  }
  try {
    byPrefix[code.prefix] ||= await fetchJson(`data/catalog/${encodeURIComponent(code.prefix)}.json`);
  } catch {
    return { code, error: 'The catalog could not be loaded. Please type the course details.' };
  }
  const course = byPrefix[code.prefix][code.number];
  if (!course) return { code, error: `${code.prefix} ${code.number} is not in the catalog. Please check the number or type the details.` };
  return { code, course };
}
