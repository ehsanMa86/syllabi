# Copyright (c) 2026 Ehsan Madadi. All rights reserved.
# See LICENSE in the project root.
"""Start a new semester by copying the most recent semester's content.

    python scripts/new_semester.py 2027-fall
    python scripts/new_semester.py 2028-spring --from 2027-spring

The copy becomes the starting point that the university and colleges edit.
The previous semester stays untouched so its syllabi can still be produced.
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import CONTENT, SEMESTER_RE, TERMS  # noqa: E402


def semester_key(name: str) -> tuple[int, int]:
    year, term = SEMESTER_RE.match(name).groups()
    return int(year), TERMS[term]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("semester", help="new semester folder name, e.g. 2027-fall")
    ap.add_argument("--from", dest="source", help="semester to copy (default: the most recent one)")
    args = ap.parse_args(argv)

    new = args.semester.strip().lower()
    if not SEMESTER_RE.match(new):
        print("Semester must look like 2027-fall, 2028-spring, 2028-summer or 2028-winter.")
        return 2
    target = CONTENT / new
    if target.exists():
        print(f"content/{new} already exists.")
        return 1

    existing = sorted((p.name for p in CONTENT.iterdir() if p.is_dir() and SEMESTER_RE.match(p.name)),
                      key=semester_key)
    if not existing:
        print("No existing semester to copy from.")
        return 1
    source = (args.source or existing[-1]).strip().lower()
    if source not in existing:
        print(f"content/{source} does not exist.")
        return 1

    shutil.copytree(CONTENT / source, target)
    year, term = SEMESTER_RE.match(new).groups()
    label = f"{term.capitalize()} {year}"
    sem_file = target / "_semester.md"
    text = sem_file.read_text(encoding="utf-8") if sem_file.exists() else "---\nlabel: x\n---\n"
    text = re.sub(r"(?m)^label:.*$", f"label: {label}", text, count=1)
    sem_file.write_text(text, encoding="utf-8")

    print(f"Created content/{new} ({label}) from content/{source}.")
    print("Next: the university and each college update their files in that folder.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
