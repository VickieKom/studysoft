# Modules

Each section of the platform, with its priority. P1 is stage 1, P2 stage 2, P3 stage 3. A module marked P1 can contain P2 or P3 parts; they are marked in place.

## Teacher overview — P2

- Progress of all students: who has a drop in a skill.
- Whose homework completion is falling.
- Progress through the current textbook: units covered.
- Upcoming lessons from the schedule — **this block is P1**.

## Students and groups — P1

**Student card:**

- first name (required) and last name (optional, teacher only); age and school year;
- contacts, all optional: the parent's name, email and messenger handle, the student's email and messenger handle;
- status: "Обсуждение" / "Занимается" / "На паузе" / "Завершили". A finished student is never deleted; "Завершили" is the archive;
- time zone;
- the textbook (from the library) and the current unit;
- CEFR level: A1, A2, B1, B2, C1;
- results of the introductory level check;
- interests and hobbies (free text and tags); which kinds of exercises work for this student;
- an individual track: topics to strengthen, gaps;
- the mascot the child chose and a favourite colour that sets the colour theme of homework and games (P2), both visible in the card header and changed in one click;
- the student link and the parent link, each with "Перевыпустить";
- skill scores from assessments (P2).

**Payments — P1, teacher only:**

- a lesson price per student; prepaid or postpaid;
- payments: date, amount, comment;
- the balance — lessons paid, held, remaining or owed — is computed, never stored;
- a held lesson is charged automatically; a late cancellation follows a configurable rule (for now: cancelled less than 24 hours ahead is charged).

**Lesson history — P1:** a feed of date, unit, status (held, missed, moved, cancelled), note, topics to work on, and the homework status for that lesson. A board snapshot is P2.

**Notes — P1:** free text with a date, always attached either to a student or to a lesson.

**Groups:** in the data model from the start; interface P3.

## Schedule — P1

- The platform's own simple calendar; no external calendar integration at the start.
- Views: week (main), day, a list of upcoming lessons.
- **Recurring slots** per student (for example, Tuesday and Thursday at 17:00), single changes (moving one lesson) and permanent slot changes.
- **Two time zones** on every lesson: the teacher's and the student's (from the card). Time is stored in UTC.
- Moves and cancellations are recorded in the lesson history.
- Every lesson has a field for the video-call meeting link with "Скопировать / отправить ученику".
- From a lesson in the schedule the teacher goes to the lesson mode.
- A reminder 15 minutes before a lesson to teacher and student — P3.
- Schedule access and booking for parents and students — P3.

## Library — P1

**Material types (filter):** textbook, game, warm-up, video, characters.

**A textbook** is the file set of one textbook at one level: the student's book (PDF), the workbook (PDF), the teacher's book (PDF, including answer keys), audio tracks numbered as in the book, video, other files.

**Automatic textbook parsing:**

- After upload the platform finds the structure: units, page ranges per unit, which audio tracks belong to a unit, each unit's vocabulary list, exercises and their keys from the teacher's book.
- The teacher sees the result and corrects it. Building the structure by hand from scratch is not planned, only correction.
- Unit pages are stored as images so that a unit opens instantly in a lesson.
- PDFs can be scans, so text recognition may be needed.
- How well an agent copes with this is unknown; the spike #6 answers it before anything is built on it.

**Games:** self-contained HTML files, uploaded. They open in an isolated frame. The teacher can open one on the stage or send the student a link.

**Warm-ups:** a picture (for example, a mood scale), a list of conversation questions, cards, or a game. Tags: level, topic, age group.

**Videos:** a link or a file, with attached tasks (true/false and similar). The assistant drafts the tasks, the teacher checks them. Grammar explainer videos that the teacher makes elsewhere are uploaded here too.

**Characters — P3:** a set of 3–5 original characters per age group (images and a description), shared by all students.

**File access:** textbook files are for the teacher only, with no public links (copyright). A student sees only what the teacher put into their homework.

## Lesson mode — P1

**The problem:** a video call shares a whole tab or window. If the plan and notes sit on the same page as the content, the student sees everything. So the lesson mode is **two separate windows**.

**Window 1 — the stage ("Экран для ученика"),** shared in the call:

- only what the student should see: content and the board. No notes, plans, payments or platform navigation;
- two columns: lesson materials on the left (about 60–65 %, scrolling on their own) and the board on the right, fixed to the full window height;
- **stage tabs** above the materials follow the lesson plan in order, for example "1 Разминка › 2 Домашка › 3 Student's Book › 4 Игра". Done stages carry a tick, the current one is highlighted. Tabs switch from the panel or by a click on the stage;
- tab contents by stage type:
  - warm-up — a library material: a picture, questions, cards;
  - homework review — the student's score ("8 из 10"), "Только ошибки / Все задания", the tasks with the child's answers; a mistake is highlighted and **the correct answer is hidden behind "Показать ответ"** so the child tries to fix it first; open answers with the teacher's marks; voice answers with a player;
  - textbook — a whole page fitted to the height, paging through the unit's pages ("‹ стр. 30 · 1 из 2 ›"), "1 страница / Разворот", the audio player (visible to the student, driven from the panel);
  - game — the library game in this area, isolated;
  - others as needed: video, picture, task; a stage without material shows the board full screen;
- extra material (a video, a picture) can be shown below the tab; the column scrolls to it;
- it opens as a **separate browser window**, so it can be shared both as a tab and as a window.

**Window 2 — the control panel ("Пульт урока"),** teacher only:

- student, unit, a timer, "Завершить урок";
- the lesson plan with minutes, its stages being the stage tabs: a click switches the tab; under the current stage, its controls (pages, spread, play/pause; for homework "Показать ответ", "Только ошибки"); "Отправить ссылку ученику" for games and videos; "Изменить план" during the lesson;
- "Дополнительно под вкладкой": quickly show a video, picture, track, or add from the library;
- board actions: a picture sticker, a new sheet, a snapshot, board full screen;
- homework mistakes, each with a button to show it on the stage;
- "Слова с доски → в словарь" plus adding a word by hand;
- the lesson note;
- an indicator that the stage is connected.

**Synchronisation in stage 1:** the lesson is one shared **lesson state** — what is on the stage, the page, the layout, the player, the board, highlighted mistakes. The panel changes the state and the stage shows it; drawing on the board writes to the state too. Both windows are in one browser on one computer, so they sync without a server. The state is saved, so a closed stage window reopens without loss.

**Later (stages 2–3):** the same state travels through the server in real time, and the student opens the stage behind their own link; the video call carries only video and voice. This fixes stuttering video, lets the student write on the board and click in games, and is needed for groups. So the state format and the panel logic must not depend on the in-browser transport.

**The board:**

- looks like a school chalkboard: a dark grey background with faint chalk smudges, a frame, a chalk tray below as decoration;
- chalk colours white, yellow, pink and mint with a slight grain and an uneven stroke edge, without losing readability;
- **readability first:** typed text uses a simple print-like handwriting font with Cyrillic, large (22–26 px and up), served from the platform;
- pictures on the board are stickers: a card in a calm palette colour with a strip of "tape", a slight tilt and a shadow; draggable and resizable;
- tools: typed text, freehand drawing and writing (mouse or stylus), picture sticker, chalk colour, sponge (eraser), new sheet, clear. The minimum is freehand writing and text;
- the toolbar is a small translucent pill in a corner;
- a board snapshot in the lesson history is P2; drawing by the student is P3.
- Whether the candidate board library can look like this is checked in the spike #7.

**Lesson materials** come automatically from the student's textbook and unit, plus whatever the teacher adds from the library.

**Lesson plan:** a manual plan is P1; an assistant draft from the unit, gaps and interests is P2.

**Sound and video:** sharing video through the call stutters, so external videos get "отправить ученику ссылку". Whether a track played on the stage is heard depends on how the window is shared; the spike #7 finds out and the platform tells the teacher which way to share.

**After-lesson actions** are one form: mark as held, note, words to vocabulary, publish homework, board snapshot.

## Homework — P1

**Creating:**

- The source is the student's textbook: tasks from the student's book and workbook, keys from the teacher's book. The assistant turns the exercises of the chosen unit or pages into interactive tasks.
- The teacher edits the generated tasks, adds their own and deletes the rest. The teacher's own tasks target a student's gaps or are creative tasks that the textbook does not have; each task records whether it comes from the textbook or is the teacher's own.
- Each task can carry a topic and a skill, so that mistakes can be grouped by topic for the gaps list and the dashboard.
- Exercises from the student's vocabulary can be added (P2).
- Length: 10–15 minutes.
- Until the assistant path exists (#3), homework comes in as a JSON file in the platform's homework format and is edited in the platform (#32, #37).

**Task types (P1):**

- choose one answer / choose several;
- fill the gap, typed or chosen;
- match pairs;
- put words in order;
- write a sentence or text (open answer);
- record voice in the browser;
- attach a file: photo or picture, audio (video is P3).

Tasks can show a picture.

**Publishing:**

- A student has **one permanent link**; it always shows the current homework (and the vocabulary).
- New homework appears only after the teacher publishes it. Until the schedule exists the teacher sets the deadline by hand; later the deadline is the next lesson.
- Publishing new homework closes the previous unsubmitted one as "не сдана".
- Before the student submits, the teacher can withdraw the homework, fix it and publish it again. Published homework itself never changes.

**Doing it (phone first):**

- one task per screen, large buttons, a progress bar;
- **one attempt**: after submitting it cannot be changed;
- answers are saved if the student closes the page and comes back;
- the final screen: praise and "X верно, Y неверно" without saying which. Instant feedback with explanations is an open question; for now the score only;
- a mascot on homework screens — P3.

**Checking:**

- automatic checking against the key for tasks with one right answer, with normalisation (case, extra spaces, apostrophes) and several accepted variants;
- open answers and files are checked by the teacher, who marks them right or wrong and can override an automatic result; the score is recalculated;
- **"Проверка домашек"**: submitted and missing homework; for each — answers, mistakes, files, a comment field;
- the results are available in the lesson mode;
- missing homework is simply marked in the history, without notifications;
- the history of all results is kept for the dashboard and the gaps list, including results imported from the teacher's previous tool (#38).

**Game elements — P3:** points, a path where each homework opens a new topic, rewards.

**Notifications — P3:** a messenger reminder to the student about homework; optionally a notice to the teacher.

## Student vocabulary — P2

- Sources: the unit's vocabulary list from the parsed textbook — **added after the lesson where those words were covered**, not in advance — plus the words the teacher marked on the board.
- Word fields: word, translation, example, pronunciation (speech synthesis or a dictionary service), an optional picture, source (unit or lesson), date, a retention measure.
- The student reaches it behind the same permanent link as homework: a list and a search.
- Practice: cards and assistant-made usage exercises — P3.
- Retention is computed from the exercises where the word appeared; the formula is open (for example, "right N times in a row").

## Assessments — P2

- The starting point is the level check at the introductory meeting, recorded on the card.
- A monthly test drafted by the assistant from the units covered in the month; the teacher edits it.
- Sections by skill: reading (text and questions, automatic), listening (track and questions, automatic), grammar (automatic), vocabulary (automatic), writing (a short text, teacher), speaking (recorded answers to 2–3 questions, teacher; recordings are kept to compare "then / now").
- It takes about half a lesson, behind the student link.
- The result per skill is a percentage; for writing and speaking the teacher enters it.
- A separate CEFR level test, at most every six months, changes the level on the card.

## Student dashboard — P2

- Skill charts over time (percent by month): growth and drops.
- Homework completion rate.
- Textbook progress: units covered out of the total.
- Vocabulary: number of words and the share retained.
- Attendance is not shown.
- The teacher sees all dashboards; a parent sees their child's behind their link. Whether the student sees it is open.

## Reports to parents — P2

- Monthly, after the assessment; the period runs from one assessment to the next.
- The teacher defines the report template (its sections).
- The assistant drafts the text from the data (assessments, homework, units, vocabulary) and the teacher's notes.
- The teacher edits and clicks "Отправить"; nothing is sent automatically.
- Contents: units covered, assessment results, voice "then / now" (a player on the web page), what is going well, what we are working on, and payment status only if the teacher includes it.
- Format: a web page behind the parent link and a PDF emailed to the parent from the platform.
- Every sent report is kept on the card.

## Personalisation — P3 (favourite colour P2)

- Each student has one permanent **mascot**, a guide through homework, games and grammar explanations. The child picks it from a few options; it is stored on the card and appears on every student screen.
- **Favourite colour — P2.** The teacher picks a colour theme on the card. Themes come from a fixed set (green by default, pink, lilac, blue, sunny, red, turquoise), each a shade scale with checked contrast.
  - Recoloured: buttons, progress bar, the selected option, the topic path, accents and backgrounds, mascot details.
  - Never recoloured: the white background, text colour, grey borders, and the right/wrong colours of checking, which are the same for everyone.
  - Applied on every screen behind the student link and in games. The teacher's interface and the parent page always use the platform's green palette.
  - Student screens are built on accent variables from the start; games receive the theme as a parameter.
- In a group every child gets the same homework in their own colour and with their own mascot.
- Additional characters matching the child's interests; a shared set of characters per age group.
- When drafting homework the assistant uses the student's interests and characters (for example, the topic "furniture" becomes tasks about the character's room).
- **Original characters only**, never existing characters from films, cartoons or games.

## Student feedback — P2

**Why:** once a week the teacher sees which tasks and topics work for the child and adjusts the programme. It is a tool for the teacher only.

**Honest answers without awkwardness:**

- The child never rates the teacher or a whole lesson. They choose between concrete tasks and topics and rate themselves ("how well I understood").
- The mascot asks: "Help me pick games for next week!"
- Choice answers always include neutral options ("both great", "both so-so"). Never "what did you not like".
- For younger children, pictures and three faces instead of a 1–10 scale.
- Always skippable; never affects points or homework statistics; the mascot thanks the child.
- Never shown to parents or included in reports.

**Two formats:**

1. **A mini question after homework**, one tap on the "Готово!" screen: "Какое задание было самым интересным?" with thumbnails of the task types in this homework and "все классные".
2. **A weekly survey from the mascot**, about one minute, 3–4 questions, appearing behind the student link right after the last lesson of the week as a card above the homework (shown first if skipped). Every option has a reminder picture and the day of the lesson. Questions are built from the stages of the week's lesson plans; the teacher can adjust or add one:
   - lesson tasks in pairs: "Что было веселее: A или B?" → one of the two / both great / both so-so;
   - topics: "Про что хочется ещё: X или Y?";
   - understanding, as self-assessment: "Правило …: могу объяснить другу / почти понял / пока путаюсь";
   - optionally "А ещё я хочу…" as text or voice.

**What the teacher sees:** a "Фидбэк" tab on the card with the week's summary and an accumulated "what works" rating by task type and topic; "new feedback" on the overview; "пока путаюсь" answers on the next lesson's panel as topics to repeat; "liked by N children" on library items; in a group, each child's answers and a group summary.

**How it is used:** the teacher adjusts the plan, and the "what works" rating feeds the assistant's context for plans and homework. The teacher can edit the "what works" field on the card.

**Settings:** the survey day (default: after the last lesson of the week), on/off per student, the scale type by age.
