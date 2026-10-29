# Copyright (c) 2026 Ehsan Madadi
# SPDX-License-Identifier: GPL-3.0-or-later
"""Validate the syllabus content and build the static site.

    python scripts/build.py            # validate and build into dist/
    python scripts/build.py --check    # validate only (used on pull requests)

Content lives in content/<year>-<term>/ (e.g. content/2027-spring/):

    _semester.md                         semester label and notes for faculty
    common/<section>.md                  common layer: sections every syllabus has (each has an order)
    colleges/<college>/_college.md       college name
    colleges/<college>/<section>.md      college additions and overrides
    colleges/<college>/departments/<dept>/_department.md
    colleges/<college>/departments/<dept>/<section>.md

See content/README.md for the section file format.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
SITE = ROOT / "site"
CATALOG = ROOT / "catalog"
DIST = ROOT / "dist"

TERMS = {"winter": 0, "spring": 1, "summer": 2, "fall": 3}
SEMESTER_RE = re.compile(r"^(\d{4})-(winter|spring|summer|fall)$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

KINDS = {"section", "heading"}
LOCKS = {"required", "personalize", "optional"}
FIELDS = {"none", "info", "catalog", "slos", "text", "modality", "methods",
          "assessments", "grading-scale", "schedule"}
ACTIONS = {"replace", "append", "remove"}
SECTION_KEYS = {"title", "order", "kind", "lock", "start", "field", "prompt",
                "options", "protected", "hide_title", "source",
                "action", "before", "after"}
COLLEGE_KEYS = {"name", "short"}
DEPARTMENT_KEYS = {"name", "short", "prefixes"}
SEMESTER_KEYS = {"label"}
CATALOG_COLUMNS = ["prefix", "number", "title", "units", "description",
                   "prerequisites", "ge", "url"]


class ContentError(Exception):
    pass


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def error(self, where: Path | str, msg: str) -> None:
        self.errors.append(f"{rel(where)}: {msg}")

    def warn(self, where: Path | str, msg: str) -> None:
        self.warnings.append(f"{rel(where)}: {msg}")


def rel(p: Path | str) -> str:
    try:
        return Path(p).resolve().relative_to(ROOT).as_posix()
    except (ValueError, OSError):
        return str(p)


# ---------------------------------------------------------------- parsing

def parse_file(path: Path) -> tuple[dict[str, str], str]:
    """Split a Markdown file into front matter (simple key: value pairs) and body."""
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").lstrip("﻿")
    if not text.startswith("---\n"):
        return {}, text.strip()
    end = text.find("\n---", 4)
    if end == -1:
        raise ContentError("front matter starts with --- but never closes")
    meta: dict[str, str] = {}
    for n, line in enumerate(text[4:end].split("\n"), start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise ContentError(f"line {n}: expected 'key: value', got {line!r}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        meta[key.strip()] = value
    body = text[end + 4:]
    body = body[body.find("\n") + 1:] if "\n" in body else ""
    return meta, body.strip()


def is_yes(value: str | None) -> bool:
    return (value or "").strip().lower() in {"yes", "true", "on", "1"}


LINK_RE = re.compile(r"\[([^\]]*)\]\(([^)\s]*)\)")


def check_links(path: Path, body: str, report: Report) -> None:
    for _, url in LINK_RE.findall(body):
        if not url:
            report.error(path, "link with an empty URL")
        elif not re.match(r"^(https?://|mailto:)", url):
            report.error(path, f"link URL must start with https://, http:// or mailto: ({url})")
        elif "safelinks.protection.outlook.com" in url:
            report.warn(path, "link is an Outlook safelink; paste the original URL instead")
        elif url.startswith("http://"):
            report.warn(path, f"link uses http:// rather than https:// ({url})")


# ---------------------------------------------------------------- sections

@dataclass
class Section:
    id: str
    meta: dict[str, str]
    body: str
    path: Path
    layers: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        m = self.meta
        kind = m.get("kind", "section")
        out: dict = {"id": self.id, "kind": kind, "title": m.get("title", "")}
        if kind == "section":
            out.update({
                "lock": m.get("lock", "required"),
                "field": m.get("field", "none"),
                "start": m.get("start", "on"),
                "prompt": m.get("prompt", ""),
                "options": [o.strip() for o in m.get("options", "").split(";") if o.strip()],
                "hideTitle": is_yes(m.get("hide_title")),
                "protected": is_yes(m.get("protected")),
                "body": self.body,
                "layers": self.layers,
            })
        return out


def validate_section_meta(path: Path, meta: dict[str, str], body: str, report: Report,
                          common: bool) -> None:
    for key in meta:
        if key not in SECTION_KEYS:
            report.error(path, f"unknown key '{key}' (allowed: {', '.join(sorted(SECTION_KEYS))})")
    if meta.get("kind", "section") not in KINDS:
        report.error(path, f"kind must be one of {sorted(KINDS)}")
    if "lock" in meta and meta["lock"] not in LOCKS:
        report.error(path, f"lock must be one of {sorted(LOCKS)}")
    if "field" in meta and meta["field"] not in FIELDS:
        report.error(path, f"field must be one of {sorted(FIELDS)}")
    if "start" in meta:
        if meta["start"] not in {"on", "off"}:
            report.error(path, "start must be 'on' or 'off'")
        elif meta.get("lock") != "optional":
            report.warn(path, "start only has an effect on sections with lock: optional")
    if "action" in meta and meta["action"] not in ACTIONS:
        report.error(path, f"action must be one of {sorted(ACTIONS)}")
    if common:
        for key in ("action", "before", "after"):
            if key in meta:
                report.error(path, f"'{key}' is only used in college and department files")
        if "order" not in meta:
            report.error(path, "common sections need an 'order' number")
        elif not re.fullmatch(r"\d+", meta["order"]):
            report.error(path, "order must be a whole number")
        if not meta.get("title"):
            report.error(path, "missing title")
    else:
        if "order" in meta:
            report.error(path, "'order' is only used in the common layer; use before: or after:")
        if "protected" in meta:
            report.error(path, "'protected' can only be set in the common layer")
        if "before" in meta and "after" in meta:
            report.error(path, "use either before: or after:, not both")
    check_links(path, body, report)


def load_sections(folder: Path, report: Report, common: bool) -> list[Section]:
    sections = []
    for path in sorted(folder.glob("*.md")):
        if path.name.startswith("_"):
            continue
        sid = path.stem
        if not ID_RE.match(sid):
            report.error(path, "file names must use lowercase letters, digits and hyphens")
            continue
        try:
            meta, body = parse_file(path)
        except ContentError as e:
            report.error(path, str(e))
            continue
        validate_section_meta(path, meta, body, report, common)
        sections.append(Section(sid, meta, body, path))
    return sections


def merge(base: list[Section], overlay: list[Section], layer: str, report: Report) -> list[Section]:
    """Apply a college or department layer on top of an ordered section list."""
    result = [Section(s.id, dict(s.meta), s.body, s.path, list(s.layers)) for s in base]
    index = {s.id: s for s in result}
    pending: list[Section] = []

    for ov in overlay:
        meta = {k: v for k, v in ov.meta.items() if k not in {"action", "before", "after"}}
        if meta.get("field") == "none":
            meta["field"] = "none"
        target = index.get(ov.id)
        if target is None:
            if "action" in ov.meta:
                report.error(ov.path, f"action: {ov.meta['action']} but there is no section "
                                      f"'{ov.id}' to change (check the file name)")
                continue
            if "before" not in ov.meta and "after" not in ov.meta:
                report.error(ov.path, "new sections need 'before:' or 'after:' to place them")
                continue
            if not meta.get("title"):
                report.error(ov.path, "missing title")
            pending.append(ov)
            continue

        action = ov.meta.get("action")
        if action is None:
            report.error(ov.path, f"a section named '{ov.id}' already exists; set "
                                  "action: replace, append or remove")
            continue
        if target.meta.get("kind") == "heading" and action != "replace":
            report.error(ov.path, "headings can only be replaced (to retitle them)")
            continue
        if is_yes(target.meta.get("protected")) and action in {"replace", "remove"}:
            report.error(ov.path, f"'{ov.id}' is protected by the common layer; "
                                  "it can only be appended to")
            continue
        if action == "remove":
            result.remove(target)
            del index[ov.id]
            continue
        target.meta.update(meta)
        if action == "replace":
            target.body = ov.body
        elif ov.body:
            target.body = f"{target.body}\n\n{ov.body}" if target.body else ov.body
        target.layers.append(layer)

    # Insert new sections; a new section may be placed relative to another new one.
    while pending:
        progressed = False
        for ov in list(pending):
            anchor = ov.meta.get("before") or ov.meta.get("after")
            if anchor not in index:
                continue
            pos = result.index(index[anchor])
            if "after" in ov.meta:
                pos += 1
            meta = {k: v for k, v in ov.meta.items() if k not in {"before", "after"}}
            sec = Section(ov.id, meta, ov.body, ov.path, [layer])
            result.insert(pos, sec)
            index[ov.id] = sec
            pending.remove(ov)
            progressed = True
        if not progressed:
            for ov in pending:
                anchor = ov.meta.get("before") or ov.meta.get("after")
                report.error(ov.path, f"cannot place section: no section named '{anchor}'")
            break
    return result


# ---------------------------------------------------------------- semesters

@dataclass
class Department:
    id: str
    meta: dict[str, str]
    notes: str
    sections: list[Section]


@dataclass
class College:
    id: str
    meta: dict[str, str]
    notes: str
    sections: list[Section]
    departments: list[Department]


@dataclass
class Semester:
    id: str
    label: str
    notes: str
    path: Path
    common: list[Section]
    colleges: list[College]

    @property
    def sort_key(self) -> tuple[int, int]:
        year, term = SEMESTER_RE.match(self.id).groups()
        return int(year), TERMS[term]


def load_named(path: Path, allowed: set[str], report: Report) -> tuple[dict[str, str], str]:
    if not path.exists():
        report.error(path.parent, f"missing {path.name}")
        return {}, ""
    try:
        meta, body = parse_file(path)
    except ContentError as e:
        report.error(path, str(e))
        return {}, ""
    for key in meta:
        if key not in allowed:
            report.error(path, f"unknown key '{key}' (allowed: {', '.join(sorted(allowed))})")
    check_links(path, body, report)
    return meta, body


def load_semester(folder: Path, report: Report) -> Semester:
    meta, notes = load_named(folder / "_semester.md", SEMESTER_KEYS, report)
    year, term = SEMESTER_RE.match(folder.name).groups()
    label = meta.get("label") or f"{term.capitalize()} {year}"

    common_dir = folder / "common"
    common = load_sections(common_dir, report, common=True) if common_dir.is_dir() else []
    if not common:
        report.error(folder, "no common sections found")
    common.sort(key=lambda s: int(s.meta.get("order", "0") or 0))
    seen_orders: dict[str, str] = {}
    for s in common:
        o = s.meta.get("order")
        if o in seen_orders:
            report.error(s.path, f"order {o} is also used by '{seen_orders[o]}'")
        seen_orders[o] = s.id
        s.layers = ["Common"]

    colleges = []
    col_root = folder / "colleges"
    for cdir in sorted(p for p in col_root.glob("*") if p.is_dir()) if col_root.is_dir() else []:
        if not ID_RE.match(cdir.name):
            report.error(cdir, "folder names must use lowercase letters, digits and hyphens")
            continue
        cmeta, cnotes = load_named(cdir / "_college.md", COLLEGE_KEYS, report)
        if not cmeta.get("name"):
            report.error(cdir / "_college.md", "missing name")
        departments = []
        for ddir in sorted(p for p in (cdir / "departments").glob("*") if p.is_dir()):
            if not ID_RE.match(ddir.name):
                report.error(ddir, "folder names must use lowercase letters, digits and hyphens")
                continue
            dmeta, dnotes = load_named(ddir / "_department.md", DEPARTMENT_KEYS, report)
            if not dmeta.get("name"):
                report.error(ddir / "_department.md", "missing name")
            departments.append(Department(ddir.name, dmeta, dnotes,
                                          load_sections(ddir, report, common=False)))
        colleges.append(College(cdir.name, cmeta, cnotes,
                                load_sections(cdir, report, common=False), departments))
    if not colleges:
        report.error(folder, "no colleges found")
    return Semester(folder.name, label, notes, folder, common, colleges)


def load_all(report: Report) -> list[Semester]:
    semesters = []
    for folder in sorted(p for p in CONTENT.glob("*") if p.is_dir()):
        if not SEMESTER_RE.match(folder.name):
            report.error(folder, "semester folders are named like 2027-spring or 2027-fall")
            continue
        semesters.append(load_semester(folder, report))
    if not semesters:
        report.error(CONTENT, "no semester folders found")
    semesters.sort(key=lambda s: s.sort_key)
    return semesters


def combinations(sem: Semester, report: Report):
    """Yield (key, college, department, merged sections) for every selectable option."""
    for col in sem.colleges:
        short = col.meta.get("short") or col.id.upper()
        merged = merge(sem.common, col.sections, short, report)
        yield col.id, col, None, merged
        for dep in col.departments:
            dshort = dep.meta.get("short") or dep.id.upper()
            yield f"{col.id}.{dep.id}", col, dep, merge(merged, dep.sections, dshort, report)


# ---------------------------------------------------------------- changes

def layer_files(sem: Semester) -> dict[tuple[str, str, str], tuple[str, str]]:
    """Map (college, department, section id) -> (title, comparable text)."""
    out = {}

    def add(col: str, dep: str, sections: list[Section]):
        for s in sections:
            text = json.dumps(s.meta, sort_keys=True) + "\n" + s.body
            out[(col, dep, s.id)] = (s.meta.get("title", ""), text)

    add("", "", sem.common)
    for c in sem.colleges:
        add(c.id, "", c.sections)
        for d in c.departments:
            add(c.id, d.id, d.sections)
    return out


def changes_between(prev: Semester, cur: Semester) -> list[dict]:
    a, b = layer_files(prev), layer_files(cur)
    titles = {s.id: s.meta.get("title", s.id) for s in cur.common + prev.common}
    changes = []
    for key in sorted(set(a) | set(b)):
        if key in a and key in b and a[key][1] == b[key][1]:
            continue
        kind = "added" if key not in a else "removed" if key not in b else "updated"
        title = (b.get(key) or a.get(key))[0] or titles.get(key[2], key[2])
        if key[2].startswith("group-"):
            continue
        changes.append({"college": key[0], "department": key[1], "section": key[2],
                        "title": title, "change": kind})
    return changes


# ---------------------------------------------------------------- catalog

def load_catalog(report: Report) -> tuple[dict, dict[str, dict]]:
    meta_path = CATALOG / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    by_prefix: dict[str, dict] = {}
    csv_path = CATALOG / "courses.csv"
    if not csv_path.exists():
        return meta, by_prefix
    with csv_path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        missing = [c for c in ("prefix", "number", "title") if c not in (reader.fieldnames or [])]
        if missing:
            report.error(csv_path, f"missing columns: {', '.join(missing)}")
            return meta, by_prefix
        for n, row in enumerate(reader, start=2):
            prefix = (row.get("prefix") or "").strip().upper()
            number = (row.get("number") or "").strip().upper()
            if not prefix or not number:
                report.warn(csv_path, f"row {n}: missing prefix or number, skipped")
                continue
            entry = {c: (row.get(c) or "").strip() for c in CATALOG_COLUMNS[2:]}
            by_prefix.setdefault(prefix, {})[number] = {k: v for k, v in entry.items() if v}
    return meta, by_prefix


# ---------------------------------------------------------------- output

def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build(out: Path, check_only: bool) -> int:
    report = Report()
    semesters = load_all(report)
    built: dict[str, dict[str, list[dict]]] = {}
    for sem in semesters:
        built[sem.id] = {key: [s.to_json() for s in merged]
                         for key, _, _, merged in combinations(sem, report)}
    catalog_meta, catalog = load_catalog(report)

    for w in report.warnings:
        print(f"warning: {w}")
    for e in report.errors:
        print(f"error: {e}")
    if report.errors:
        print(f"\n{len(report.errors)} error(s); nothing was built.")
        return 1
    total = sum(len(v) for v in built.values())
    print(f"Content OK: {len(semesters)} semester(s), {total} college/department combinations, "
          f"{sum(len(v) for v in catalog.values())} catalog course(s).")
    if check_only:
        return 0

    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(SITE, out)
    (out / ".nojekyll").write_text("", encoding="utf-8")
    data = out / "data"

    index = []
    for i, sem in enumerate(semesters):
        prev = semesters[i - 1] if i > 0 else None
        colleges = []
        for c in sem.colleges:
            colleges.append({
                "id": c.id, "name": c.meta.get("name", c.id), "short": c.meta.get("short", ""),
                "notes": c.notes,
                "departments": [{
                    "id": d.id, "name": d.meta.get("name", d.id), "short": d.meta.get("short", ""),
                    "notes": d.notes,
                    "prefixes": [p.strip().upper() for p in d.meta.get("prefixes", "").split(",")
                                 if p.strip()],
                } for d in c.departments],
            })
        colleges.sort(key=lambda c: c["name"])
        write_json(data / sem.id / "index.json", {
            "id": sem.id, "label": sem.label, "notes": sem.notes, "colleges": colleges,
            "previous": prev.label if prev else None,
            "changes": changes_between(prev, sem) if prev else [],
        })
        for key, sections in built[sem.id].items():
            write_json(data / sem.id / f"{key}.json", {"sections": sections})
        index.append({"id": sem.id, "label": sem.label})
    index.reverse()  # newest first
    write_json(data / "semesters.json", {"semesters": index})

    write_json(data / "catalog" / "index.json", {
        **catalog_meta,
        "prefixes": sorted(catalog),
        "count": sum(len(v) for v in catalog.values()),
    })
    for prefix, courses in catalog.items():
        write_json(data / "catalog" / f"{prefix}.json", courses)

    print(f"Built site in {rel(out)}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="validate content without building")
    ap.add_argument("--out", type=Path, default=DIST, help="output folder (default: dist)")
    args = ap.parse_args(argv)
    return build(args.out, args.check)


if __name__ == "__main__":
    sys.exit(main())
