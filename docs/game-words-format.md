# Game words format, version 1

How a game in the library gets a student's words (#282). A game marked «Со словами словаря» is a template: one game for every student, with no words of its own. When it opens, the platform posts the words of one student to its frame:

- in a lesson, on the teacher's screen and on the stage of the lesson mode: the lesson's student;
- in «Библиотека» with no lesson going on: the student the teacher picks in «Слова ученика»;
- on the student's page, for a game the teacher opened to them: their own words.

A game without the mark gets no words. Games have no network, so the words come only as this message. The example below is synthetic.

## Message

The platform calls `postMessage(message, "*")` on the game's window, once the words are loaded and again when the frame has loaded. When the teacher picks another student, the game gets a new message with that student's words. The game replaces the words it shows with the latest message. The message is an object:

| Field | Meaning |
|-------|---------|
| `type` | Always `"studysoft.words"` |
| `version` | Always `1` for this format |
| `words` | 0 to 300 words, the newest first |

Every word:

| Field | Required | Meaning |
|-------|----------|---------|
| `word` | yes | The word or phrase in English, as in the student's vocabulary |
| `translation` | yes | Its confirmed translation |
| `example` | no | A confirmed sentence that uses the word |

Only words with a confirmed translation are sent. A game that starts listening late can ask for the words again with `window.parent.postMessage({ type: "studysoft.words-request" }, "*")`.

## Example

```js
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "studysoft.words") return;
  // event.data.words: [{ word: "teapot", translation: "чайник", example: "The teapot is hot." }, ...]
  startRound(event.data.words);
});
window.parent.postMessage({ type: "studysoft.words-request" }, "*");
```

A game template reports the student's answers in the [game result format](game-result-format.md), as any game does. In version 2 each answer may name its `word`: a word the student got wrong then comes back in their word training (#285).

## Versions

A change that an older game would not read gets a new `version`.
