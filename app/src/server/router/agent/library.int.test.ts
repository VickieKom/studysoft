import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../db/client";
import { libraryMaterial } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleLibraryFileRequest } from "../index";

// Games and warm-ups the assistant saves to the library as drafts (#120):
// out of the list and its filters until the teacher adds them; replaced by
// the assistant while untouched; never added or deleted by it. The games and
// the picture are synthetic, written here.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

let teacher: ReturnType<typeof createServerCaller>;
let teacherHeaders: Headers;
let otherTeacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let otherAssistant: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
// A 1×1 PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const tags = (title: string, topic = `drafts ${run}`) => ({ title, level: "A2" as const, topic, ageGroup: "younger" as const });

async function rowOf(id: string) {
  const [row] = await db().select().from(libraryMaterial).where(eq(libraryMaterial.id, id));
  return row;
}

beforeAll(async () => {
  teacherHeaders = await signedInHeaders(teacherA);
  teacher = createServerCaller(teacherHeaders);
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  otherAssistant = createServerCaller(
    new Headers({ authorization: `Bearer ${(await otherTeacher.teacher.assistant.createToken()).token}` }),
  );
});

afterAll(closeDb);

describe("the assistant's library drafts", () => {
  it("keep a game out of the library, its topics and filters until the teacher adds it", async () => {
    const topic = `out of the list ${run}`;
    const { id } = await assistant.agent.saveGameDraft({ ...tags("Draft game", topic), html: html("Draft game") });

    expect((await teacher.teacher.library.list({ topic })).materials).toEqual([]);
    expect((await teacher.teacher.library.list({ kind: "game" })).materials.map((m) => m.id)).not.toContain(id);
    expect((await teacher.teacher.library.list({})).topics).not.toContain(topic);
    expect((await teacher.teacher.library.drafts()).map((d) => d.id)).toContain(id);
    expect(await teacher.teacher.library.get({ id })).toMatchObject({ id, kind: "game", draft: true, fileUrl: `/api/files/library/${id}` });
    // The teacher sees its page and file before adding it.
    const file = await handleLibraryFileRequest(new Request(`${env().APP_URL}/api/files/library/${id}`, { headers: teacherHeaders }), id);
    expect(file.status).toBe(200);
    expect(await file.text()).toBe(html("Draft game"));

    await teacher.teacher.library.addToLibrary({ id });
    expect((await teacher.teacher.library.list({ topic })).materials.map((m) => m.id)).toEqual([id]);
    expect((await teacher.teacher.library.drafts()).map((d) => d.id)).not.toContain(id);
    expect(await teacher.teacher.library.get({ id })).toMatchObject({ draft: false });
  });

  it("replace the assistant's own untouched draft; after the teacher's edit or adding it, make a new one", async () => {
    const { id } = await assistant.agent.saveGameDraft({ ...tags("Version 1"), html: html("Version 1") });
    const firstFile = (await rowOf(id))!.blobId;
    expect(await assistant.agent.saveGameDraft({ ...tags("Version 2"), html: html("Version 2"), id })).toEqual({ id });
    const replaced = (await rowOf(id))!;
    expect(replaced.title).toBe("Version 2");
    expect(replaced.blobId).not.toBe(firstFile);

    // The teacher renames it: the assistant's next save is a new draft, hers stays.
    await teacher.teacher.library.update({ id, ...tags("Hers now") });
    const afterEdit = await assistant.agent.saveGameDraft({ ...tags("Version 3"), html: html("Version 3"), id });
    expect(afterEdit.id).not.toBe(id);
    expect((await rowOf(id))!.title).toBe("Hers now");

    // Added to the library: the same.
    await teacher.teacher.library.addToLibrary({ id: afterEdit.id });
    const afterAdd = await assistant.agent.saveGameDraft({ ...tags("Version 4"), html: html("Version 4"), id: afterEdit.id });
    expect(afterAdd.id).not.toBe(afterEdit.id);
    expect((await rowOf(afterEdit.id))!).toMatchObject({ title: "Version 3", draft: false });

    // A warm-up is not replaced by a game, nor a game by a warm-up.
    const warmup = await assistant.agent.saveWarmupDraft({ ...tags("Talk"), format: "questions", questions: ["One?"] });
    const game = await assistant.agent.saveGameDraft({ ...tags("Not a warm-up"), html: html("x"), id: warmup.id });
    expect(game.id).not.toBe(warmup.id);
    expect((await rowOf(warmup.id))!).toMatchObject({ kind: "warmup", questions: ["One?"] });
  });

  it("switch a warm-up draft between questions and a picture, keeping only what fits", async () => {
    const { id } = await assistant.agent.saveWarmupDraft({ ...tags("Mood"), format: "questions", questions: ["  How are you? ", ""] });
    expect((await rowOf(id))!).toMatchObject({ questions: ["How are you?"], blobId: null, draft: true });
    await assistant.agent.saveWarmupDraft({ ...tags("Mood"), format: "picture", picture: PNG, id });
    const row = (await rowOf(id))!;
    expect(row.questions).toBeNull();
    expect(row.blobId).not.toBeNull();
    expect(await teacher.teacher.library.get({ id })).toMatchObject({ kind: "warmup", fileUrl: `/api/files/library/${id}`, questions: null });
  });

  it("refuse what an upload refuses, and save nothing", async () => {
    const topic = `refused drafts ${run}`;
    await expect(assistant.agent.saveGameDraft({ ...tags("PDF", topic), html: "%PDF-1.4 not a game" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("HTML"),
    });
    await expect(
      assistant.agent.saveWarmupDraft({ ...tags("GIF", topic), format: "picture", picture: Buffer.from("GIF89a....").toString("base64") }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("PNG") });
    await expect(assistant.agent.saveWarmupDraft({ ...tags("Empty", topic), format: "questions", questions: ["", " "] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await db().select().from(libraryMaterial).where(eq(libraryMaterial.topic, topic))).toEqual([]);
  });

  it("never reach another teacher's library, and the token is not a teacher session", async () => {
    const { id } = await assistant.agent.saveGameDraft({ ...tags("Mine"), html: html("Mine") });
    // Another teacher's assistant given this id gets a draft of its own; this one is untouched.
    const theirs = await otherAssistant.agent.saveGameDraft({ ...tags("Theirs"), html: html("Theirs"), id });
    expect(theirs.id).not.toBe(id);
    expect((await rowOf(id))!.title).toBe("Mine");
    expect((await otherTeacher.teacher.library.drafts()).map((d) => d.id)).toEqual(expect.arrayContaining([theirs.id]));
    expect((await otherTeacher.teacher.library.drafts()).map((d) => d.id)).not.toContain(id);
    // Another teacher cannot open, add or delete it: the same as a missing one.
    for (const call of [
      () => otherTeacher.teacher.library.get({ id }),
      () => otherTeacher.teacher.library.addToLibrary({ id }),
      () => otherTeacher.teacher.library.remove({ id }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    // The assistant's token does not open the teacher's procedures.
    await expect(assistant.teacher.library.addToLibrary({ id })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(assistant.teacher.library.remove({ id })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await rowOf(id))!.draft).toBe(true);
    // Clean up the second teacher's library: other tests count its materials.
    await otherTeacher.teacher.library.remove({ id: theirs.id });
  });
});
