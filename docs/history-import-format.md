# History import format

How the results history from the teacher's old tool is written for the platform (#38). The teacher uploads the file once on «Ученики», under «История из прошлого инструмента». The old tool's sheets are not in this format; reshaping them is a one-time step outside the platform. The platform keeps what it imports, never the file.

The example below is synthetic.

## The file

CSV in UTF-8, comma-separated, with a header row. A field with a comma, a quote or a line break is written in double quotes, with a quote inside doubled (`""`). The columns may come in any order; all ten must be there. At most 5 MB.

One row per answer:

| Column | Required | Meaning |
|--------|----------|---------|
| `student` | yes | The student's name as written in the old tool: «Имя Фамилия», «Имя Ф.» or «Имя» alone when one student has that first name. Case and extra spaces do not matter |
| `submitted_on` | yes | Date of the submission, `YYYY-MM-DD` |
| `homework` | yes | Homework title, up to 200 characters, for example "WB 0.4" |
| `task` | yes | Task number within the homework, from 1 to 200 |
| `type` | yes | One of the task types of the [homework format](homework-format.md), or `unknown` |
| `question` | yes | Task text, may be shortened |
| `answer` | no | The student's answer; empty if not answered |
| `correct_answer` | no | The key; empty for open tasks |
| `result` | no | `correct`, `wrong`, or empty when it was not checked |
| `topic` | no | Topic, as in the homework format |

Every text field is at most 5000 characters.

## What becomes of it

- The rows with the same `student`, `submitted_on` and `homework` make one past submission. Its score is counted from `result`: right, wrong, and not checked.
- A past submission shows on the student card under «Прошлые сдачи» and in «Проверка домашек» with «импорт». It is for reading only: it never waits for review and cannot be marked or reopened.
- A submission that is already there, the same student, date and title, is left as it is: uploading the same file again adds nothing.
- A row that cannot be imported is skipped and named in the summary by its line: an unknown or ambiguous student, a date that does not exist, a wrong task number, type or result, a task number repeated within one homework. The other rows are imported.

## Example

```csv
student,submitted_on,homework,task,type,question,answer,correct_answer,result,topic
Тестовый Т.,2026-11-03,Demo 1,1,single_choice,Pick the colour of the sky,blue,blue,correct,colours
Тестовый Т.,2026-11-03,Demo 1,2,gap,I ___ a student.,is,am,wrong,to be
Тестовый Т.,2026-11-03,Demo 1,3,written,Write two sentences about your day,I wake up at seven. I go to school.,,,writing
```
