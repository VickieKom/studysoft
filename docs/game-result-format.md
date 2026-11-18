# Game result format, version 1

How a game in the library tells the platform what the student answered (#119). A game runs in a sandboxed frame on the student's page; when the student finishes a round, the game posts one message to the platform's window. The platform checks the message against this format and keeps the answers; their mistakes join the student's mistakes from homework, by topic, on the student card and in the student context the assistant reads.

A game that does not post a result keeps working, with no result. A message not in this format is ignored, and so is a result from a game the teacher has not opened to this student or whose access has ended: a result counts only while the student plays by their own link, during the lesson and the hour after it. When the teacher shows a game herself, nothing is kept.

Content lives in the platform's database, never in this repository. The example below is synthetic.

## Message

The game calls `window.parent.postMessage(result, "*")` with an object:

| Field | Required | Meaning |
|-------|----------|---------|
| `type` | yes | Always `"studysoft.game-result"` |
| `version` | yes | Always `1` for this format |
| `answers` | yes | 1 to 100 answers, in the order the student gave them |

The target origin is `"*"` because the game's frame has an origin of its own and does not know the platform's address. The platform takes the message only from the frame of the game it opened.

## Every answer

| Field | Required | Meaning |
|-------|----------|---------|
| `task` | yes | What the student was asked, as the game showed it; at most 500 characters |
| `answer` | yes | What the student answered, as text; an empty string when they gave none; at most 500 characters |
| `correct` | yes | `true` or `false`: the game checks the answer itself |
| `topic` | no | Free text, as `topic` in the [homework format](homework-format.md), for example "animals"; at most 100 characters. The same topic in a game and in homework is one topic in the list of mistakes |
| `skill` | no | `grammar`, `vocabulary`, `reading`, `writing`, `speaking` or `listening` |

No other field is allowed. A game may post a result after every round; when the student plays a game several times in one lesson, the latest result counts and the earlier ones are kept but not counted.

## Example

```js
window.parent.postMessage(
  {
    type: "studysoft.game-result",
    version: 1,
    answers: [
      { task: "Which one is a colour?", answer: "red", correct: true, topic: "colours", skill: "vocabulary" },
      { task: "Which one is an animal?", answer: "a table", correct: false, topic: "animals", skill: "vocabulary" },
    ],
  },
  "*",
);
```

## Versions

A change that an older game's message would not pass gets a new `version`. The platform keeps accepting every version it has published, so a game made once keeps reporting.
