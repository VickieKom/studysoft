# StudySoft MCP server

Connects the teacher's AI assistant to the platform (#3). The assistant runs in the teacher's own session on her computer; this small program runs next to it over stdio and calls the platform over HTTPS with a personal token. It reads, and saves homework drafts (#43): publishing stays with the teacher (architecture 8.8).

## Tools

| Tool | What it returns |
|------|-----------------|
| `list_students` | The teacher's students: id, first name, status |
| `get_student_context` | For one student: first name, age, school year, CEFR level, textbook and current unit, interests, what works, gaps, and the latest 5 notes |
| `get_homework_format` | The homework format the platform accepts, with its version (the text of `docs/homework-format.md`) |
| `save_homework_draft` | Saves a homework for a student as a draft marked «от ассистента»; replaces the assistant's draft until the teacher edits it, then makes a new one. Never publishes (#43) |
| `read_homework_draft` | The assistant's latest draft for a student, as the teacher may have changed it |

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
