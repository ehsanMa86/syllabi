# Course catalog data

`courses.csv` feeds the **Look up in catalog** button. One row per course:

| Column | Example |
|---|---|
| `prefix` | `ENGR` |
| `number` | `102` |
| `title` | `Academic Success Skills` |
| `units` | `1` |
| `description` | Catalog description, plain text |
| `prerequisites` | `None` |
| `ge` | GE category, if any |
| `url` | Link to the course in the online catalog |

Only `prefix`, `number` and `title` are required. `meta.json` holds the catalog's name, which faculty see after a lookup.

To refresh the file:

- **Acalog API:** `ACALOG_API_KEY=... python scripts/catalog_acalog.py --catalog-id 12 --catalog-name "2026-2027 Catalog"`. The **Update course catalog** workflow does the same monthly once the key is saved as a repository secret. The first time, run with `--dump-raw raw/` and check that units, descriptions and prerequisites landed in the right columns, because field names in the API vary by campus.
- **Spreadsheet export:** save it as UTF-8 CSV with the column names above and replace `courses.csv`.

---

Copyright (c) 2026 Ehsan Madadi.
