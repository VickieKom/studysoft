# StudySoft

An open-source platform for private language tutors. It keeps everything around a lesson in one place: students and payments, the schedule, a library of learning materials, a two-window lesson mode with a board, and homework that checks itself.

## Status

Early. The repository holds the foundation: architecture, decisions, the rules for coding agents, and the first checks. The application itself is being built in vertical slices tracked in [issues](../../issues).

## Principles

- **The teacher's time is the lesson.** Preparation, homework, checking and reports are semi-automatic: an AI agent drafts, the teacher reviews and publishes. Nothing drafted by AI reaches a student without the teacher's confirmation.
- **Code is open, learning content is not.** Textbooks, games, exercises and tests live in the database and file storage of a running installation, never in this repository. A teacher can export their library and keep a copy.
- **Built by coding agents inside guardrails.** Whatever must hold is checked by a machine. Acceptance scenarios define behaviour before the implementation exists.

## How work flows

1. **Issue.** The product owner opens a task: what and why, acceptance steps, what is out of scope. One task is one vertical slice that can be shown on staging.
2. **Acceptance scenario.** The acceptance steps become an automated scenario in `e2e/acceptance/`, merged before the implementation. Written first, it checks the task rather than whatever code came out.
3. **Implementation.** A coding agent implements the issue under the rules in [AGENTS.md](AGENTS.md) and opens a pull request.
4. **Checks.** CI runs the same `make check` that runs locally, plus a secret scan. A red check blocks the merge.
5. **Merge.** The product owner merges ordinary changes. Changes to the paths in [CODEOWNERS](.github/CODEOWNERS) — database schema, access, the checks themselves, deployment — wait for the maintainer. The maintainer's own pull requests there are approved by the product owner.
6. **Staging.** The merged build appears on staging, where the result is reviewed.

How the system is put together and why: [docs/architecture.md](docs/architecture.md).

## Development

You need Git, Bash, Node.js 22 or newer, and Docker.

```bash
make dev     # start the local stand at http://localhost:3000
make e2e     # run the acceptance scenarios against a production build
make check   # run every check that CI runs
make help    # list every command
```

`make dev` starts PostgreSQL in Docker, applies migrations, loads the synthetic data from `deploy/seed/` and runs the application with hot reload. Sign in with an account from `deploy/seed/teachers.json`.

## License

[MIT](LICENSE)
