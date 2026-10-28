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

/** Link to the course in the online catalog's search, opened by the instructor. */
export function catalogSearchUrl(text, catalogId) {
  const code = parseCourseCode(text);
  const params = new URLSearchParams({
    cur_cat_oid: catalogId || '12',
    search_database: 'Search', search_db: 'Search',
    cpage: '1', ecpage: '1', ppage: '1', spage: '1', tpage: '1', location: '3',
    'filter[keyword]': code ? `${code.prefix} ${code.number}` : String(text || '').trim(),
    'filter[exact_match]': '1',
  });
  return `https://catalog.csulb.edu/search_advanced.php?${params}`;
}

// Page furniture that comes along when a course entry is copied from the catalog.
const NOISE = [
  /^add to (my )?(portfolio|favorites)\b/i, /^print[- ]friendly page/i, /^print\b.*opens a new window/i,
  /^back to top/i, /^facebook this page/i, /^tweet this page/i, /^share this page/i, /^help$/i,
  /^close window/i, /^\[.*\]$/, /^(\d{4}-\d{4}\s+)?(undergraduate and graduate )?catalog$/i,
  /^(previous|next|return to:)/i,
];

const HEADER = /^([A-Za-z]{2,5})\s*[-]?\s*(\d{1,3}[A-Za-z]{0,2})\s*[-–—:.]\s*(.+)$/;
const UNITS = [/\bunits?\s*:\s*(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)/i,
  /\((\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)\s*units?\)/i,
  /^(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)\s+units?\.?$/i];
const PREREQ = /^(prerequisites?(?:\s*\/\s*corequisites?)?|prerequisite\(s\)|corequisites?)\s*:\s*(.*)$/i;
const GE = /^(general education(?: category| designation)?|ge(?: category| designation)?)\s*:\s*(.*)$/i;

/**
 * Pull course details out of text copied from the online catalog.
 * Returns { code, course: { title, units, description, prerequisites, ge } } with only the
 * fields that were found.
 */
export function parseCatalogText(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !NOISE.some((re) => re.test(l)));
  const course = {};
  let code = null;
  const rest = [];
  const prereqs = [];

  for (const line of lines) {
    const header = !code && HEADER.exec(line);
    if (header && /[A-Za-z]/.test(header[3])) {
      code = { prefix: header[1].toUpperCase(), number: header[2].toUpperCase() };
      let title = header[3].trim();
      const unitsInTitle = /\s*\((\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)(?:\s*units?)?\)\s*$/i.exec(title);
      if (unitsInTitle) {
        course.units = unitsInTitle[1].replace(/\s+/g, '');
        title = title.slice(0, unitsInTitle.index).trim();
      }
      course.title = title;
      continue;
    }
    let m;
    if ((m = PREREQ.exec(line))) {
      // "Prerequisite: ENGR 101. Description starts here..." on one line.
      const split = /\.\s+(?=[A-Z])/.exec(m[2]);
      const req = split ? m[2].slice(0, split.index) : m[2];
      if (req) prereqs.push(req.replace(/\.$/, ''));
      if (split) rest.push(m[2].slice(split.index + split[0].length));
      continue;
    }
    if ((m = GE.exec(line))) {
      if (m[2]) course.ge = m[2];
      continue;
    }
    if (!course.units) {
      const u = UNITS.map((re) => re.exec(line)).find(Boolean);
      if (u) {
        course.units = u[1].replace(/\s+/g, '');
        if (UNITS[0].test(line) && line.replace(UNITS[0], '').trim().length < 3) continue;
        if (UNITS[2].test(line)) continue;
      }
    }
    rest.push(line);
  }
  if (prereqs.length) course.prerequisites = prereqs.join('; ');
  if (rest.length) course.description = rest.join(' ').trim();
  return { code, course };
}
