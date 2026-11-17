// The results history from the teacher's old tool (#38), uploaded once as a
// CSV in the history import format (docs/history-import-format.md). Each
// student, date and homework title becomes one past submission: read-only
// history on the card and in «Проверка домашек», never waiting for review.
// The file itself is never stored.
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { TASK_TYPES } from "../../domain/homework-format";
import { STATUSES } from "../../domain/student";
import { listStudents } from "../crm/students";
import type { Database } from "../db/client";
import { importedAnswer, importedSubmission, student } from "../db/schema";
import { parseCsv } from "./csv";

export const HISTORY_COLUMNS = [
  "student",
  "submitted_on",
  "homework",
  "task",
  "type",
  "question",
  "answer",
  "correct_answer",
  "result",
  "topic",
] as const;
type Column = (typeof HISTORY_COLUMNS)[number];

/** How many problems the summary names; the rest are counted. */
const MAX_ERRORS = 50;
const MAX_TEXT = 5000;
const MAX_TASK = 200;
const TYPES = new Set<string>([...TASK_TYPES, "unknown"]);
const RESULTS = { correct: true, wrong: false, "": null } as const;

export type HistorySummary = { imported: number; existing: number; errors: string[] };

type Row = {
  line: number;
  studentId: string;
  submittedOn: string;
  title: string;
  taskNumber: number;
  type: string;
  question: string;
  answer: string | null;
  correctAnswer: string | null;
  correct: boolean | null;
  topic: string | null;
};

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");

/**
 * Finds the teacher's student a name from the old tool means: «Имя Фамилия»,
 * «Имя Ф.» or «Имя» alone when one student has that first name; case and
 * extra spaces do not matter (product owner, 2026-11-17).
 */
export function matchStudent(
  name: string,
  students: { id: string; firstName: string; lastName: string | null }[],
): { id: string } | "unknown" | "ambiguous" {
  const wanted = normalize(name);
  const forms = (s: { firstName: string; lastName: string | null }) => {
    const first = normalize(s.firstName);
    const last = normalize(s.lastName ?? "");
    return last ? [`${first} ${last}`, `${first} ${last[0]}.`, `${first} ${last[0]}`] : [first];
  };
  let found = students.filter((s) => forms(s).includes(wanted));
  if (found.length === 0) found = students.filter((s) => normalize(s.firstName) === wanted);
  if (found.length === 0) return "unknown";
  return found.length === 1 ? { id: found[0]!.id } : "ambiguous";
}

/** Whether a YYYY-MM-DD string is a date that exists. */
function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Reads the CSV against this teacher's students: the rows to import and a
 * message for every row that cannot be, naming its line. A wrong header
 * stops the whole file.
 */
export function readHistory(
  text: string,
  students: { id: string; firstName: string; lastName: string | null }[],
): { rows: Row[]; errors: string[] } {
  const [header, ...records] = parseCsv(text);
  const names = header?.fields.map((f) => f.trim()) ?? [];
  const missing = HISTORY_COLUMNS.filter((c) => !names.includes(c));
  if (missing.length > 0) return { rows: [], errors: [`Нет столбцов: ${missing.join(", ")}`] };
  const at = Object.fromEntries(HISTORY_COLUMNS.map((c) => [c, names.indexOf(c)])) as Record<Column, number>;

  const rows: Row[] = [];
  const errors: string[] = [];
  for (const { line, fields } of records) {
    const get = (c: Column) => (fields[at[c]] ?? "").trim();
    const problem = (message: string) => errors.push(`Строка ${line}: ${message}`);
    const name = get("student");
    const matched = matchStudent(name, students);
    if (matched === "unknown") {
      problem(`ученик «${name}» не найден`);
      continue;
    }
    if (matched === "ambiguous") {
      problem(`ученику «${name}» подходят несколько учеников`);
      continue;
    }
    const submittedOn = get("submitted_on");
    if (!realDate(submittedOn)) {
      problem(`дата «${submittedOn}» — нужна существующая дата в виде ГГГГ-ММ-ДД`);
      continue;
    }
    const title = get("homework");
    if (!title || title.length > 200) {
      problem("нужно название домашки, до 200 символов");
      continue;
    }
    const task = get("task");
    const taskNumber = /^\d{1,3}$/.test(task) ? Number(task) : 0;
    if (taskNumber < 1 || taskNumber > MAX_TASK) {
      problem(`номер задания «${task}» — нужно число от 1 до ${MAX_TASK}`);
      continue;
    }
    const type = get("type");
    if (!TYPES.has(type)) {
      problem(`тип задания «${type}» — нужен один из типов формата домашки или unknown`);
      continue;
    }
    const result = get("result");
    if (!(result in RESULTS)) {
      problem(`результат «${result}» — нужно correct, wrong или пусто`);
      continue;
    }
    const question = get("question");
    const texts = [question, get("answer"), get("correct_answer"), get("topic")];
    if (!question || texts.some((t) => t.length > MAX_TEXT)) {
      problem(`нужен текст задания; каждое поле до ${MAX_TEXT} символов`);
      continue;
    }
    rows.push({
      line,
      studentId: matched.id,
      submittedOn,
      title,
      taskNumber,
      type,
      question,
      answer: get("answer") || null,
      correctAnswer: get("correct_answer") || null,
      correct: RESULTS[result as keyof typeof RESULTS],
      topic: get("topic") || null,
    });
  }
  return { rows, errors };
}

/**
 * Imports the history file for this teacher. A submission that is already
 * there (the same student, date and title) is left as it is and counted as
 * existing, so importing the same file again adds nothing; a task number
 * repeated within one submission is reported.
 */
export async function importHistory(db: Database, teacherId: string, text: string): Promise<HistorySummary> {
  const students = await listStudents(db, teacherId, STATUSES);
  const { rows, errors } = readHistory(text, students);

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.studentId, row.submittedOn, row.title]);
    const group = groups.get(key) ?? [];
    if (group.some((r) => r.taskNumber === row.taskNumber)) {
      errors.push(`Строка ${row.line}: задание ${row.taskNumber} уже есть в этой домашке выше`);
      continue;
    }
    group.push(row);
    groups.set(key, group);
  }

  let imported = 0;
  let existing = 0;
  for (const group of groups.values()) {
    const [first] = group;
    if (!first) continue;
    const added = await db.transaction(async (tx) => {
      // The unique key decides: of two uploads at once, one inserts and the other finds it there.
      const [created] = await tx
        .insert(importedSubmission)
        .values({
          teacherId,
          studentId: first.studentId,
          title: first.title,
          submittedOn: first.submittedOn,
          correctCount: group.filter((r) => r.correct === true).length,
          wrongCount: group.filter((r) => r.correct === false).length,
          uncheckedCount: group.filter((r) => r.correct === null).length,
        })
        .onConflictDoNothing()
        .returning({ id: importedSubmission.id });
      if (!created) return false;
      await tx.insert(importedAnswer).values(
        group.map((r) => ({
          submissionId: created.id,
          taskNumber: r.taskNumber,
          type: r.type,
          question: r.question,
          answer: r.answer,
          correctAnswer: r.correctAnswer,
          correct: r.correct,
          topic: r.topic,
        })),
      );
      return true;
    });
    if (added) imported++;
    else existing++;
  }

  const shown = errors.slice(0, MAX_ERRORS);
  if (errors.length > MAX_ERRORS) shown.push(`И ещё ${errors.length - MAX_ERRORS} строк с ошибками`);
  return { imported, existing, errors: shown };
}

export type ImportedSummary = {
  id: string;
  studentId: string;
  studentName: string;
  title: string;
  submittedOn: string;
  correct: number;
  wrong: number;
  unchecked: number;
};

const summaryColumns = {
  id: importedSubmission.id,
  studentId: importedSubmission.studentId,
  studentName: student.firstName,
  title: importedSubmission.title,
  submittedOn: importedSubmission.submittedOn,
  correct: importedSubmission.correctCount,
  wrong: importedSubmission.wrongCount,
  unchecked: importedSubmission.uncheckedCount,
};

/** The imported submissions of this teacher, newest first; optionally one student's. A deleted student's are not shown. */
export async function listImported(db: Database, teacherId: string, studentId: string | null): Promise<ImportedSummary[]> {
  return db
    .select(summaryColumns)
    .from(importedSubmission)
    .innerJoin(student, and(eq(student.id, importedSubmission.studentId), isNull(student.deletedAt)))
    .where(
      and(
        eq(importedSubmission.teacherId, teacherId),
        studentId ? eq(importedSubmission.studentId, studentId) : undefined,
      ),
    )
    .orderBy(desc(importedSubmission.submittedOn), asc(importedSubmission.title));
}

export type ImportedTask = {
  number: number;
  type: string;
  question: string;
  answer: string | null;
  correctAnswer: string | null;
  correct: boolean | null;
  topic: string | null;
};

/** One imported submission of this teacher with its answers in task order, or null. */
export async function findImported(
  db: Database,
  teacherId: string,
  id: string,
): Promise<(ImportedSummary & { tasks: ImportedTask[] }) | null> {
  const [found] = await db
    .select(summaryColumns)
    .from(importedSubmission)
    .innerJoin(student, and(eq(student.id, importedSubmission.studentId), isNull(student.deletedAt)))
    .where(and(eq(importedSubmission.id, id), eq(importedSubmission.teacherId, teacherId)));
  if (!found) return null;
  const tasks = await db
    .select({
      number: importedAnswer.taskNumber,
      type: importedAnswer.type,
      question: importedAnswer.question,
      answer: importedAnswer.answer,
      correctAnswer: importedAnswer.correctAnswer,
      correct: importedAnswer.correct,
      topic: importedAnswer.topic,
    })
    .from(importedAnswer)
    .where(eq(importedAnswer.submissionId, id))
    .orderBy(asc(importedAnswer.taskNumber));
  return { ...found, tasks };
}
