import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../../db/client";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller } from "../index";

// Several topics on a library material (#290): typed separated by commas,
// at most 10 of 100 characters, a repeat in another case kept once; the
// filter finds the material by any and offers each. The assistant's drafts
// take them the same way. The games are synthetic.

const [teacherA] = seedTeachers as [(typeof seedTeachers)[number]];
let teacher: ReturnType<typeof createServerCaller>;
let assistant: ReturnType<typeof createServerCaller>;

const run = crypto.randomUUID().slice(0, 8);
const html = (title: string) => `<!doctype html><html><body><h1>${title}</h1></body></html>`;
const tags = (title: string, topic: string) => ({ title, level: "A2" as const, topic, ageGroup: "younger" as const });

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  assistant = createServerCaller(new Headers({ authorization: `Bearer ${(await teacher.teacher.assistant.createToken()).token}` }));
});

afterAll(closeDb);

describe("a material's topics", () => {
  it("are kept as typed, found by each, offered each, and changed by an edit", async () => {
    const [first, second] = [`grammar ${run}`, `food ${run}`];
    const { id } = await teacher.teacher.library.addGame({ ...tags("Темы", ` ${first}, ${second},, ${second.toUpperCase()} `), html: html("Темы") });
    expect((await teacher.teacher.library.get({ id })).topics).toEqual([first, second]);
    for (const topic of [first, second]) {
      const listed = await teacher.teacher.library.list({ kind: "game", topic });
      expect(listed.materials.map((m) => m.id)).toEqual([id]);
      expect(listed.topics).toEqual(expect.arrayContaining([first, second]));
    }

    await teacher.teacher.library.update({ id, ...tags("Темы", second) });
    expect((await teacher.teacher.library.get({ id })).topics).toEqual([second]);
    expect((await teacher.teacher.library.list({ kind: "game", topic: first })).materials).toEqual([]);
    expect((await teacher.teacher.library.list({})).topics).not.toContain(first);
    await teacher.teacher.library.update({ id, ...tags("Темы", "") });
    expect((await teacher.teacher.library.get({ id })).topics).toEqual([]);
  });

  it("are at most 10, each at most 100 characters", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`).join(", ");
    await expect(teacher.teacher.library.addGame({ ...tags("Много тем", eleven), html: html("x") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(teacher.teacher.library.addGame({ ...tags("Длинная тема", "x".repeat(101)), html: html("x") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const ten = Array.from({ length: 10 }, (_, i) => `t${i} ${run}`).join(", ");
    const { id } = await teacher.teacher.library.addGame({ ...tags("Десять тем", ten), html: html("x") });
    expect((await teacher.teacher.library.get({ id })).topics).toHaveLength(10);
  });

  it("come with the assistant's drafts the same way", async () => {
    const { id } = await assistant.agent.saveWarmupDraft({ ...tags("Разминка тем", `food ${run}, Food ${run}, pets ${run}`), format: "questions", questions: ["What do you eat?"] });
    expect((await teacher.teacher.library.get({ id })).topics).toEqual([`food ${run}`, `pets ${run}`]);
  });
});
