// Copyright (c) 2026 Ehsan Madadi
// SPDX-License-Identifier: GPL-3.0-or-later
//
// Renders the document model as semantic HTML for the live preview and for printing to PDF.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const SAFE_URL = /^(https?:|mailto:)/i;

export function runsHtml(runs) {
  return runs.map((r) => {
    let h = escapeHtml(r.text);
    if (r.b) h = `<strong>${h}</strong>`;
    if (r.i) h = `<em>${h}</em>`;
    if (r.ph) h = `<mark class="ph">${h}</mark>`;
    if (r.href && SAFE_URL.test(r.href)) h = `<a href="${escapeHtml(r.href)}">${h}</a>`;
    return h;
  }).join('');
}

function blockHtml(b) {
  switch (b.t) {
    case 'h': {
      // Section headings sit under the document title (h1): groups are h2, sections h3.
      const level = Math.min(6, b.level + 1);
      return `<h${level}>${runsHtml(b.runs)}</h${level}>`;
    }
    case 'p':
      return `<p>${runsHtml(b.runs)}</p>`;
    case 'ul':
    case 'ol':
      return `<${b.t}>${b.items.map((it) => `<li>${runsHtml(it)}</li>`).join('')}</${b.t}>`;
    case 'table': {
      const cols = b.widths ? `<colgroup>${b.widths.map((w) => `<col style="width:${w}%">`).join('')}</colgroup>` : '';
      const caption = b.caption ? `<caption class="sr-only">${escapeHtml(b.caption)}</caption>` : '';
      const head = b.rowHeaders ? '' :
        `<thead><tr>${b.head.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
      const rows = b.rows.map((row) => `<tr>${row.map((cell, i) => (b.rowHeaders && i === 0
        ? `<th scope="row">${runsHtml(cell)}</th>`
        : `<td>${runsHtml(cell)}</td>`)).join('')}</tr>`).join('');
      return `<table class="${b.rowHeaders ? 'kv' : 'grid'}">${caption}${cols}${head}<tbody>${rows}</tbody></table>`;
    }
    default:
      return '';
  }
}

export function renderHtml(doc) {
  const sub = doc.subtitle.map((s) => `<p class="doc-sub">${escapeHtml(s)}</p>`).join('');
  return `<header class="doc-head"><h1 class="doc-title">${escapeHtml(doc.title)}</h1>${sub}</header>`
    + doc.blocks.map(blockHtml).join('\n');
}
