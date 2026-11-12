# Design reference

The visual language and the screens, described in text. The screens are a **starting point, not a final interface**: they show the overall style, the set of sections and how the sections connect. The product owner polishes each section as it is built; elements may be removed, added or moved. Follow the functions and meaning in [Modules](modules.md), not the pixels.

The mock-up images and the interactive design kit are kept by the product owner and are not in this repository: the repository allows raster images only under `app/public/`, and the mock-ups contain example student names. The design tokens themselves live in code, in `app/src/styles/tokens.css`; that file is the source of truth for colours and sizes.

## Visual language

A clean, minimal interface on a white background, never crowded. The main accent is a calm green in several shades; text is dark grey; backgrounds and borders are light grey.

**Colours (tokens):**

| Token | Hex | Used for |
|-------|-----|----------|
| `bg` | #FFFFFF | page background, cards |
| `surface` | #F6F7F5 | underlays, the side menu, the area behind cards |
| `border` | #E3E7E2 | card and field borders, dividers |
| `text` | #232825 | main text |
| `text-secondary` | #5F6762 | captions, secondary text |
| `text-muted` | #9AA19C | disabled elements and decoration only, never readable text |
| `green-50` | #EEF6F0 | active menu item, soft badges |
| `green-100` | #D7EBDD | progress track, highlights, avatar |
| `green-300` | #8BC3A0 | secondary chart series |
| `green-500` | #4A9A6C | progress fill, icons, charts |
| `green-600` | #2F7A52 | **primary buttons, links, active tabs** |
| `green-700` | #25613F | hover and pressed states, text on `green-50` |
| `green-900` | #173D29 | dark accents |
| `warning` / `warning-bg` | #8F6516 / #FBF3E2 | warnings: debt, homework not submitted |
| `danger` / `danger-bg` | #B9473D / #FBECEA | errors, a skill drop |
| `on-accent` | #FFFFFF | text on `green-600` / `green-700` |

Every text/background pair has a contrast of at least 4.5:1, except `text-muted`, which is for disabled elements only.

**Type:** Manrope with Cyrillic, served from the platform's own domain, never from a third-party font service. Styles (size/line height): h1 28/36, h2 22/30, h3 18/26, body 15/22, small 13/18, caption 12/16, button 14/20 weight 600. On the student's phone: task title 22/30, answer options 17/24.

**Shapes and spacing:** radius 8 px for buttons and fields, 12 px for cards, 20 px for student task cards, 999 px for badges and progress bars. Spacing in multiples of 4 px (4, 8, 12, 16, 24, 32). Cards are separated by a thin border; only dropdown menus have a shadow.

**Icons:** line icons, 1.5–2 px stroke, 16–20 px, from the Lucide set. No emoji in the teacher's interface.

**Principles:**

- plenty of air, one main (green) accent per screen;
- statuses are soft coloured badges with text, never colour alone;
- the teacher's interface is denser and more informative; the student's homework is larger, softer and playful, in the same palette;
- the student's accent colour follows their favourite colour theme ([Modules](modules.md), personalisation); green is the default;
- buttons and fields are at least 40 px high, 44 px on student screens (finger targets).

**The board** has its own look — a dark school chalkboard with chalk colours — described in [Modules](modules.md), lesson mode.

## Screens

**Common to the teacher's screens:** a menu on the left — "Общий экран", "Ученики", "Расписание", "Библиотека", "Проверка домашек" (with a counter), "Отчёты" — with the teacher's profile and time zone at the bottom. A light grey page background with white bordered cards, one green accent per screen.

**Common to the student's screens (phone):** large raised buttons, progress at the top, a mascot guiding through the tasks — playful, with an original character, in the platform's palette.

### Teacher overview

- A greeting, the date, the main actions "Начать урок" and "Новый ученик".
- **Upcoming lessons**: time in both time zones, textbook and unit, homework status, "Открыть урок".
- **Требует внимания**: missing homework, skill drops, payments running out.
- **Students** table: textbook and unit progress, homework rate, skills over the month (growth or drop), status, payment; a status filter.

### Student card

- Header: name, status, CEFR level, age, school year, time zone; buttons "Ссылка ученика", "Ссылка родителя", "Начать урок".
- Tabs: "Обзор", "История уроков", "Домашки", "Словарь", "Прогресс", "Оплаты", "Заметки".
- **Textbook and track**: unit progress, what to strengthen, results of the introductory lesson.
- **Recent lessons**: date, unit, note, status (held, moved).
- **Notes**: a field for a new note and a dated feed showing what each note is attached to.
- On the right: interests and "what works", the mascot (chosen later), the schedule, payments (balance, lesson price, last payment), contacts (optional fields).

### Schedule

- A week with navigation; "День / Неделя / Список" views; "+ Урок".
- The teacher's time with the student's time below it.
- Distinct lesson styles: regular, today, held, moved (dashed), introductory (green dashed).
- **Selected lesson**: textbook, homework, meeting link; "Открыть урок", "Отправить ссылку ученику", "Перенести", "Отменить".
- The students' recurring slots.

### Library

- A type filter: textbooks, games, warm-ups, videos, characters; "Загрузить".
- **Textbooks**: the file set and the parsing status ("Разобран" / "Проверь разбор"), and which students use it.
- **Games and exercises** (HTML), **warm-ups**, **videos with tasks**: cards with tags.
- On the right, **the textbook structure** found in the PDF: units, student's book and workbook pages, audio tracks, the vocabulary words (which will go to students' vocabularies).

### Homework review

- On the left, a list: waiting for review, not submitted, reviewed.
- On the right, the selected homework: the automatic result, open answers, voice answers; "Открыть в режиме урока".
- Mistakes show the student's answer and the correct one.
- An open answer shows the student's text and a comment for the lesson.
- A voice answer has a player.
- "Отметить проверенной".

### Reports to parents

- On the left, students with the status of this month's report (draft ready / waiting for the assessment) and earlier reports.
- On the right, the report editor: skills with percentages and the change since last month; "Что получается" and "Над чем работаем" as an editable assistant draft; voice "then → now"; a tick "добавить статус оплат".
- A warning if the parent's email is missing.
- "Предпросмотр PDF", "Скопировать ссылку родителя", "Отправить родителю".

### Lesson mode

Two windows side by side on a laptop screen, as in presenter mode.

- **The stage** (left, shared in the call): two columns. Lesson materials take the larger part and scroll on their own, with stage tabs on top ("Разминка › Домашка › Student's Book › Игра"; done stages ticked, the current one highlighted). The board is narrower and fixed: a dark grey chalkboard with a frame and a chalk tray, large readable chalk writing in white, yellow, pink and mint, pictures as taped stickers in calm palette colours, the homework framed in chalk at the bottom, tools in a small corner panel. No notes, plan or platform elements.
- **The control panel** (right, teacher only): student, unit, timer, "Завершить"; the plan with minutes whose stages are the stage tabs, with controls under the current stage (pages, spread, track); "Дополнительно под вкладкой" (video, picture, track, "+ из библиотеки"); board actions (sticker, new sheet, snapshot); "Слова с доски → в словарь"; an indicator that the stage is connected.
- On the homework stage the stage shows the score ("8 из 10"), "Только ошибки / Все задания", the child's answers with mistakes highlighted and the right answer behind "Показать ответ", marked open answers and voice answers.

### Student homework on a phone

- **Topic path**: a greeting (points come later), the current unit card with the deadline ("Домашка к четвергу"), a path of circles — done (tick), current ("Начать"), locked — with the mascot beside it. A bottom menu: "Домашка" and "Словарь".
- **Choose an answer**: close, a progress bar and "4/10" at the top; the mascot "says" a sentence with a gap in a speech bubble; answer options as large 2×2 buttons, the chosen one highlighted; at the bottom "Ответы проверим вместе на уроке" and "Дальше". Correctness is not shown straight away.
- **Build a sentence**: the mascot gives a phrase in Russian; tapping word tiles puts them into the answer line, used tiles leave empty spaces; "Дальше" and "Очистить".
- **Done**: the mascot celebrates, "Домашка готова!" with the child's name; the result (how many right, time, points later); "Ошибки разберём вместе на уроке".
- **The same screen in a favourite colour**: only the accents change — the button, progress, the selected option, an underline, the mascot's collar. Background, text and grey borders stay.

### Student homework on a computer

The same link and the same homework, just a wider screen in the same style.

- **Homework home**: a menu on the left ("Домашка", "Словарь"); the unit card and topic path with the mascot in the centre; on the right, cards "Домашка к уроку" (number of tasks, minutes, "Начать"), the unit's new words linking to the vocabulary, points (later).
- **Match pairs**: the task centred, not stretched; a progress bar on top; two columns of tiles (English words and translations); the selected tile is highlighted and matched pairs fade; keys 1–8 select tiles; a full-width bottom bar with "Пропустить", a hint and "Дальше".

### Weekly survey (phone)

It appears behind the student link right after the last lesson of the week; 3–4 questions asked by the mascot.

- **"Что было веселее?"**: the mascot asks for help choosing games, so the child never rates the teacher; two task cards with a reminder picture and the day of the lesson; neutral options "Обе классные" and "Обе так себе"; the caption "Тут нет правильных ответов"; pink progress segments, unlike the green homework progress; "Дальше" and "Пропустить".
- **"Понятно ли правило?"**: the rule shown as it was on the board, with the lesson days; three self-assessment options with faces — "Могу объяснить другу / Почти понял / Пока путаюсь"; the mascot admits it gets confused too, so an honest answer is not embarrassing.

### Not designed yet

- Tasks with voice recording and file upload (creative tasks).
- The student's vocabulary.
- The parent page: dashboard and report.
- Choosing a mascot.
