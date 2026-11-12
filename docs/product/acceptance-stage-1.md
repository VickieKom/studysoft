# Stage 1 acceptance

How the work is staged, and the behaviour by which the product owner accepts stage 1. Each statement below is broken into slices with their own acceptance scenarios in the issues; this list is the yardstick for the whole stage.

## Stages

The product owner's approach: first build **the whole structure** — every section in a basic form — then polish one section at a time. If something has to be cut, the priorities below decide.

**Stage 1 (P1) — the core for individual lessons:**

- teacher sign-in; several teachers in the data model;
- students: cards, statuses, contacts, notes, payments, lesson history;
- schedule: the platform's own calendar, recurring slots, two time zones, the meeting link;
- library: uploading a textbook, automatic splitting of the PDF into units, audio, games (HTML), warm-ups, videos;
- lesson mode: **two windows — the stage for sharing and the teacher's control panel**, synchronised in one browser, a board, after-lesson actions;
- homework: drafting from the textbook with the assistant, an editor, the student's permanent link, doing it on a phone, automatic checking, the review section, results in the lesson mode.

**Stage 2 (P2) — progress and parents:**

- the student's vocabulary;
- assessments, the student dashboard, the teacher overview;
- reports to parents (web page, PDF, email) and the parent link's content;
- assistant draft of the lesson plan; board snapshots.

**Stage 3 (P3) — engagement and growth:**

- mascots and characters, personalised tasks;
- game elements in homework, cards in the vocabulary;
- messenger notifications and reminders;
- **the lesson stage behind the student link** (real-time sync through the server; the video call carries only video and voice), a shared board, the group interface;
- schedule access and booking for students and parents;
- accounts for other teachers.

**Not planned:** built-in video calls. The external video-call service stays.

## Stage 1 is done when

1. The teacher creates a student and sets their textbook and unit 3. When the lesson opens, the stage shows the pages of unit 3 at once and the panel lists its audio tracks, without paging through the PDF.
2. "Начать урок" opens two windows, the stage and the panel. The teacher shares only the stage window in the video call; it has no plan, notes or platform elements.
3. A click on a material on the panel changes the stage instantly (within 0.5 s), without a reload.
4. If the stage window is closed by accident and opened again, the board and the current material come back.
5. The student hears an audio track in the video call. Tab or window sharing is decided by the spike #7.
6. After the lesson, within one minute: the lesson is marked as held, a note is written, homework is published, and the payment balance is updated.
7. Within ten minutes the teacher gets homework for a unit from the assistant, edits it and publishes it.
8. The student opens their permanent link on a phone, from the students' country, without a VPN and without registration, does the homework and sees the final screen with the score.
9. The teacher sees the results in "Проверка домашек" and in the lesson mode, with the mistakes highlighted.
