import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import short from "../../../../deploy/seed/homework/demo-short.json";
import type { HomeworkDocument } from "../../domain/homework-format";
import { buildStudentContext } from "../crm/context";
import { closeDb, db } from "../db/client";
import { draftOrigin } from "../db/schema";
import { createServerCaller } from "../router";
import { seedTeachers, signedInHeaders } from "../testing/requests";
import { replaceableDraft, saveAssistantDraft } from "./drafts";

// The assistant's save racing the teacher (#43): the draft it read is
// changed before it writes. Each test forces that order step by step.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let teacherId: string;

const titled = (title: string) => ({ ...structuredClone(short), title }) as HomeworkDocument;

/** A student with the assistant's untouched draft, and that draft as the next save reads it. */
async function draftReadByTheAssistant(firstName: string) {
  const { id: studentId } = await teacher.teacher.students.create({
    firstName,
    lastName: "",
    level: "A2",
    timeZone: "Europe/Moscow",
  });
  const { id } = await assistant.agent.saveHomeworkDraft({ studentId, homework: titled("First") });
  const candidate = await replaceableDraft(db(), teacherId, studentId);
  expect(candidate?.id).toBe(id);
  const context = await buildStudentContext(db(), teacherId, studentId);
  if (!context) throw new Error("no student context");
  return { studentId, id, candidate, context };
}

async function originOf(id: string) {
  const [row] = await db().select().from(draftOrigin).where(eq(draftOrigin.homeworkId, id));
  return row!;
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
  const { token } = await teacher.teacher.assistant.createToken();
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${token}` }));
});

afterAll(closeDb);

describe("the assistant's save after it read its draft", () => {
  it("keeps an edit the teacher made in between, and makes a new draft", async () => {
    const { studentId, id, candidate, context } = await draftReadByTheAssistant("Правка между");
    const before = await originOf(id);
    // The teacher edits the draft after the save has read it...
    const edited = { ...short.tasks[0], prompt: "Edited by the teacher." };
    await teacher.teacher.homework.updateTasks({ id, tasks: [edited, ...short.tasks.slice(1)] });
    // ...and the save must not write over her.
    const saved = await saveAssistantDraft(db(), teacherId, studentId, candidate, titled("Second"), context);

    expect(saved).not.toBe(id);
    const hers = await teacher.teacher.homework.get({ id });
    expect(hers.title).toBe("First");
    expect(hers.tasks[0]!.prompt).toBe("Edited by the teacher.");
    expect((await originOf(id)).teacherEditedAt).not.toBeNull();
    expect((await originOf(id)).context).toEqual(before.context);
    expect((await teacher.teacher.homework.get({ id: saved })).title).toBe("Second");
  });

  it("keeps a homework published in between as it was built", async () => {
    const { studentId, id, candidate, context } = await draftReadByTheAssistant("Публикация между");
    const before = await originOf(id);
    const dueDate = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await teacher.teacher.homework.publish({ id, dueDate });
    const saved = await saveAssistantDraft(db(), teacherId, studentId, candidate, titled("Second"), context);

    expect(saved).not.toBe(id);
    expect(await teacher.teacher.homework.get({ id })).toMatchObject({ title: "First", status: "published" });
    expect((await originOf(id)).context).toEqual(before.context);
  });
});
