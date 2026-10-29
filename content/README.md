# Editing the syllabus policy text

This folder holds every statement that goes into CSULB syllabi, one folder per semester. Each college and department edits only its own folder. Changes go live after the folder's owner approves them.

You can do everything on github.com: open a file, click the pencil icon, edit, and choose **Propose changes**. When the site checks your change, it reports any mistakes on the pull request.

## Where things are

```
content/2027-spring/
  _semester.md                        semester name and the note faculty see at the top
  common/                             sections every syllabus has (mostly filled in by the instructor)
  colleges/<college>/_college.md      college name and a note faculty see after choosing it
  colleges/<college>/*.md             the college's sections
  colleges/<college>/departments/<dept>/_department.md
  colleges/<college>/departments/<dept>/*.md
```

Each section is a file. **The file name is the section's ID.** To change a common section for your college or department, create a file with the same name in your folder.

The layers apply in order: **common → college → department**. A department folder works exactly like a college folder and changes the college's version of the syllabus for that department only.

## A section file

```markdown
---
title: Statement of Accommodation
lock: required
---
It is the student's responsibility to notify the instructor...

Second paragraph. Each line is its own paragraph.

- A bullet item
- [Link text](https://www.csulb.edu/...)
- **Bold text**
```

The part between the `---` lines holds the settings; everything below it is the text.

| Setting | Values | Meaning |
|---|---|---|
| `title` | text | Heading shown in the syllabus. Put it in quotes if it contains a colon. |
| `lock` | `required` (default) | Included as written; faculty cannot change it. |
| | `personalize` | Included; faculty start from this text and may edit it. |
| | `optional` | Faculty choose whether to include it (and may edit it). |
| `start` | `on` / `off` | For optional sections: whether the box starts checked. |
| `prompt` | text | Guidance shown to faculty in the form (not printed). |
| `field` | see below | The section is filled in by the instructor. |
| `hide_title` | `yes` | Print the text without a heading (e.g. a vision statement at the top). |
| `source` | text | Where the wording came from. Only for maintainers; never shown. |

Common files also have `order` (a number that sets the position) and may have `protected: yes`, which means colleges and departments can add to the section but not replace or remove it.

## College and department files

**Change an existing section** (from the common layer, or from your college if you are a department): use the same file name and add `action`:

| `action` | Effect |
|---|---|
| `replace` | Your text replaces the existing text. Settings you include (title, lock, prompt) replace the existing ones; the others stay. |
| `append` | Your text is added after the existing text. With no text, it just changes settings such as the title. |
| `remove` | The section is left out for your college or department. |

```markdown
---
action: replace
title: "Special Needs Accommodations: What accommodations are available to support me?"
field: none
---
If you have a special need (e.g., disability, long term or acute health concern, etc.)...
```

**Add a new section:** use a new file name and say where it goes with `before:` or `after:` and another section's file name:

```markdown
---
title: Textbook Access (D1TA)
after: materials
---
All students are enrolled in the D1TA program by default each semester...
```

## Instructor-completed sections (`field`)

| `field` | What the instructor fills in |
|---|---|
| `text` | Free text (e.g. AI policy, late work policy) |
| `info` | Instructor contact, office hours, class meeting times and location |
| `catalog` | Catalog description, prerequisites, GE category |
| `slos` | Student learning outcomes |
| `modality` | One mode of instruction (the definitions are the bullet list in the file) |
| `methods` | Methods of presentation (the choices are in `options:`, separated by `;`) |
| `assessments` | Assessments, linked SLOs, and weights |
| `grading-scale` | Grade ranges (descriptions are the bullet list in the file) |
| `schedule` | Weekly schedule table |
| `none` | Not instructor-completed (use with `action: replace` to turn a field into fixed text) |

Any text in the file is printed before the instructor's entry. When a section already has text, the instructor's entry is optional.

The policy sections in `common/` (academic integrity, attendance, accommodations, withdrawal, communication) are `field: text`, so faculty write them unless their college provides wording. To supply your college's wording, replace the section and add `field: none` so it prints as your text (with `lock: personalize` if faculty may edit it).

## Adding a department or school

A maintainer runs **Actions → Add a department**, picks the college, and enters the folder name (e.g. `mae`), full name, abbreviation, and course prefixes. It opens a pull request with the new folder `colleges/<college>/departments/<name>/`. Add the department's section files to that folder on the pull request, then merge. The same can be done locally with `python scripts/new_department.py`.

The course prefixes (e.g. `MAE, ME`) let the site pick the department automatically when an instructor enters a course. Faculty can also choose it from the **Department or school** menu.

## Starting a new semester

A maintainer runs **Actions → Start a new semester**. It copies the latest semester into a new folder and opens a pull request. Edit your college's files on that pull request. Faculty are shown which sections changed since the previous semester.

## Groups (headings)

Files whose name starts with `group-` and which contain `kind: heading` are the large headings that group the sections (e.g. "Course Policies"). A college can rename one with `action: replace` and a new `title`.

---

Copyright (c) 2026 Ehsan Madadi.
