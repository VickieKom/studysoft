# Seed data

Synthetic data for the local stand, CI and staging. It is written for this repository: no real people, no learning content (AGENTS.md, rules 6 and 7).

| File | What |
|------|------|
| `teachers.json` | Two teacher accounts. The first is the one you sign in with on the local stand; the second exists for the tenant-isolation checks |
| `students.json` | Students, each attached to a teacher by email. The first teacher deliberately has none, so the empty student list is what you see after signing in |
| `homework/*.json` | Synthetic homework in the format of `docs/homework-format.md`, for the homework scenarios (#32). Written for this repository: no textbook content |
| `history/*.csv` | Synthetic results in the history import format (`docs/history-import-format.md`), for the history import scenarios (#38). Never loaded by `make dev`; uploaded in the scenarios like a teacher would |

The passwords open only local and test stands. Staging and production never load these accounts with these passwords.

`make dev` loads this data into the local database; loading again changes nothing.
