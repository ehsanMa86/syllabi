# CSULB Syllabus Builder

A website where CSULB faculty build a course syllabus from the current university, college and department policy statements, add their own course details, and download it as an editable **Word (.docx)** file or an accessible **PDF**.

It runs entirely on GitHub Pages. There is no server and no database, and nothing a faculty member types leaves their browser.

## How it works

```
content/2027-spring/
  _semester.md                  semester label and notes for faculty
  university/                   CSULB Syllabus Template: every syllabus gets these sections
  colleges/ced/                 College of Education additions and replacements
  colleges/chhs/departments/ccjem/   school-level additions (optional)
  colleges/cob/ ...
catalog/courses.csv             course titles, units, descriptions (for "Look up in catalog")
site/                           the web app (HTML, CSS, JavaScript)
scripts/build.py                checks the content and builds the site into dist/
```

1. **Layers.** The university layer defines every section and its order. A college layer can replace a section, append to it, remove it, or add a new one before or after any section. A department layer applies on top of its college in the same way. The build checks every layer and produces one merged section list for each college and department.
2. **Faculty form.** The site shows one card per section, in syllabus order. Each card says whether its text is required as written, editable, optional, or for the instructor to complete. A live preview and a checklist (PS 12-03 weights, office hours, SLOs, and so on) update as the instructor types.
3. **Output.**
   - **Word:** the .docx is built in the browser with real heading styles, Word lists, repeating table header rows and document properties, so it passes Word's accessibility checker.
   - **PDF:** built in the browser with the same layout as the Word file: tagged for screen readers (headings, lists, tables), Carlito font (metric-compatible with Calibri) embedded, table headers repeated on each page, and page numbers.
4. **Drafts.** Drafts autosave in the browser. **Draft → Save draft file** downloads a .json that can be opened next semester; the new semester's policy text is then used automatically. Personalized sections whose provided text changed since the draft are flagged.

## Every semester

1. In **Actions → Start a new semester → Run workflow**, enter the new folder name (for example `2027-fall`). The workflow copies the latest semester and opens a pull request.
2. The university and each college edit their own files on that pull request's branch, directly on github.com. [content/README.md](content/README.md) is the editing guide.
3. Each folder's owner approves the changes (see [.github/CODEOWNERS](.github/CODEOWNERS)). Merging publishes the new semester; it becomes the default, and older semesters stay available.

Faculty see a list of policy changes since the previous semester for their college.

## Course catalog

The catalog at catalog.csulb.edu runs on Acalog, and its pages block automated downloads. Course details therefore come from the instructor's own browser:

1. **Open in catalog** opens the catalog search for the course in a new tab.
2. The instructor copies the course entry and pastes it into **Fill in from the online catalog**.
3. The site fills in the title, units, prerequisites, GE category and description, and reports anything it could not find.

This works for every course and needs no catalog data in the repository.

Optionally, the site can also keep its own copy in [catalog/courses.csv](catalog/README.md). When that file has courses, a **Look up** button appears next to the course field and fills in details in one click. It can be filled from an export, or from the Acalog API if a key is ever available (secret `ACALOG_API_KEY`, variable `ACALOG_CATALOG_ID`; the **Update course catalog** workflow then refreshes it monthly).

Student learning outcomes are not in the catalog. They come from each course's Standard Course Outline, which faculty enter.

## Publishing on GitHub Pages

1. Push this folder to a GitHub repository.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. Every push to `main` runs **Build and publish**, which checks the content, runs the tests and deploys. Pull requests run the same checks without deploying.
4. Recommended: **Settings → Branches → protect `main`**, requiring pull requests and "Review from Code Owners". Then fill in the handles in `.github/CODEOWNERS`.
5. For the two workflows that open pull requests: **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests.**

## Working locally

Requires Python 3.10 or newer; there are no packages to install for the site itself.

```
python scripts/build.py                     # check content and build dist/
python -m http.server -d dist 8000          # open http://localhost:8000
python scripts/build.py --check             # check content only
python -m unittest discover -s tests -v     # unit tests
pip install python-docx pymupdf
python tests/run_browser_tests.py           # headless Chrome/Edge: preview, Word and PDF output
python scripts/new_semester.py 2027-fall    # same as the rollover workflow
```

## Third-party code

- [docx](https://github.com/dolanmiu/docx) 9.5.1 (MIT license) in `site/vendor/docx/` generates Word files.
- [PDFKit](https://github.com/foliojs/pdfkit) 0.17.2 (MIT license) in `site/vendor/pdfkit/` generates PDF files.
- [Carlito](https://github.com/googlefonts/carlito) fonts (SIL Open Font License 1.1) in `site/vendor/fonts/` are embedded in the PDFs.

## License

Copyright (c) 2026 Ehsan Madadi.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for details.

Policy statements in `content/` are CSULB, college and department text and are not covered by this copyright. The bundled libraries and fonts in `site/vendor/` keep their own licenses.
