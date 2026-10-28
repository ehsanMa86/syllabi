# Copyright (c) 2026 Ehsan Madadi
# SPDX-License-Identifier: GPL-3.0-or-later
"""Refresh catalog/courses.csv from the CSULB catalog through the Acalog API.

The CSULB catalog (catalog.csulb.edu) runs on Acalog. Its public web pages are protected
against automated access, so this script uses the official Acalog API, which needs an API
key issued by the campus catalog office.

    ACALOG_API_KEY=... python scripts/catalog_acalog.py --catalog-id 12
    python scripts/catalog_acalog.py --list-catalogs           # find the catalog id
    python scripts/catalog_acalog.py --catalog-id 12 --dump-raw raw/   # keep raw XML for inspection

The API returns course fields with campus-specific names. Run once with --dump-raw and
check the CSV; adjust FIELD_HINTS below if a column comes out empty.

If an API key is not available, catalog/courses.csv can be filled from any export the
catalog office provides (see catalog/README.md).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_CSV = ROOT / "catalog" / "courses.csv"
OUT_META = ROOT / "catalog" / "meta.json"
COLUMNS = ["prefix", "number", "title", "units", "description", "prerequisites", "ge", "url"]
DEFAULT_BASE = "https://csulb.apis.acalog.com/v1"

# Lower-case substrings of Acalog field names mapped to CSV columns.
FIELD_HINTS = {
    "units": ("units", "credits"),
    "description": ("description", "course description"),
    "prerequisites": ("prerequisite",),
    "ge": ("general education", "ge category", "ge designation"),
}


def api_get(base: str, path: str, params: list[tuple[str, str]], retries: int = 3) -> bytes:
    url = f"{base}/{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "csulb-syllabus-builder catalog import"})
            with urllib.request.urlopen(req, timeout=60) as res:
                body = res.read()
            break
        except Exception as e:  # network errors and HTTP errors
            if attempt == retries - 1:
                raise RuntimeError(f"Acalog API request failed: {e}") from e
            time.sleep(2 * (attempt + 1))
    # Errors come back as <catalog><message>...</message><status>failure</status></catalog>.
    root = ET.fromstring(body)
    status = next((el.text for el in root.iter() if local(el.tag) == "status"), None)
    if status and status.strip().lower() == "failure":
        message = next((el.text for el in root.iter() if local(el.tag) == "message"), "unknown error")
        raise SystemExit(f"Acalog API error: {message.strip()}")
    return body


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def text_of(el: ET.Element) -> str:
    raw = "".join(el.itertext())
    raw = unescape(re.sub(r"<[^>]+>", " ", raw))
    return re.sub(r"\s+", " ", raw).strip()


def list_catalogs(base: str, key: str) -> None:
    xml = api_get(base, "content", [("key", key), ("format", "xml"), ("method", "getCatalogs")])
    root = ET.fromstring(xml)
    for el in root.iter():
        if local(el.tag) == "catalog":
            title = next((text_of(c) for c in el if local(c.tag) in {"title", "name"}), "")
            print(el.get("id", "?"), title)


def course_ids(base: str, key: str, catalog: str) -> list[str]:
    xml = api_get(base, "search/courses", [("key", key), ("format", "xml"), ("method", "listing"),
                                           ("catalog", catalog), ("options[limit]", "0")])
    root = ET.fromstring(xml)
    ids = []
    for el in root.iter():
        if local(el.tag) == "id" and el.text and el.text.strip().isdigit():
            ids.append(el.text.strip())
    return list(dict.fromkeys(ids))


def parse_course(el: ET.Element, catalog: str) -> dict[str, str] | None:
    row = dict.fromkeys(COLUMNS, "")
    fields: list[tuple[str, str]] = []
    for child in el.iter():
        tag = local(child.tag)
        if tag == "prefix" and not row["prefix"]:
            row["prefix"] = text_of(child)
        elif tag == "code" and not row["number"]:
            row["number"] = text_of(child)
        elif tag == "name" and not row["title"] and child is not el:
            row["title"] = text_of(child)
        elif tag == "field":
            name = (child.get("name") or child.get("type") or "").lower()
            label = next((text_of(c) for c in child if local(c.tag) in {"name", "label"}), "")
            data = next((text_of(c) for c in child if local(c.tag) == "data"), "") or text_of(child)
            fields.append(((label or name).lower(), data))

    title_el = next((c for c in el if local(c.tag) == "title"), None)
    if title_el is not None and (not row["prefix"] or not row["title"]):
        m = re.match(r"^\s*([A-Z]{2,5})\s+(\d{1,3}[A-Z]{0,2})\s*[-–—:]\s*(.+)$", text_of(title_el))
        if m:
            row["prefix"] = row["prefix"] or m.group(1)
            row["number"] = row["number"] or m.group(2)
            row["title"] = row["title"] or m.group(3)

    for column, hints in FIELD_HINTS.items():
        for label, data in fields:
            if data and any(h in label for h in hints):
                row[column] = data
                break

    everything = " ".join(d for _, d in fields)
    if not row["description"] and fields:
        row["description"] = max((d for _, d in fields), key=len)
    if not row["units"]:
        m = re.search(r"\b(\d+(?:\.\d+)?(?:\s*-\s*\d+)?)\s+units?\b", everything, re.I)
        row["units"] = m.group(1) if m else ""
    if not row["prerequisites"]:
        m = re.search(r"Prerequisites?(?:/Corequisites?)?:\s*(.+?)(?:\.\s|$)", everything)
        row["prerequisites"] = m.group(1).strip() if m else ""

    cid = (el.get("id") or "").rsplit("-", 1)[-1]
    if cid.isdigit():
        row["url"] = f"https://catalog.csulb.edu/preview_course_nopop.php?catoid={catalog}&coid={cid}"
    row["prefix"] = row["prefix"].upper()
    row["number"] = row["number"].upper()
    return row if row["prefix"] and row["number"] else None


def fetch_courses(base: str, key: str, catalog: str, dump: Path | None) -> list[dict[str, str]]:
    ids = course_ids(base, key, catalog)
    print(f"{len(ids)} course ids in catalog {catalog}")
    rows = []
    for start in range(0, len(ids), 100):
        batch = ids[start:start + 100]
        params = [("key", key), ("format", "xml"), ("method", "getItems"), ("type", "courses"),
                  ("catalog", catalog)] + [("ids[]", i) for i in batch]
        xml = api_get(base, "content", params)
        if dump:
            dump.mkdir(parents=True, exist_ok=True)
            (dump / f"courses-{start:05d}.xml").write_bytes(xml)
        root = ET.fromstring(xml)
        for el in root.iter():
            if local(el.tag) == "course":
                row = parse_course(el, catalog)
                if row:
                    rows.append(row)
        time.sleep(0.5)
    return rows


def write_csv(rows: list[dict[str, str]]) -> None:
    rows.sort(key=lambda r: (r["prefix"], r["number"]))
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--catalog-id", help="Acalog catalog id (catoid), e.g. 12 for 2026-2027")
    ap.add_argument("--catalog-name", default="", help="name shown to faculty, e.g. '2026-2027 Catalog'")
    ap.add_argument("--base", default=os.environ.get("ACALOG_API_BASE", DEFAULT_BASE))
    ap.add_argument("--key", default=os.environ.get("ACALOG_API_KEY", ""))
    ap.add_argument("--list-catalogs", action="store_true")
    ap.add_argument("--dump-raw", type=Path, help="also save the raw XML responses here")
    args = ap.parse_args(argv)

    if not args.key:
        print("No API key. Set ACALOG_API_KEY (ask the CSULB catalog office for an Acalog API key).")
        return 2
    if args.list_catalogs:
        list_catalogs(args.base, args.key)
        return 0
    if not args.catalog_id:
        print("Pass --catalog-id (use --list-catalogs to find it).")
        return 2

    rows = fetch_courses(args.base, args.key, args.catalog_id, args.dump_raw)
    if not rows:
        print("No courses were parsed; nothing written. Inspect the XML with --dump-raw.")
        return 1
    write_csv(rows)
    meta = {"name": args.catalog_name or f"CSULB catalog {args.catalog_id}",
            "catalogId": args.catalog_id, "updated": date.today().isoformat(), "source": "Acalog API"}
    OUT_META.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    empty = {c: sum(1 for r in rows if not r[c]) for c in ("title", "units", "description")}
    print(f"Wrote {len(rows)} courses to {OUT_CSV.relative_to(ROOT)} (empty: {empty})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
