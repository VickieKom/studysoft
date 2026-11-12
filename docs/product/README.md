# StudySoft — Product requirements

What the platform must do, for whom, and how its parts depend on each other. Use this together with [docs/architecture.md](../architecture.md), which covers how the system is built and why.

These documents are the functional part of the product owner's specification. They leave out business figures, strategy and anything about real students.

## Documents

| Document | Answers |
|----------|---------|
| [Roles and access](roles-and-access.md) | Who uses the platform, how each role gets in, and what each may see and do |
| [User flows](user-flows.md) | The key journeys from a new student to a monthly report |
| [Modules](modules.md) | What each section does and in which stage it is built |
| [Data flows and events](data-flows.md) | Where each piece of data is edited, who reads it, and what each event changes across sections |
| [Stage 1 acceptance](acceptance-stage-1.md) | How the product owner decides that stage 1 is done |
| [Design reference](design.md) | Visual language and the screens, described in text |

## How to read them

- **Priorities.** P1 is stage 1, the core. P2 is stage 2: progress tracking and parents. P3 is stage 3: engagement and growth. The data model and the architecture account for P3 from the start; screens and logic arrive by stage.
- **The requirements say what, the issues say exactly how.** Each stage 1 slice is an issue with an Acceptance section, and that section becomes a Playwright scenario. When an issue and these documents disagree, the issue wins: it is newer and was agreed for that slice. Update this folder in the same pull request when a slice changes a requirement.
- **Screens are a starting point, not a pixel specification.** The product owner polishes each section as it is built. Follow the functions and the meaning, not the layout.
- **Interface language.** The interface is in Russian, learning content is in English. Russian interface strings quoted here are the texts to use.

## Guiding principles

1. **The teacher's time is the lesson.** Everything around a lesson — preparation, homework, checking, reports — is semi-automatic: an AI assistant prepares a draft, the teacher reviews it and publishes it. Nothing drafted by AI reaches a student or a parent without the teacher's confirmation.
2. **Sections are connected.** Data is entered once and used everywhere. The textbook on a student's card determines lesson materials, homework, vocabulary and assessments; homework results feed the lesson, the dashboard and the report. See [Data flows and events](data-flows.md).
3. **A manual path for everything.** Whatever the assistant prepares, the teacher can also do by hand.
4. **Students and parents need no accounts.** They open a personal link on their phone, from a country where foreign services may be blocked.

## Scale

One teacher with a few individual students now; about ten students and small groups of up to four within a year; several teachers later. Students are teenagers, mostly 12–15 years old.
