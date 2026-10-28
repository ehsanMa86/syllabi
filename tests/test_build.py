# Copyright (c) 2026 Ehsan Madadi
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the content loader, layer merging and catalog import in scripts/build.py.

    python -m unittest discover -s tests -v
"""
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import build  # noqa: E402


def write(root: Path, rel: str, text: str) -> Path:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(text).lstrip(), encoding="utf-8")
    return path


class TempContent(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)

    def semester(self, name="2027-spring"):
        folder = self.root / name
        write(folder, "_semester.md", "---\nlabel: Test Term\n---\nNotes.\n")
        write(folder, "university/group-a.md", "---\nkind: heading\norder: 10\ntitle: Group A\n---\n")
        write(folder, "university/alpha.md", "---\ntitle: Alpha\norder: 20\n---\nAlpha text.\n")
        write(folder, "university/beta.md", "---\ntitle: Beta\norder: 30\nprotected: yes\n---\nBeta text.\n")
        write(folder, "university/gamma.md", "---\ntitle: Gamma\norder: 40\nfield: text\n---\n")
        write(folder, "colleges/abc/_college.md", "---\nname: College of ABC\nshort: ABC\n---\n")
        return folder

    def load(self, folder):
        report = build.Report()
        sem = build.load_semester(folder, report)
        return sem, report

    def merged(self, folder, key="abc"):
        sem, report = self.load(folder)
        combos = {k: m for k, _, _, m in build.combinations(sem, report)}
        return combos.get(key), report


class ParseTests(TempContent):
    def test_front_matter_and_body(self):
        p = write(self.root, "x.md", '---\ntitle: "Quoted: title"\norder: 5\n---\nLine one.\n\nLine two.\n')
        meta, body = build.parse_file(p)
        self.assertEqual(meta, {"title": "Quoted: title", "order": "5"})
        self.assertEqual(body, "Line one.\n\nLine two.")

    def test_unclosed_front_matter(self):
        p = write(self.root, "x.md", "---\ntitle: x\n")
        with self.assertRaises(build.ContentError):
            build.parse_file(p)

    def test_unknown_key_is_an_error(self):
        folder = self.semester()
        write(folder, "university/delta.md", "---\ntitle: Delta\norder: 50\ncolour: red\n---\n")
        _, report = self.load(folder)
        self.assertTrue(any("unknown key 'colour'" in e for e in report.errors))

    def test_bad_link_is_an_error(self):
        folder = self.semester()
        write(folder, "university/delta.md", "---\ntitle: Delta\norder: 50\n---\nSee [site](www.example.com).\n")
        _, report = self.load(folder)
        self.assertTrue(any("must start with https://" in e for e in report.errors))


class MergeTests(TempContent):
    def ids(self, sections):
        return [s.id for s in sections]

    def test_college_without_files_gets_university_layer(self):
        merged, report = self.merged(self.semester())
        self.assertEqual(report.errors, [])
        self.assertEqual(self.ids(merged), ["group-a", "alpha", "beta", "gamma"])

    def test_replace_keeps_unspecified_settings(self):
        folder = self.semester()
        write(folder, "colleges/abc/alpha.md", "---\naction: replace\nlock: personalize\n---\nABC alpha.\n")
        merged, report = self.merged(folder)
        alpha = merged[1]
        self.assertEqual(report.errors, [])
        self.assertEqual(alpha.body, "ABC alpha.")
        self.assertEqual(alpha.meta["title"], "Alpha")
        self.assertEqual(alpha.meta["lock"], "personalize")
        self.assertEqual(alpha.layers, ["University", "ABC"])

    def test_append_and_retitle(self):
        folder = self.semester()
        write(folder, "colleges/abc/alpha.md", "---\naction: append\ntitle: New Alpha\n---\nMore.\n")
        merged, _ = self.merged(folder)
        self.assertEqual(merged[1].body, "Alpha text.\n\nMore.")
        self.assertEqual(merged[1].meta["title"], "New Alpha")

    def test_remove(self):
        folder = self.semester()
        write(folder, "colleges/abc/alpha.md", "---\naction: remove\n---\n")
        merged, _ = self.merged(folder)
        self.assertNotIn("alpha", self.ids(merged))

    def test_new_sections_including_chained_placement(self):
        folder = self.semester()
        write(folder, "colleges/abc/one.md", "---\ntitle: One\nafter: alpha\n---\nOne.\n")
        write(folder, "colleges/abc/aaa-two.md", "---\ntitle: Two\nafter: one\n---\nTwo.\n")
        write(folder, "colleges/abc/zero.md", "---\ntitle: Zero\nbefore: group-a\n---\nZero.\n")
        merged, report = self.merged(folder)
        self.assertEqual(report.errors, [])
        self.assertEqual(self.ids(merged), ["zero", "group-a", "alpha", "one", "aaa-two", "beta", "gamma"])

    def test_department_layer_applies_after_college(self):
        folder = self.semester()
        write(folder, "colleges/abc/alpha.md", "---\naction: replace\n---\nCollege.\n")
        write(folder, "colleges/abc/departments/xyz/_department.md", "---\nname: Dept XYZ\nprefixes: XYZ, XY\n---\n")
        write(folder, "colleges/abc/departments/xyz/alpha.md", "---\naction: append\n---\nDept.\n")
        merged, report = self.merged(folder, "abc.xyz")
        self.assertEqual(report.errors, [])
        self.assertEqual(merged[1].body, "College.\n\nDept.")
        self.assertEqual(merged[1].layers, ["University", "ABC", "XYZ"])

    def test_existing_section_needs_action(self):
        folder = self.semester()
        write(folder, "colleges/abc/alpha.md", "---\ntitle: Alpha\n---\nOops.\n")
        _, report = self.merged(folder)
        self.assertTrue(any("already exists" in e for e in report.errors))

    def test_protected_section_cannot_be_replaced_but_can_be_appended(self):
        folder = self.semester()
        write(folder, "colleges/abc/beta.md", "---\naction: replace\n---\nNo.\n")
        _, report = self.merged(folder)
        self.assertTrue(any("protected" in e for e in report.errors))

        folder2 = self.semester("2027-fall")
        write(folder2, "colleges/abc/beta.md", "---\naction: append\n---\nYes.\n")
        merged, report2 = self.merged(folder2)
        self.assertEqual(report2.errors, [])
        self.assertEqual(merged[2].body, "Beta text.\n\nYes.")

    def test_unknown_anchor_and_missing_placement(self):
        folder = self.semester()
        write(folder, "colleges/abc/new1.md", "---\ntitle: New\nafter: nowhere\n---\nX.\n")
        write(folder, "colleges/abc/new2.md", "---\ntitle: New 2\n---\nX.\n")
        _, report = self.merged(folder)
        self.assertTrue(any("no section named 'nowhere'" in e for e in report.errors))
        self.assertTrue(any("need 'before:' or 'after:'" in e for e in report.errors))

    def test_action_on_missing_section(self):
        folder = self.semester()
        write(folder, "colleges/abc/typo.md", "---\naction: replace\n---\nX.\n")
        _, report = self.merged(folder)
        self.assertTrue(any("no section 'typo'" in e for e in report.errors))

    def test_field_none_clears_field(self):
        folder = self.semester()
        write(folder, "colleges/abc/gamma.md", "---\naction: replace\nfield: none\n---\nFixed text.\n")
        merged, _ = self.merged(folder)
        self.assertEqual(merged[3].to_json()["field"], "none")


class ChangeTests(TempContent):
    def test_changes_between_semesters(self):
        a = self.semester("2027-spring")
        b = self.semester("2027-fall")
        write(b, "university/alpha.md", "---\ntitle: Alpha\norder: 20\n---\nAlpha text, revised.\n")
        write(b, "colleges/abc/extra.md", "---\ntitle: Extra\nafter: alpha\n---\nNew.\n")
        (b / "university/gamma.md").unlink()
        sa, _ = self.load(a)
        sb, _ = self.load(b)
        changes = {(c["section"], c["change"]) for c in build.changes_between(sa, sb)}
        self.assertEqual(changes, {("alpha", "updated"), ("extra", "added"), ("gamma", "removed")})

    def test_semester_sort_order(self):
        report = build.Report()
        sems = [build.load_semester(self.semester(n), report) for n in ("2027-fall", "2027-spring", "2026-fall")]
        sems.sort(key=lambda s: s.sort_key)
        self.assertEqual([s.id for s in sems], ["2026-fall", "2027-spring", "2027-fall"])


class CatalogTests(TempContent):
    def test_csv_import(self):
        write(self.root, "courses.csv", """\
            prefix,number,title,units,description,prerequisites,ge,url
            engr,102,Academic Success Skills,1,Study skills.,,,
            ,200,Missing prefix,3,,,,
            """)
        old = build.CATALOG
        build.CATALOG = self.root
        try:
            report = build.Report()
            meta, courses = build.load_catalog(report)
        finally:
            build.CATALOG = old
        self.assertEqual(courses, {"ENGR": {"102": {"title": "Academic Success Skills", "units": "1",
                                                    "description": "Study skills."}}})
        self.assertEqual(len(report.warnings), 1)


class RealContentTests(unittest.TestCase):
    def test_repository_content_is_valid(self):
        report = build.Report()
        semesters = build.load_all(report)
        for sem in semesters:
            list(build.combinations(sem, report))
        self.assertEqual(report.errors, [])


if __name__ == "__main__":
    unittest.main()
