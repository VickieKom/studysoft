import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../db/client";
import { blob, homework, homeworkAnswer } from "../db/schema";
import { createServerCaller } from "../router";
import { seedTeachers, signedInHeaders } from "../testing/requests";
import { blobStore, removeUnreferencedBlobs, saveBlob } from "./store";

// Cleaning up stored files nothing refers to (#73). The picture is a
// synthetic 1×1 PNG made here; every data URL becomes a new stored file. Integration files run one after another, so the
// files this test ages are the only old ones in the database.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];

const PNG = `data:image/png;base64,${Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
).toString("base64")}`;

let teacher: ReturnType<typeof createServerCaller>;
let teacherId: string;

const withImages = (images: string[]) => ({
  version: 1,
  title: "Pictures",
  tasks: images.map((image, i) => ({ type: "single_choice", prompt: `Task ${i + 1}`, options: ["a", "b"], answer: 0, image })),
});
const idOf = (ref: string | undefined) => ref!.replace(/^blob:/, "");

/** Makes these files look two days old: past the grace period. */
async function age(ids: string[]) {
  await db()
    .update(blob)
    .set({ createdAt: new Date(Date.now() - 48 * 3_600_000) })
    .where(inArray(blob.id, ids));
}

async function rowsOf(ids: string[]) {
  return (await db().select({ id: blob.id }).from(blob).where(inArray(blob.id, ids))).map((r) => r.id).sort();
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  teacherId = (await teacher.teacher.session.me()).id;
});

afterAll(closeDb);

describe("removeUnreferencedBlobs", () => {
  it("removes a picture replaced in a draft, row and file, and keeps every file something still refers to", async () => {
    const { id: studentId } = await teacher.teacher.students.create({
      firstName: "Чистка",
      lastName: "",
      level: "A2",
      timeZone: "Europe/Moscow",
    });
    const { id } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(withImages([PNG, PNG])) });
    const before = await teacher.teacher.homework.get({ id });
    const [kept, replaced] = before.tasks.map((t) => idOf(t.image));
    // The second picture is replaced in the editor.
    const { tasks, revision } = await teacher.teacher.homework.updateTasks({
      id,
      revision: before.revision,
      tasks: [before.tasks[0]!, { ...before.tasks[1]!, image: PNG }],
    });
    const replacement = idOf(tasks[1]!.image);

    // Another homework of the teacher refers to the first picture too, as a new assistant draft does.
    const { id: copy } = await teacher.teacher.homework.import({ studentId, json: JSON.stringify(withImages([PNG])) });
    const copyPicture = idOf((await teacher.teacher.homework.get({ id: copy })).tasks[0]!.image);
    await db()
      .update(homework)
      .set({ document: { ...withImages([`blob:${kept}`]), title: "Copy" } })
      .where(inArray(homework.id, [copy]));

    // A recording an answer refers to.
    const recording = await saveBlob(db(), teacherId, new Uint8Array([1, 2, 3]), "audio/webm");
    await db().insert(homeworkAnswer).values({ homeworkId: id, taskIndex: 0, answer: { type: "voice", file: recording, contentType: "audio/webm" } });

    const all = [kept!, replaced!, replacement, copyPicture, recording];
    // Young files stay whatever refers to them: an import may still be on its way.
    expect(await removeUnreferencedBlobs(db())).toEqual({ removed: 0, bytes: 0 });

    await age(all);
    const result = await removeUnreferencedBlobs(db());
    // The replaced picture and the copy's own picture, which nothing names any more.
    expect(result.removed).toBe(2);
    expect(result.bytes).toBeGreaterThan(0);
    expect(await rowsOf(all)).toEqual([kept!, replacement, recording].sort());
    expect(await blobStore().read(replaced!)).toBeNull();
    expect(await blobStore().read(copyPicture)).toBeNull();
    for (const stays of [kept!, replacement, recording]) expect(await blobStore().read(stays)).not.toBeNull();

    // Once the first homework drops the picture, the copy still keeps it.
    await teacher.teacher.homework.updateTasks({ id, revision, tasks: [{ ...tasks[0]!, image: PNG }, tasks[1]!] });
    await age([kept!]);
    await removeUnreferencedBlobs(db());
    expect(await rowsOf([kept!])).toEqual([kept!]);

    // A second run finds nothing more.
    expect((await removeUnreferencedBlobs(db())).removed).toBe(0);
  });
});
