# Agent rules

Operating manual for coding agents working in this repository. It is terse on purpose: rules and pointers, not narrative. The reasoning lives in [docs/architecture.md](docs/architecture.md); read the relevant part before changing a pattern.

StudySoft is a platform for private language tutors: students and payments, schedule, a library of learning materials, a two-window lesson mode, homework with automatic checking. One Next.js application in TypeScript over PostgreSQL, plus an MCP server that lets the teacher's own AI agent read context and save drafts.

**Status:** the walking skeleton is being built. `app/`, `e2e/acceptance/` and `deploy/` exist; the student card (#18) is the nearest slice to copy for a list, a card and a form that saves through the router; the teacher sign-in (#17) for anything around teacher sessions; the student link (#19) for screens behind a link (`app/src/app/s/`) and student procedures (`studentProcedure`, `app/src/server/router/student/`); the assistant (#3) for agent procedures (`agentProcedure`, `app/src/server/router/agent/`), the student context (`app/src/server/crm/context.ts`) and MCP tools (`mcp/`). `e2e/smoke/` appears with its slice. Do not invent a different layout.

## How we work

- **One issue, one vertical slice.** A slice goes through every layer and can be shown on staging. Do not start work without an issue that has an Acceptance section.
- **Scenario first.** The acceptance scenario for an issue is written before the implementation, in its own draft pull request. That pull request is reviewed but not merged: a scenario without its implementation keeps `main` red. The implementation branch starts from the scenario branch, its pull request lands both, and it supersedes the scenario pull request. It leaves the scenario files exactly as the scenario pull request has them; if the scenario turns out wrong, fix it in the scenario pull request and rebase onto it. Name the branches `feature/<issue>-acceptance-<topic>` for the scenario and `feature/<issue>-<topic>` for the implementation: `acceptance-unchanged` finds the reviewed scenario by that name and compares content, so `playwright.config.ts` and every scenario file the scenario branch changed must stay byte-identical.
- **Copy the nearest slice.** Find the closest existing slice and follow its layout, naming and tests. Three similar lines beat a premature helper.
- **Surgical edits.** Do not refactor adjacent code while passing by. File an issue instead.
- **Living documentation.** A change to a pattern updates the document that describes it in the same pull request. A stale document is a bug.
- **When sources disagree**, trust in this order: code and CI configuration, then tests, then a specific document over a general one. If you cannot tell which is right, ask instead of guessing.
- **Unclear requirement → ask.** Do not fill a gap in the task with your own assumption and implement it.

## Hard rules

Each of these is, or will be, enforced by a check. Breaking one fails the pipeline.

1. **Data goes through the router only.** Screens, server components and the MCP server read and change data through router procedures. Code outside `app/src/server/` imports only the router entry point, `app/src/server/router/index.ts`: client components through the router client, server components and `app/src/app/api/` through its server caller. Nothing outside `app/src/server/` imports any other server module or touches the database.
2. **Every procedure declares its output schema.** Never return a database row as is.
3. **Access is deny-by-default.** Every procedure is exactly one kind: public, teacher, student, parent or agent. Reachable without a session are only teacher sign-in and sign-out (the authentication library's endpoints, allow-listed in `app/src/server/access/auth.ts`), the exchange of a link token for a session, and the health check; adding another one is a guarded change. The teacher identifier comes from the session, never from the request.
4. **Students and parents never receive** correct answers before submission, teacher notes, payments, contacts, or another student's data.
5. **Agent procedures create drafts only.** Publishing is a teacher procedure.
6. **No learning content in the repository.** No textbook pages or excerpts, exercises, games, recordings, characters, or real student data — not in code, tests, seed data, comments or documentation.
7. **Test data is synthetic and lives only in `deploy/seed/`.** It is written for this repository; it is never copied from a real textbook or a real lesson.
8. **Never edit, rename or delete an existing acceptance scenario in the same pull request as product code.** Adding new scenarios is fine.
9. **Never skip, disable or weaken a failing test or check.** Fix the code. Change a test only when the test itself is wrong, and say so in the pull request.
10. **No secrets, tokens or personal names** in code, logs, fixtures or commits. Logs carry internal identifiers only.
11. **No new dependency for a few lines of code.** Adding one needs the maintainer's approval.
12. **No server actions and no route handlers outside `app/src/app/api/`.**

## Guarded paths

Changes to the paths in [.github/CODEOWNERS](.github/CODEOWNERS) need the maintainer's approval: database schema and migrations, access code, base procedures and the public, student, parent and agent procedures, entry points under `app/src/app/api/` and request gating (middleware, proxy), the MCP server, Next.js configuration, dependencies, check configuration (linters, TypeScript, test runners, migration tool, secret scan), CI, deployment, this file, and the architecture document. The product owner is a second code owner only so that the maintainer's own pull requests can be approved; every other change to these paths waits for the maintainer. If a task needs such a change, keep it as small as possible and explain it in the pull request.

## Language

- Code, comments, documentation, issues, commits and pull requests: English.
- User interface text: Russian, written directly in the components.
- No names of specific AI tools or vendors in code or comments. The attribution lines a coding agent adds to commits and pull requests are fine.

## Commands

```bash
make help    # list commands
make dev     # local stand: PostgreSQL in Docker, migrations, seed data, app on :3000
make check   # everything CI runs; run it before every push (needs Docker running)
```

Teacher accounts for the local stand are in `deploy/seed/teachers.json`. An environment with real data gets its teacher from `npm run db:create-teacher -w app`, which reads `TEACHER_NAME`, `TEACHER_EMAIL` and `TEACHER_PASSWORD` from the environment.

`make check` is the single source of truth for what CI runs. When a slice adds a check, it adds it to `make check`.

## Target layout

```text
app/
  src/app/teacher/     teacher's workspace
  src/app/s/           screens behind a student link
  src/app/p/           screens behind a parent link
  src/app/api/         entry points: router, files, /api/healthz
  src/server/<module>/ server modules: access, crm, schedule, library, lesson, homework, blob
  src/server/router/   procedures, grouped by who may call them
  src/server/db/       schema and migrations
  src/components/      shared interface components
mcp/                   MCP server for the teacher's AI agent
e2e/acceptance/        acceptance scenarios, written by the product owner
e2e/smoke/             smoke checks for a deployed environment
deploy/                compose files, image build, seed data
docs/                  architecture
scripts/ci/            guard scripts run by `make check`
```

Order of work inside a slice: schema, then server module and procedure, then screen, then tests.

Schema changes: edit `app/src/server/db/schema.ts`, then `npm run db:generate -w app -- --name <what>`. Start every migration with `SET LOCAL lock_timeout` and `SET LOCAL statement_timeout` like the first one; `make migrations` checks it.

Screens of the teacher's workspace get their router caller from `app/src/app/teacher/caller.ts`. It redirects to sign-in without a session; the layout alone does not protect a page, because Next renders them in parallel.

Client components call the router through `app/src/components/router-client.ts`; values shared by screens and server validation (levels, statuses, time zones) live in `app/src/domain/`, which holds plain data only. A missing record and another teacher's record end in the same `notFound()` page (see `app/src/app/teacher/students/student.ts`).

## Tests

- Pure logic (answer checking, balance, time zones) gets unit tests.
- Anything that touches the database, permissions or the shape of a response gets an integration test against real PostgreSQL.
- New branching, parsing, money or security logic leaves at least one test behind.
- Acceptance scenarios cover behaviour as a user sees it. They are owned by the product owner.

## Shortcuts and debt

- A deliberate shortcut is marked where it is taken: `// shortcut: <limit>, <when to upgrade> (#<issue>)`.
- No `TODO` without an issue number.
- A problem you find but do not fix in the current task becomes an issue, not a note.

## Commits and pull requests

- Short, meaningful commit subjects in the imperative mood. Branches: `feature/`, `bugfix/`, `hotfix/`.
- A pull request closes one issue and says how the change was checked.
- Direct pushes to `main` are not allowed.
