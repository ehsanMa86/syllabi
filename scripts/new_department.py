# Copyright (c) 2026 Ehsan Madadi
# SPDX-License-Identifier: GPL-3.0-or-later
"""Add a department or school under a college.

    python scripts/new_department.py coe mae --name "Mechanical and Aerospace Engineering" --short MAE --prefixes "MAE"
    python scripts/new_department.py chhs nursing --name "School of Nursing" --prefixes "NRSG" --semester 2027-fall

Creates content/<semester>/colleges/<college>/departments/<id>/_department.md in the most recent
semester (or the one given). The department then appears in the Department menu for that college;
section files added to its folder apply on top of the college's sections.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import CONTENT, ID_RE, SEMESTER_RE, TERMS  # noqa: E402


def latest_semester() -> str | None:
    names = [p.name for p in CONTENT.iterdir() if p.is_dir() and SEMESTER_RE.match(p.name)]
    if not names:
        return None

    def key(name: str) -> tuple[int, int]:
        year, term = SEMESTER_RE.match(name).groups()
        return int(year), TERMS[term]
    return max(names, key=key)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("college", help="college folder name, e.g. coe")
    ap.add_argument("department", help="new folder name: lowercase letters, digits and hyphens, e.g. mae")
    ap.add_argument("--name", required=True, help="full name shown to faculty")
    ap.add_argument("--short", default="", help="abbreviation shown in the form, e.g. MAE")
    ap.add_argument("--prefixes", default="", help="course prefixes, comma separated, e.g. 'MAE, ME'")
    ap.add_argument("--note", default="", help="optional note shown to faculty who choose this department")
    ap.add_argument("--semester", help="semester folder (default: the most recent one)")
    args = ap.parse_args(argv)

    semester = (args.semester or latest_semester() or "").strip().lower()
    college_dir = CONTENT / semester / "colleges" / args.college.strip().lower()
    if not semester or not (CONTENT / semester).is_dir():
        print(f"Semester folder content/{semester} does not exist.")
        return 1
    if not (college_dir / "_college.md").exists():
        print(f"There is no college '{args.college}' in content/{semester}/colleges/.")
        return 1
    dep = args.department.strip().lower()
    if not ID_RE.match(dep):
        print("The department folder name must use lowercase letters, digits and hyphens (e.g. mae).")
        return 2
    target = college_dir / "departments" / dep
    if target.exists():
        print(f"{target.relative_to(CONTENT.parent).as_posix()} already exists.")
        return 1

    prefixes = ", ".join(p.strip().upper() for p in args.prefixes.split(",") if p.strip())
    lines = ["---", f"name: {args.name.strip()}"]
    if args.short.strip():
        lines.append(f"short: {args.short.strip()}")
    if prefixes:
        lines.append(f"prefixes: {prefixes}")
    lines.append("---")
    if args.note.strip():
        lines.append(args.note.strip())
    target.mkdir(parents=True)
    (target / "_department.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Created {target.relative_to(CONTENT.parent).as_posix()}/_department.md")
    print("Add section files to that folder to include department text (see content/README.md).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
