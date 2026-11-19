# Homework format, version 1

How a homework is written as JSON for the platform: pasted by the teacher in "Импортировать домашку" (#32), saved by the assistant through MCP (#43), and used by the library export. The platform validates every homework against this format and refuses one that does not match, naming the task and the field.

Content lives in the platform's database, never in this repository. The example below is synthetic.

Keep `prompt` to the instruction itself. A workbook exercise is carried over whole: its instruction in `prompt`, its reading text in `passage`, its example in `example`, its items in the task's own fields.

## Homework

| Field | Required | Meaning |
|-------|----------|---------|
| `version` | yes | Always `1` for this format |
| `title` | yes | What the teacher sees in lists, for example "Workbook 0.4 + своё" |
| `tasks` | yes | 1 to 50 tasks, in the order the student does them |

## Every task

| Field | Required | Meaning |
|-------|----------|---------|
| `type` | yes | One of the types below |
| `prompt` | yes | The instruction the student reads. A line break (`\n`) is shown as a new line |
| `topic` | no | Free text, for grouping mistakes and gaps, for example "Present Simple" |
| `skill` | no | `grammar`, `vocabulary`, `reading`, `writing`, `speaking` or `listening` |
| `source` | no | Where the task comes from: `{ "book": "Workbook", "unit": "0", "page": "6", "exercise": "2" }` (every key optional except `book`), or the string `"own"` for the teacher's own task |
| `passage` | no | A reading text of its own — a passage, a blog post, a dialogue, notes — up to 5000 characters. Shown below the instruction in regular type, with its line breaks. Tasks that share one text each carry it, and the student sees it above each of them (#131) |
| `example` | no | The exercise's example: `{ "text": "0 She ___ a teacher.", "answer": "is" }`. Shown marked as an example, with `answer` in place of `___` (or after the text when there is no gap); it has no field and is never checked or counted (#131) |
| `image` | no | A picture next to the task, as a data URL: `data:image/png;base64,…`. PNG, JPEG or WebP, at most 2 MB. One picture per task. The platform keeps the file and serves it only to the teacher and to the student whose published homework it is (#33) |

## Task types

Answer keys never reach the student before submission: the platform checks on the server. Where a task has a key, it may list several correct variants. Typed answers are compared ignoring case, extra spaces and the kind of apostrophe (#34).

### `single_choice`

One correct option.

| Field | Meaning |
|-------|---------|
| `options` | 2 to 8 strings |
| `answer` | The index of the correct option, from 0 |

### `multiple_choice`

Several correct options; the student marks all of them.

| Field | Meaning |
|-------|---------|
| `options` | 2 to 8 strings |
| `answers` | Indexes of every correct option, from 0; at least one |

### `gap`

A text with one or more gaps, each written as `___` (three underscores).

| Field | Meaning |
|-------|---------|
| `text` | The text with gaps. A line break (`\n`) is shown as a new line, so a workbook's one sentence per line stays that way |
| `answers` | One list per gap, in order: the accepted variants for that gap |
| `options` | Optional: words to choose from. Without it the student types |
| `choices` | Optional: each gap's own options, as in "circle the correct word" (#128) — one entry per gap, in order: a list of 2 to 6 options, or `null` for a gap the student types. Every accepted answer of a gap with options must be one of them. Not together with `options` |

### `match`

Pairs to connect; shown shuffled.

| Field | Meaning |
|-------|---------|
| `pairs` | 2 to 10 objects `{ "left": "…", "right": "…" }`, each a correct pair |

### `order`

Words to put in order; shown shuffled.

| Field | Meaning |
|-------|---------|
| `words` | 2 to 20 words in the correct order |
| `alternatives` | Optional: other correct orders, each a full list of the same words |

### `written`

A sentence or a text, up to 5000 characters. Checked by the teacher.

| Field | Meaning |
|-------|---------|
| `hint` | Optional: what a good answer looks like, shown to the student |

### `voice`

A recording made in the browser, up to 5 minutes, stored as recorded (WebM or MP4). Checked by the teacher.

| Field | Meaning |
|-------|---------|
| `hint` | Optional, as in `written` |

### `file`

A photo (JPEG, PNG, WebP) or an audio file (MP3, M4A, WAV, OGG, WebM), up to 10 MB. Checked by the teacher.

| Field | Meaning |
|-------|---------|
| `accept` | Optional: `["image"]`, `["audio"]` or both; both by default |
| `hint` | Optional, as in `written` |

## Example

```json
{
  "version": 1,
  "title": "Demo homework",
  "tasks": [
    {
      "type": "single_choice",
      "prompt": "Pick the colour of the sky.",
      "options": ["green", "blue", "red"],
      "answer": 1,
      "topic": "colours",
      "skill": "vocabulary",
      "source": { "book": "Demo book", "unit": "1", "page": "4", "exercise": "1" }
    },
    {
      "type": "gap",
      "prompt": "Fill in the gaps.",
      "example": { "text": "0 We ___ friends.", "answer": "are" },
      "text": "I ___ a student. She ___ my friend.",
      "answers": [["am", "'m"], ["is", "'s"]],
      "topic": "to be",
      "skill": "grammar",
      "source": "own"
    },
    {
      "type": "written",
      "prompt": "Write two sentences about your day.",
      "hint": "Use the Present Simple.",
      "skill": "writing",
      "source": "own"
    }
  ]
}
```

## Versions

A change that an older homework would not pass gets a new `version`; optional fields added later, such as `choices` (#128), `passage` and `example` (#131), keep the version, since every older homework still passes. The platform keeps accepting every version it has published, so exported homework can always be imported again.
