# Game result format, version 2

How a game in the library tells the platform what the student answered (#119). A game runs in a sandboxed frame on the student's page; when the student finishes a round, the game posts one message to the platform's window. The platform checks the message against this format and keeps the answers; their mistakes join the student's mistakes from homework, by topic, on the student card and in the student context the assistant reads.

A game that does not post a result keeps working, with no result. A message not in this format is ignored. A result is kept in two cases:

- the student plays by their own link a game the teacher opened to them, during the lesson and the hour after it (#119); a result from a game not opened to this student or whose access has ended is ignored;
- the teacher runs the game herself on her page in «Библиотека» while a lesson is going on: the result goes to the student of that lesson, or to the one she picks when several lessons are going on (#147). Without a lesson going on, nothing is kept.

Content lives in the platform's database, never in this repository. The example below is synthetic.

## Message

The game calls `window.parent.postMessage(result, "*")` with an object:

| Field | Required | Meaning |
|-------|----------|---------|
| `type` | yes | Always `"studysoft.game-result"` |
| `version` | yes | `2` for this format; a message of version `1`, without `word`, is still accepted |
| `answers` | yes | 1 to 100 answers, in the order the student gave them |

The target origin is `"*"` because the game's frame has an origin of its own and does not know the platform's address. The platform takes the message only from the frame of the game it shows.

## Every answer

| Field | Required | Meaning |
|-------|----------|---------|
| `task` | yes | What the student was asked, as the game showed it; at most 500 characters |
| `answer` | yes | What the student answered, as text; an empty string when they gave none; at most 500 characters |
| `correct` | yes | `true` or `false`: the game checks the answer itself |
| `topic` | no | Free text, as `topic` in the [homework format](homework-format.md), for example "animals"; at most 100 characters. The same topic in a game and in homework is one topic in the list of mistakes |
| `skill` | no | `grammar`, `vocabulary`, `reading`, `writing`, `speaking` or `listening` |
| `word` | no | For a game template, which gets the student's words in the [game words format](game-words-format.md) (#285): the `word` the answer was about, as the platform sent it; at most 200 characters. A wrong answer brings that word back into the student's word training, due tomorrow, and counts towards «часто ошибается»; a right one moves nothing. A word not in the student's vocabulary, or a game without the mark «Со словами словаря», changes nothing |

No other field is allowed. A game may post a result after every round, and each one counts its mistakes in the word training; when the student plays a game several times in one lesson, the latest result counts and the earlier ones are kept but not counted.

## Example

```js
window.parent.postMessage(
  {
    type: "studysoft.game-result",
    version: 2,
    answers: [
      { task: "Which one is a colour?", answer: "red", correct: true, topic: "colours", skill: "vocabulary" },
      { task: "Which one is an animal?", answer: "a table", correct: false, topic: "animals", skill: "vocabulary" },
      { task: "What is «чайник»?", answer: "cup", correct: false, skill: "vocabulary", word: "teapot" },
    ],
  },
  "*",
);
```

## Versions

A change that an older game's message would not pass gets a new `version`. The platform keeps accepting every version it has published, so a game made once keeps reporting.

- Version 1 (#119): the fields above without `word`.
- Version 2 (#285): `word` on an answer.
