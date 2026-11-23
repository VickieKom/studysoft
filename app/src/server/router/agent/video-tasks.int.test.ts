import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../../db/client";
import { videoTasks } from "../../db/schema";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { appRouter, createServerCaller } from "../index";

// A library video's tasks (#326): the assistant reads the video's link and
// transcript and saves a draft of its tasks in the homework format; the
// teacher removes tasks and confirms. The draft is replaced while untouched,
// a save after her edit is refused, a save after confirmation lies beside the
// confirmed tasks. «Убрать» and «Подтвердить» take the revision the page saw.
// The link, the transcript and the tasks are synthetic.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let other: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;
let otherAssistant: ReturnType<typeof createServerCaller>;

const TRANSCRIPT = "The demo robot wakes up at seven. It walks to the blue box.";
const tags = { level: "A2" as const, topic: "video tasks", ageGroup: "younger" as const };
const trueFalse = (prompt: string, answer: 0 | 1) => ({ type: "single_choice", prompt, options: ["True", "False"], answer });
const tasks = (...prompts: string[]) => ({ version: 1, title: "Robot walk", tasks: prompts.map((p, i) => trueFalse(p, (i % 2) as 0 | 1)) });

async function newVideo(title: string, transcript?: string) {
  const { id } = await teacher.teacher.library.addVideoLink({ ...tags, title, url: "https://video.example.test/robot", ...(transcript ? { transcript } : {}) });
  return id;
}

const shown = (id: string) => teacher.teacher.library.videoTasks({ id });
const prompts = (list: { prompt: string }[] | null | undefined) => (list ?? []).map((t) => t.prompt);

beforeAll(async () => {
  const headers = await signedInHeaders(teacherA);
  teacher = createServerCaller(headers);
  other = createServerCaller(await signedInHeaders(teacherB));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
  otherAssistant = createServerCaller(new Headers({ authorization: `Bearer ${(await other.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("a library video for the assistant", () => {
  it("gives its link and the transcript from «Расшифровка», kept and changed by an edit", async () => {
    const id = await newVideo("Robot walk", `  ${TRANSCRIPT}  `);
    expect(await assistant.agent.libraryVideo({ id })).toEqual({ id, title: "Robot walk", link: "https://video.example.test/robot", transcript: TRANSCRIPT });
    expect((await teacher.teacher.library.get({ id })).transcript).toBe(TRANSCRIPT);

    // An edit without it keeps it; an empty one removes it.
    await teacher.teacher.library.update({ id, ...tags, title: "Robot walk, renamed" });
    expect((await teacher.teacher.library.get({ id })).transcript).toBe(TRANSCRIPT);
    await teacher.teacher.library.update({ id, ...tags, title: "Robot walk, renamed", transcript: "   " });
    expect((await assistant.agent.libraryVideo({ id })).transcript).toBeNull();
  });

  it("is another teacher's to no one, and a game is no video", async () => {
    const id = await newVideo("Not for the other assistant", TRANSCRIPT);
    await expect(otherAssistant.agent.libraryVideo({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherAssistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("A.", "B.") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.teacher.library.videoTasks({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const game = await teacher.teacher.library.addGame({ ...tags, title: "A game", html: "<!doctype html><html><body>game</body></html>" });
    await expect(assistant.agent.libraryVideo({ id: game.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(assistant.agent.saveVideoTasksDraft({ videoId: game.id, tasks: tasks("A.", "B.") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await shown(id)).toEqual({ confirmed: null, draft: null });
  });
});

describe("the assistant's draft of a video's tasks", () => {
  it("is refused naming the task and the field when it fails the format, with a picture, or with too many tasks; nothing is saved", async () => {
    const id = await newVideo("Refused tasks");
    const broken = tasks("The robot wakes up at seven.", "The box is red.");
    (broken.tasks[1] as { options: string[] }).options = ["Only one"];
    await expect(assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: broken })).rejects.toThrow(/Задание 2.*options/);

    const pictured = tasks("Which one is the box?");
    (pictured.tasks[0] as unknown as { image: string }).image = "data:image/png;base64,iVBORw0KGgo=";
    await expect(assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: pictured })).rejects.toThrow(/картинок/);

    const many = tasks(...Array.from({ length: 21 }, (_, i) => `Statement ${i + 1}.`));
    await expect(assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: many })).rejects.toThrow(/не больше 20/);
    expect(await shown(id)).toEqual({ confirmed: null, draft: null });
  });

  it("shows as the child will see it, without keys, and is replaced while the teacher has done nothing to it", async () => {
    const id = await newVideo("Replaced draft");
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("First one.", "First two.") });
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("Second one.", "Second two.", "Second three.") });
    const view = await shown(id);
    expect(prompts(view.draft?.tasks)).toEqual(["Second one.", "Second two.", "Second three."]);
    expect(JSON.stringify(view)).not.toContain('"answer"');
    const [row] = await db().select({ draft: videoTasks.draft }).from(videoTasks).where(eq(videoTasks.materialId, id));
    expect(JSON.stringify(row!.draft)).toContain('"answer"');
  });

  it("is kept once the teacher removes a task: the next save is refused and her draft stays", async () => {
    const id = await newVideo("Edited draft");
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("Keep one.", "Drop me.", "Keep two.") });
    const { revision } = (await shown(id)).draft!;
    await teacher.teacher.library.removeVideoTask({ id, index: 1, revision });
    await expect(assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("Assistant again.", "And again.") })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prompts((await shown(id)).draft?.tasks)).toEqual(["Keep one.", "Keep two."]);
  });

  it("keeps its last task", async () => {
    const id = await newVideo("Last task");
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("Only one.") });
    const { revision } = (await shown(id)).draft!;
    await expect(teacher.teacher.library.removeVideoTask({ id, index: 0, revision })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prompts((await shown(id)).draft?.tasks)).toEqual(["Only one."]);
  });
});

describe("confirming a video's tasks", () => {
  it("makes the draft the confirmed tasks; the next save lies beside them and replaces them once confirmed", async () => {
    const id = await newVideo("Confirmed tasks");
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("Confirmed one.", "Confirmed two.") });
    await teacher.teacher.library.confirmVideoTasks({ id, revision: (await shown(id)).draft!.revision });
    expect(await shown(id)).toMatchObject({ draft: null });
    expect(prompts((await shown(id)).confirmed)).toEqual(["Confirmed one.", "Confirmed two."]);

    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("Next one.", "Next two.") });
    const beside = await shown(id);
    expect(prompts(beside.confirmed)).toEqual(["Confirmed one.", "Confirmed two."]);
    expect(prompts(beside.draft?.tasks)).toEqual(["Next one.", "Next two."]);

    await teacher.teacher.library.confirmVideoTasks({ id, revision: beside.draft!.revision });
    expect(await shown(id)).toMatchObject({ draft: null });
    expect(prompts((await shown(id)).confirmed)).toEqual(["Next one.", "Next two."]);
  });

  it("is refused «Задания изменились» when the assistant replaced the draft after the page read it, and so is «Убрать»", async () => {
    const id = await newVideo("Seen draft");
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("Version one A.", "Version one B.") });
    // The teacher's page reads version one...
    const page = await shown(id);
    // ...the assistant replaces the untouched draft...
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("Version two A.", "Version two B.") });
    // ...and neither «Подтвердить» nor «Убрать» from that page changes anything.
    await expect(teacher.teacher.library.confirmVideoTasks({ id, revision: page.draft!.revision })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Задания изменились"),
    });
    await expect(teacher.teacher.library.removeVideoTask({ id, index: 0, revision: page.draft!.revision })).rejects.toMatchObject({ code: "CONFLICT" });
    const after = await shown(id);
    expect(after.confirmed).toBeNull();
    expect(prompts(after.draft?.tasks)).toEqual(["Version two A.", "Version two B."]);
  });

  it("is the teacher's only: no agent procedure confirms or removes, and the teacher's refuse the assistant's token", async () => {
    const agentProcedures = Object.keys(appRouter._def.procedures).filter((p) => p.startsWith("agent."));
    expect(agentProcedures.filter((p) => /confirm|removeVideo/i.test(p))).toEqual([]);
    const id = await newVideo("Assistant cannot confirm");
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("A.", "B.") });
    const { revision } = (await shown(id)).draft!;
    await expect(assistant.teacher.library.confirmVideoTasks({ id, revision })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(other.teacher.library.confirmVideoTasks({ id, revision })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await shown(id)).confirmed).toBeNull();
  });

  it("go with the video when the teacher deletes it", async () => {
    const id = await newVideo("Deleted video");
    await assistant.agent.saveVideoTasksDraft({ videoId: id, tasks: tasks("A.", "B.") });
    await teacher.teacher.library.remove({ id });
    expect(await db().select({ id: videoTasks.id }).from(videoTasks).where(eq(videoTasks.materialId, id))).toEqual([]);
  });
});
