# Data flows and events

The platform is not a set of separate screens: the same data is created in one place and used in many. This document says where each kind of data is edited, who reads it, and which events change what across sections. Decisions on the contested points are listed at the end.

Where a later issue changed a requirement, the issue is named. The architecture describes how events are implemented: each event is one function of a server module in one transaction ([architecture](../architecture.md), 4.1).

## Sources of truth

Each kind of data is edited **in one place**. Every other section only reads and shows it, with an "edit" link to the source. There are no copies to keep in sync by hand.

| Data | Edited in | Used by |
|------|-----------|---------|
| Student profile: first and last name, age, school year, time zone, contacts, status | Student card | Every section. Time zone: schedule, reminders. Contacts: sending reports and links. Status: filters, whether links work. The last name: teacher screens only (#18) |
| CEFR level | Card (changes after the introductory meeting and level tests) | Every assistant draft (difficulty), overview, dashboard, report, library filters (warm-ups, games) |
| Interests, "what works" | Card | Assistant: lesson plan, homework, video tasks, vocabulary exercises, assessment texts; choosing library materials; choosing characters |
| Gaps / topics to strengthen | Card (kept by the teacher by hand; suggestions from repeated mistakes are P3) | Assistant: lesson plan, homework, assessment; report ("what we are working on") |
| Textbook and current unit | Card: "Текущий юнит". Moves to the next unit when the teacher ticks "Юнит пройден" while finishing a lesson; can be changed by hand | Lesson materials on the stage, homework, vocabulary, assessment (units of the month), textbook progress (overview, dashboard, report) |
| Mascot and characters | Card (chosen from the library's characters) | Every student screen, assistant homework (task stories), games, videos |
| Favourite colour (theme) | Card (from a fixed set of themes) | Every screen behind the student link, games, assistant-made games, the lesson stage (P3) |
| Lesson price, payment format | Card → Payments | Balance, overview ("paid lessons running out"), report (if ticked) |
| Recurring slots | Schedule (the card as an entry point) | Creating lessons ahead, homework deadlines, reminders, overview |
| Lesson: date, status, unit, plan stages, materials, board, note, meeting link | Schedule and lesson mode | Lesson history on the card, payments, homework (link and deadline), vocabulary, assistant context, report (units covered) |
| Textbooks, units, pages, tracks, vocabulary lists, answer keys | Library (parsing plus the teacher's corrections) | Stage (textbook tab), homework (tasks and checking), vocabulary, assessment (texts and audio), textbook progress |
| Games, warm-ups, videos, characters | Library | Lesson plan and stages, stage, homework, mascot choice |
| Homework tasks | Homework editor (from a lesson or from the card) | Student link, lesson history |
| Student answers (submissions) and their checking | Student link → "Проверка домашек" | Homework tab on the stage, card, overview, dashboard (completion rate), vocabulary (retention), gap suggestions (P3), assistant context, report |
| Student vocabulary | Filled after a lesson (the unit's vocabulary covered in it plus board words); the teacher edits it on the card | Student link, homework, dashboard, report |
| Assessment results and voice recordings | Assessments (automatic plus the teacher's marks) | Card, dashboard, overview (drops), report ("then / now"), gaps, assistant plan |
| Notes on a student or a lesson | Card, lesson panel, "Проверка домашек" (comment for the lesson) | Card (feed), next lesson's panel, assistant plan, assistant report |
| Payments | Payments on the card | Balance (computed: payments minus charged lessons), overview, report (optional) |
| Student feedback | Student link (weekly survey and the question after homework); questions are built from lesson plans and homework | Card ("Фидбэк" tab, "what works" rating), overview ("new feedback"), next lesson's panel ("пока путаюсь"), library ("liked by N children"), assistant plan and homework. **Never to parents or reports** |
| Report template, cancellation rule | Teacher settings | Reports; payments on cancellation |

## Student context for the assistant

Every assistant feature reads **one student context**, built by one function on the server, so the logic is not duplicated. The context is read at the moment of drafting, and the snapshot used is saved with the draft, so it is clear what the draft was based on. Changing the card affects only **future** drafts; nothing published is rewritten.

| Used ↓ / Draft → | Lesson plan | Homework | Assessment | Parent report | Video tasks, vocabulary exercises |
|---|---|---|---|---|---|
| Age, CEFR level | ✓ | ✓ | ✓ | ✓ | ✓ |
| Textbook and current unit (pages, exercises, vocabulary, keys) | ✓ | ✓ | ✓ (units of the month) | ✓ (units covered) | — |
| Interests, "what works" | ✓ (games, warm-ups) | ✓ (stories, examples) | ✓ (reading texts) | — | ✓ |
| Mascot and characters | — | ✓ | — | — | ✓ |
| Gaps / track | ✓ | ✓ (more practice) | ✓ | ✓ ("what we are working on") | — |
| Mistakes from recent homework | ✓ (review stage) | ✓ (repeat what was hard) | — | ✓ | — |
| Vocabulary, especially poorly retained words | — | ✓ | ✓ (vocabulary) | ✓ (word count) | ✓ |
| Assessment results over time | ✓ (drops) | — | — | ✓ | — |
| Recent teacher notes | ✓ | — | — | ✓ | — |
| Lesson history: what was covered, lesson notes | ✓ | ✓ | ✓ | ✓ | — |
| Feedback: what works, "so-so", "пока путаюсь" | ✓ (games, warm-ups, topics; repeat rules) | ✓ (task types) | — | — (not for parents) | ✓ |
| Report template | — | — | — | ✓ | — |

The assistant receives only the student's first name, never contacts or the last name.

## Events and their consequences

Key events change data in several sections at once. Each one is an explicit command, never logic scattered over screens.

| Event | What happens |
|-------|--------------|
| **Student created** | Status "Обсуждение"; an empty vocabulary. The student link and the parent link are issued at once and work from the start (#19, #20) |
| **Introductory meeting or trial lesson held** | These lesson types are **free**: not charged, and not counted in attendance or homework completion. The card gets the level, interests, gaps, textbook and the level-check results, which become the starting skill scores for the dashboard |
| **Status → "Занимается"** | Recurring slots are set; the start date of lessons is recorded, and the monthly assessment schedule is counted from it. The vocabulary is still empty: words arrive after lessons |
| **Status → "На паузе"** | Future lessons are no longer created from slots; history, vocabulary and reports are kept. **The links keep working** (#21) |
| **Status → "Завершили"** | Future lessons are removed; history, vocabulary and reports are kept. **Both links and every session opened from them stop working.** Moving the student back from "Завершили" issues **new** links; the old ones stay revoked (#21) |
| **Link reissued** | The old link and every session opened from it stop working at once; the card offers the new link. Student and parent links are reissued separately (#21) |
| **Slot created or changed for good** | Lessons are created ahead (for example, four weeks) and topped up as time moves; past lessons and lessons moved by hand are left alone |
| **Lesson moved** | New date in the schedule and history ("moved from …"); the current homework's deadline moves with it; reminders are rebuilt; payment unchanged |
| **Lesson cancelled** | History: "cancelled"; payment follows the cancellation rule (less than 24 hours ahead is charged, otherwise not; the teacher can override); the homework moves to the next lesson (deadline = next lesson) |
| **Lesson prepared or opened** | Materials of the current unit are pulled from the library; the assistant drafts the plan stages; the homework tab shows the latest submission for this lesson; notes and topics from the previous lesson appear on the panel |
| **Lesson finished** | The panel opens "Завершить урок": a note; **words to the vocabulary** — the unit's vocabulary from the pages covered in this lesson (pre-ticked, words already added are hidden) plus board words; the teacher unticks extras and confirms; **"Юнит пройден → дальше Unit N+1"**; homework to publish. On confirmation: status "held" → history; charge to the balance if the lesson is paid; words → vocabulary; board snapshot; homework published (deadline = next scheduled lesson); with "Юнит пройден" the card's current unit moves to the next one, and the next lesson's materials, plan and homework come from it |
| **Homework published** | It appears behind the student link. The previous unsubmitted homework closes as "не сдана", which counts in the dashboard's completion rate. Until the schedule exists the teacher sets the deadline by hand (#32). P3: an option to leave unsubmitted homework open for practice without affecting statistics; reminders |
| **Homework withdrawn** | Only while the student has not submitted: the student link shows no homework again, and the homework becomes a draft that can be fixed and published again (#32) |
| **Homework submitted** | Automatic checking; an entry in "Проверка домашек" (the menu counter); the completion rate updates; retention of words that appeared in the tasks updates; mistakes become available on the next lesson's homework tab; a notice to the teacher (P3) |
| **Homework not submitted by the lesson** | "не сдана" in history and dashboard; a "Требует внимания" entry on the overview; the student can still finish it until the next homework is published |
| **Teacher checked homework** | The final result. The teacher marks open answers right or wrong and may override automatic results; the score is recalculated. The comment goes to the notes for the next lesson. P3: repeated mistakes **suggest** adding a topic to the gaps, the teacher confirms |
| **Teacher reopened homework** | The student can do it again; the first submission stays in the history. Pending the maintainer's decision in #36 |
| **Assessment due** | Monthly from the student's start date, each student with their own date. A few days before: "Требует внимания — time to prepare the assessment"; the assistant drafts a test from the units covered since the last one |
| **Assessment done and marked** | Skill scores → card and dashboard. **A drop of 5 percentage points or more** in a skill since the last assessment → "Требует внимания" (the threshold is a setting). The speaking recording goes to "then / now". The report for the period **from the previous assessment to this one** becomes "ready to prepare" and the assistant drafts it |
| **Level test** | Changes the CEFR level on the card (with history); affects future drafts |
| **Report sent** | A version is recorded (a snapshot of the data at sending); it appears on the parent page; a PDF goes to the parent's email; an entry on the card |
| **Payment recorded** | The balance is recomputed; the "paid lessons running out" warning clears |
| **Interests, level or gaps changed** | Affect only new drafts; published homework and sent reports do not change |
| **Mascot or favourite colour changed** | It is appearance, not content: applied **at once** to every student screen and game, including already published homework. Assistant task stories with the old mascot are not rewritten |
| **Textbook or unit changed** | Materials of future lessons and homework come from the new unit; the new unit's words reach the vocabulary after the lessons that cover them; textbook progress is recomputed |
| **Textbook re-parsed or its structure corrected** | Units update; existing homework, vocabularies and history are not broken |
| **Last lesson of the week finished** | A weekly survey is built from the stages of the week's lesson plans (task pairs, topics, rules) with pictures from the library and board snapshots, and appears behind the student link as a card above the homework |
| **Survey answered** (weekly or after homework) | The "what works" rating on the card and the ratings of library materials are recomputed; "new feedback" on the overview; "пока путаюсь" answers go to the next lesson's panel; future assistant drafts take them into account. Skipping a survey affects nothing |

## Composite screens

- **Student card** — everything about the child: profile, lesson history, homework and results, vocabulary, progress, payments, notes, reports, schedule slots.
- **Overview** — a summary of everyone: upcoming lessons (schedule and homework status), "Требует внимания" (missing homework, skill drops, a balance of one lesson or less, homework not published after a lesson, a textbook not parsed), the student table (units, homework rate, skills, status, balance).
- **Lesson stage and panel** — plan stages, unit materials, homework results, notes and topics from the previous lesson, interests (a hint on the panel).
- **Student link** — only the current homework, the vocabulary, an active assessment, the mascot and points. Past homework and reviewed mistakes are **not** shown. Later: the lesson stage and the schedule.
- **Parent link** — the dashboard (skills, homework rate, units, vocabulary) and sent reports. Payments only if the teacher put them into a report.

## Integrity rules

- **One source for each kind of data** (see the first table). Derived values — balance, homework rate, textbook progress, word retention — are computed from source records, never stored by hand.
- **History of changes** for everything shown over time: CEFR level, skills, current unit, lesson price (so past charges are never recomputed at a new price).
- **Published things do not change afterwards.** A submitted homework keeps the tasks the student answered; a sent report is a snapshot from the moment of sending.
- **Soft deletion.** Students, lessons and library materials are never physically deleted while history refers to them.
- **The assistant makes drafts only.** Publishing and changes to the card (for example, gaps) happen only after the teacher confirms.
- **Visibility.** A student sees only their own published data; a parent sees the dashboard and sent reports; notes, gaps, payments, contacts and the last name are the teacher's only.
- **The assistant sees all of the teacher's notes**; there is no "private" flag.
- **Groups.** Lesson, schedule, plan, materials and **homework are one per group** (the children are of about one level); board words and the lesson's vocabulary go to **every** student of the group; answers, vocabulary, assessments, payments and reports are each child's own.

## Confirmed decisions

Agreed with the product owner on 2026-11-11 and 2026-11-12.

1. **Current unit** is a field on the card; it moves to the next unit with "Юнит пройден" in the finish-lesson form and can be changed by hand.
2. **Gaps** are kept by the teacher by hand. Suggestions from repeated mistakes are P3 and optional.
3. **A moved lesson** moves the homework deadline with it. **A cancelled lesson** moves the homework to the next lesson.
4. **Unsubmitted homework** closes when new homework is published and is marked "не сдана" (it counts in the dashboard). P3: an option to keep it open for practice.
5. **Vocabulary**: the unit's words are added **after the lesson** where they were covered, through the finish-lesson form.
6. **A skill drop** is 5 percentage points or more since the previous assessment; the threshold is a setting.
7. **Reports** cover the period from one assessment to the next. Assessments are monthly from each student's start date.
8. **Notes**: the assistant sees all of them.
9. **The introductory meeting** (parent and child, level check, the method explained) is free and part of enrolment. **A trial lesson** (30–60 minutes) is free and optional. Lessons therefore need a type and a "free" flag.
10. **A student** sees neither past homework nor reviewed mistakes, only the current ones.
11. **Groups**: one homework per group; board words go to every student of the group.
12. **Links** are issued when the student is created, keep working "На паузе", stop working on "Завершили", and are issued anew when the student comes back (#19–#21). This replaces the earlier idea of activating links only at "Занимается".
13. **Last name**: optional, stored, teacher only (#18; architecture decision 6 changes in that pull request).
14. **Homework** can be withdrawn before it is submitted; after submission mistakes in the key are fixed by re-marking in "Проверка домашек" (#32, #36).
15. **Each homework task** may carry a source (a textbook reference, or the teacher's own task) and a topic and skill, so mistakes can be grouped for the gaps list and the dashboard (#32).
