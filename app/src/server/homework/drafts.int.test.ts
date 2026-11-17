import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import short from "../../../../deploy/seed/homework/demo-short.json";
import type { HomeworkDocument } from "../../domain/homework-format";
import { buildStudentContext } from "../crm/context";
import { closeDb, db } from "../db/client";
import { draftOrigin, homework } from "../db/schema";
import { createServerCaller } from "../router";
import { seedTeachers, signedInHeaders } from "../testing/requests";
import { replaceableDraft, saveAssistantDraft } from "./drafts";

// The assistant's save racing the teacher (#43): the draft it read is
// changed before it writes. Each test forces that order step by step. And the
// other way round (#99): the teacher's page is older than the assistant's
// replacement, so publishing and saving from it are refused.

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

// The revision the teacher's page sends back with publishing and saving tasks (#99).
const revisionOf = async (id: string) => (await teacher.teacher.homework.get({ id })).revision;

describe("the assistant's save after it read its draft", () => {
  it("keeps an edit the teacher made in between, and makes a new draft", async () => {
    const { studentId, id, candidate, context } = await draftReadByTheAssistant("Правка между");
    const before = await originOf(id);
    // The teacher edits the draft after the save has read it...
    const edited = { ...short.tasks[0], prompt: "Edited by the teacher." };
    await teacher.teacher.homework.updateTasks({ id, revision: await revisionOf(id), tasks: [edited, ...short.tasks.slice(1)] });
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
    await teacher.teacher.homework.publish({ id, revision: await revisionOf(id), dueDate });
    const saved = await saveAssistantDraft(db(), teacherId, studentId, candidate, titled("Second"), context);

    expect(saved).not.toBe(id);
    expect(await teacher.teacher.homework.get({ id })).toMatchObject({ title: "First", status: "published" });
    expect((await originOf(id)).context).toEqual(before.context);
  });
});

describe("the teacher's page after the assistant replaced its draft (#99)", () => {
  const dueDate = () => new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const changed = { code: "CONFLICT", message: expect.stringMatching(/^Черновик изменился/) };

  /** The assistant's draft as the teacher's page loaded it, then replaced under the same id. */
  async function replacedAfterThePageLoaded(firstName: string) {
    const { studentId, id } = await draftReadByTheAssistant(firstName);
    const seen = await revisionOf(id);
    const replaced = await assistant.agent.saveHomeworkDraft({ studentId, homework: titled("Second") });
    expect(replaced.id).toBe(id);
    return { id, seen };
  }

  it("refuses to publish what the teacher has not seen, and publishes it once she reloads", async () => {
    const { id, seen } = await replacedAfterThePageLoaded("Публикация устаревшей");
    await expect(teacher.teacher.homework.publish({ id, revision: seen, dueDate: dueDate() })).rejects.toMatchObject(changed);
    expect(await teacher.teacher.homework.get({ id })).toMatchObject({ title: "Second", status: "draft" });

    const reloaded = await revisionOf(id);
    expect(reloaded).not.toBe(seen);
    await teacher.teacher.homework.publish({ id, revision: reloaded, dueDate: dueDate() });
    expect(await teacher.teacher.homework.get({ id })).toMatchObject({ title: "Second", status: "published" });
  });

  it("refuses a stale page's tasks and keeps the assistant's version replaceable", async () => {
    const { id, seen } = await replacedAfterThePageLoaded("Правка устаревшей");
    const edited = { ...short.tasks[0], prompt: "Edited on a stale page." };
    await expect(
      teacher.teacher.homework.updateTasks({ id, revision: seen, tasks: [edited, ...short.tasks.slice(1)] }),
    ).rejects.toMatchObject(changed);
    const draft = await teacher.teacher.homework.get({ id });
    expect(draft.title).toBe("Second");
    expect(draft.tasks).toEqual(short.tasks);
    expect((await originOf(id)).teacherEditedAt).toBeNull();
  });

  it("publishes an unchanged draft, and one the teacher's own save moved on", async () => {
    const { id } = await draftReadByTheAssistant("Без изменений");
    const loaded = await revisionOf(id);
    const edited = { ...short.tasks[0], prompt: "Edited, then published." };
    const { revision } = await teacher.teacher.homework.updateTasks({
      id,
      revision: loaded,
      tasks: [edited, ...short.tasks.slice(1)],
    });
    expect(revision).not.toBe(loaded);
    expect(revision).toBe(await revisionOf(id));
    // The revision from before her own save is stale now too.
    await expect(teacher.teacher.homework.publish({ id, revision: loaded, dueDate: dueDate() })).rejects.toMatchObject(changed);
    await teacher.teacher.homework.publish({ id, revision, dueDate: dueDate() });
    expect((await teacher.teacher.homework.get({ id })).tasks[0]!.prompt).toBe("Edited, then published.");
  });

  it("waits for a replacement in progress, then sees it and refuses", async () => {
    const { id } = await draftReadByTheAssistant("Замена в процессе");
    const seen = await revisionOf(id);
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    // The assistant's replacement holds the homework row, as saveAssistantDraft does.
    const replacing = db().transaction(async (tx) => {
      await tx.select({ id: homework.id }).from(homework).where(eq(homework.id, id)).for("update");
      locked();
      await released;
      await tx.update(homework).set({ document: titled("Second"), title: "Second" }).where(eq(homework.id, id));
    });
    await isLocked;

    const publishing = teacher.teacher.homework.publish({ id, revision: seen, dueDate: dueDate() }).then(
      () => "published",
      (error: unknown) => error,
    );
    const waiting = await Promise.race([publishing, new Promise((resolve) => setTimeout(() => resolve("waiting"), 300))]);
    expect(waiting).toBe("waiting");

    release();
    await replacing;
    expect(await publishing).toMatchObject(changed);
    expect(await teacher.teacher.homework.get({ id })).toMatchObject({ title: "Second", status: "draft" });
  });
});
