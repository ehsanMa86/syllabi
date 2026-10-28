// Copyright (c) 2026 Ehsan Madadi
// SPDX-License-Identifier: GPL-3.0-or-later
//
// A small Markdown subset shared by policy content and instructor text:
//   paragraphs (one per line), "- " bullets, "1. " numbered items, "### " subheadings,
//   **bold**, *italic*, [link text](https://...), and bare https:// links.
// Output is a list of blocks consumed by the HTML and Word renderers:
//   { t: 'p', runs } | { t: 'ul' | 'ol', items: [runs] } | { t: 'h', level, runs }
// A run is { text, b?, i?, href?, ph? }.

const LINK = /^\[([^\]]*)\]\(([^)\s]+)\)/;
const BARE_URL = /^(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/;

export function parseInline(src, style = {}) {
  const runs = [];
  let buf = '';
  const flush = () => {
    if (buf) runs.push({ text: buf, ...style });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && /[\\*[\]()_]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '[') {
      const m = LINK.exec(src.slice(i));
      if (m) {
        flush();
        runs.push(...parseInline(m[1] || m[2], { ...style, href: m[2] }));
        i += m[0].length;
        continue;
      }
    }
    if (c === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        runs.push(...parseInline(src.slice(i + 2, end), { ...style, b: true }));
        i = end + 2;
        continue;
      }
    }
    if (c === '*' && src[i + 1] && src[i + 1] !== ' ' && src[i + 1] !== '*') {
      const end = src.indexOf('*', i + 1);
      if (end > i + 1 && src[end - 1] !== ' ') {
        flush();
        runs.push(...parseInline(src.slice(i + 1, end), { ...style, i: true }));
        i = end + 1;
        continue;
      }
    }
    if (!style.href && (c === 'h' || c === 'H') && (i === 0 || /[\s(]/.test(src[i - 1]))) {
      const m = BARE_URL.exec(src.slice(i));
      if (m) {
        flush();
        runs.push({ text: m[1], ...style, href: m[1] });
        i += m[1].length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return mergeRuns(runs);
}

function sameStyle(a, b) {
  return !!a.b === !!b.b && !!a.i === !!b.i && a.href === b.href && !!a.ph === !!b.ph;
}

function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export function parseMarkdown(src) {
  const blocks = [];
  let list = null;
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      list = null;
      continue;
    }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line.trim()))) {
      list = null;
      blocks.push({ t: 'h', level: Math.max(3, Math.min(4, m[1].length)), runs: parseInline(m[2]) });
    } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
      if (!list || list.t !== 'ul') blocks.push((list = { t: 'ul', items: [] }));
      list.items.push(parseInline(m[1]));
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      if (!list || list.t !== 'ol') blocks.push((list = { t: 'ol', items: [] }));
      list.items.push(parseInline(m[1]));
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // Indented continuation of the previous list item.
      const item = list.items[list.items.length - 1];
      item.push({ text: ' ' }, ...parseInline(line.trim()));
      list.items[list.items.length - 1] = mergeRuns(item);
    } else {
      list = null;
      blocks.push({ t: 'p', runs: parseInline(line.trim()) });
    }
  }
  return blocks;
}

export function runsToText(runs) {
  return runs.map((r) => r.text).join('');
}
