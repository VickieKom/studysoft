# StudySoft MCP server

Connects the teacher's AI assistant to the platform (#3). The assistant runs in the teacher's own session on her computer; this small program runs next to it over stdio and calls the platform over HTTPS with a personal token. It reads, and saves homework drafts (#43) and library drafts (#120): publishing and adding to the library stay with the teacher (architecture 8.8).

## Tools

| Tool | What it returns |
|------|-----------------|
| `list_students` | The teacher's students: id, first name, status |
| `get_student_context` | For one student: first name, age, school year, CEFR level, textbook and current unit, interests, what works, gaps, the latest 5 notes, and the latest 3 submitted homework (each task with its topic, source, the answer, right or wrong, the teacher's mark and comment) with the mistakes by topic across them |
| `get_homework_format` | The homework format the platform accepts, with its version (the text of `docs/homework-format.md`) |
| `save_homework_draft` | Saves a homework for a student as a draft marked «от ассистента»; replaces the assistant's draft until the teacher edits it, then makes a new one. Never publishes (#43) |
| `read_homework_draft` | The assistant's latest draft for a student, as the teacher may have changed it |
| `save_game_draft` | Saves a game (one HTML file, at most 5 MB) to the library as a draft under «От ассистента»; with the id of its earlier draft, replaces it until the teacher edits or adds it. Never adds to the library or deletes (#120) |
| `save_warmup_draft` | The same for a warm-up: a list of questions or a picture (#120) |
| `list_textbooks` | The teacher's textbooks: their books (rendering status, page count) and track names, and whether a structure is confirmed or a draft waits (#150) |
| `read_textbook_text` | The text layer of a book's pages, at most 20 at a time |
| `get_textbook_page` | One rendered page of a book, as an image |
| `read_textbook_structure` | A textbook's confirmed units and lessons and the draft waiting for the teacher |
| `save_textbook_structure` | Saves units and lessons — page ranges in each book, tracks, words — as a draft «от ассистента», checked against the textbook; refused while the teacher has a draft of her own. Never confirms |

Never returned: last names, contacts, payments, links.

## Connecting

1. In the workspace open **Ассистент** and click **Создать токен**. The token and a ready configuration are shown once; copy the configuration.
2. Paste it into the assistant's MCP settings and replace `<путь к репозиторию>` with the path of this repository on the computer.
3. Ask the assistant to list the students.

A new token switches the previous one off; **Отозвать** switches it off at once.

| Variable | Meaning |
|----------|---------|
| `STUDYSOFT_URL` | The platform's address, for example `https://…` |
| `STUDYSOFT_TOKEN` | The token from **Ассистент** |

## Development

The server imports only the router's type from `app/`: a procedure change that the tools do not follow fails `make typecheck`. Tool logic is in `src/tools.ts` and covered by `npm run test:unit -w mcp`, part of `make check`.
