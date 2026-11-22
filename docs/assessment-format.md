# Assessment format, version 1

How the monthly skills assessment is written as JSON for the platform: pasted by the teacher in «Импортировать замер» on the student card (#252), or saved by the assistant through MCP as a draft «от ассистента» (#313). The platform validates every assessment against this format and refuses one that does not match, naming the section, the question and the field.

The assistant drafts the month's assessment from the student context's `assessmentPeriod`: the period since the student's last approved assessment (the last 30 days without one), the textbook units of the lessons held in it, and the words added to the vocabulary in it, with their ids for `vocabularyWord`; the material is at the student's `level`. Saving again replaces the assistant's draft while the teacher has done nothing to it; once she has removed a question or uploaded the recording or the picture, the next save makes a new draft and keeps hers. Only the teacher uploads the recording and the picture, and approves.

Once a month about half a lesson goes to the assessment: the same form every month, with new material at the student's level, so the months compare. Content lives in the platform's database, never in this repository. The example below is synthetic.

## Assessment

| Field | Required | Meaning |
|-------|----------|---------|
| `version` | yes | Always `1` for this format |
| `title` | yes | What the teacher sees on the card, up to 200 characters |
| `sections` | yes | 1 to 6 sections, each skill at most once |

The platform keeps and shows the sections in this order, whatever their order in the JSON; a section may be absent:

| `skill` | Section | Task | Checked |
|---------|---------|------|---------|
| `listening` | «Аудирование» | The teacher's own recording, up to 5 questions with a choice of 3 or 4 | automatically |
| `reading` | «Чтение» | A text of 80–250 words (the form asks 120–200), up to 5 questions: true / false / not given, or a choice | automatically |
| `grammar` | «Грамматика» | A text with up to 6 gaps, each a choice of forms | automatically |
| `vocabulary` | «Лексика» | Up to 10 words from the student's vocabulary: the word for a translation, or the word in a sentence | automatically |
| `writing` | «Письмо» | A note or a letter of 30–60 words on a topic | by the teacher |
| `speaking` | «Говорение» | A picture and up to 5 questions, 2–3 minutes live | by the teacher |

The form's counts — 5 questions, 6 gaps, 10 words — are what an assessment should have; the format holds them as upper limits, so a draft stays valid when the teacher removes a question (product owner, 2026-11-22).

Every section may carry `prompt`, its instruction to the child, up to 500 characters. Every question, option and statement is at most 500 characters.

## Sections

Answer keys never reach the child: the platform checks on the server, and the card shows the assessment as the child will see it. Typed answers are compared as in homework, ignoring case, extra spaces and the kind of apostrophe.

### `listening`

| Field | Meaning |
|-------|---------|
| `questions` | 1 to 5 questions: `{ "question": "…", "options": ["…", "…", "…"], "answer": 0 }` — 3 or 4 options, `answer` the index of the right one, from 0 |

The recording is not in the JSON: the teacher records or finds it and uploads it on the card (MP3, M4A, WAV or OGG, at most 10 MB, as a homework task's recording). An assessment with this section cannot be approved without it.

### `reading`

| Field | Meaning |
|-------|---------|
| `text` | The text to read: 80 to 250 words, at most 2000 characters |
| `questions` | 1 to 5 questions, each one of the two below |

- `{ "type": "true_false", "statement": "…", "answer": "true" }` — `answer` is `true`, `false` or `not_given`; the child chooses «Верно», «Неверно» or «Не сказано».
- `{ "type": "choice", "question": "…", "options": ["…", "…", "…"], "answer": 1 }` — as in `listening`.

### `grammar`

| Field | Meaning |
|-------|---------|
| `text` | The text with gaps, each written as `___` (three underscores), at most 2000 characters |
| `gaps` | One entry per gap, in order: `{ "options": ["go", "went", "gone"], "answer": 1 }` — 2 to 4 forms, `answer` the index of the right one. At most 6 |

### `vocabulary`

| Field | Meaning |
|-------|---------|
| `questions` | 1 to 10 questions, each one of the two below |

- `{ "type": "translation", "translation": "…", "answers": ["…"] }` — the child writes the word for the translation.
- `{ "type": "sentence", "text": "…", "answers": ["…"] }` — a sentence with one gap `___`; the child writes the word.

`answers` lists every accepted variant. A question may name the word of the student's vocabulary it asks in `vocabularyWord`, the word's id (as `list_student_words` or `assessmentPeriod` give it to the assistant): a mistake in it will bring the word back into the training (#253). An id that is not one of the student's words is dropped on import, and the question stays.

### `writing`

| Field | Meaning |
|-------|---------|
| `task` | The task, its topic and length included, at most 1000 characters |

### `speaking`

| Field | Meaning |
|-------|---------|
| `questions` | 1 to 5 questions, as text |

The picture is not in the JSON: the teacher uploads it on the card (PNG, JPEG or WebP, at most 2 MB). It is optional.

## On the card

The draft shows by section, as the child will see it. The teacher may remove a question of «Аудирование», «Чтение», «Лексика» or «Говорение» («Убрать»); a section left without questions goes, and the last question of an assessment stays. The grammar text and the writing task stay whole. «Утвердить» fixes the assessment: nothing changes after it.

## Example

```json
{
  "version": 1,
  "title": "Замер · ноябрь",
  "sections": [
    {
      "skill": "listening",
      "prompt": "Listen and choose.",
      "questions": [{ "question": "Where does the demo bus go?", "options": ["to the lake", "to the hill", "to the farm"], "answer": 2 }]
    },
    {
      "skill": "reading",
      "text": "Day 1: the demo robot Pim walks to the blue box … (80–250 words)",
      "questions": [
        { "type": "true_false", "statement": "Pim is a robot.", "answer": "true" },
        { "type": "choice", "question": "What colour is the box?", "options": ["red", "blue", "green"], "answer": 1 }
      ]
    },
    { "skill": "grammar", "text": "Yesterday Pim ___ to the box.", "gaps": [{ "options": ["walk", "walked", "walks"], "answer": 1 }] },
    {
      "skill": "vocabulary",
      "questions": [
        { "type": "translation", "translation": "камешек", "answers": ["pebble"] },
        { "type": "sentence", "text": "Pim keeps the stones in a ___.", "answers": ["crate", "box"] }
      ]
    },
    { "skill": "writing", "task": "Write a note to Pim about your weekend (30–60 words)." },
    { "skill": "speaking", "questions": ["What can you see in the picture?", "What is the robot doing?"] }
  ]
}
```
