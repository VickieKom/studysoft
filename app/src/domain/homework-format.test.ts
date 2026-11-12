import { describe, expect, it } from "vitest";
import allTypes from "../../../deploy/seed/homework/demo-all-types.json";
import short from "../../../deploy/seed/homework/demo-short.json";
import { parseHomework, studentView } from "./homework-format";

const json = (value: unknown) => JSON.stringify(value);

describe("parseHomework", () => {
  it("accepts the synthetic homework with every task type", () => {
    const result = parseHomework(json(allTypes));
    expect(result.ok).toBe(true);
    expect(parseHomework(json(short)).ok).toBe(true);
  });

  it("names the task and the field for an unknown type", () => {
    const broken = structuredClone(allTypes);
    (broken.tasks[1] as { type: string }).type = "riddle";
    const result = parseHomework(json(broken));
    expect(result).toEqual({ ok: false, errors: [expect.stringMatching(/^Задание 2, поле type: неизвестный тип «riddle»/)] });
  });

  it("refuses another version, broken JSON, an image and a key outside the options", () => {
    const version = parseHomework(json({ ...short, version: 2 }));
    expect(!version.ok && version.errors[0]).toMatch(/version/);
    expect(parseHomework("{ not json").ok).toBe(false);

    const withImage = structuredClone(short);
    (withImage.tasks[0] as Record<string, unknown>).image = "data:image/png;base64,AAAA";
    const image = parseHomework(json(withImage));
    expect(!image.ok && image.errors[0]).toMatch(/^Задание 1, поле image/);

    const badKey = structuredClone(short);
    (badKey.tasks[0] as { answer: number }).answer = 7;
    const key = parseHomework(json(badKey));
    expect(!key.ok && key.errors[0]).toMatch(/^Задание 1, поле answer/);
  });

  it("checks that a gap text has as many gaps as answer lists", () => {
    const task = { type: "gap", prompt: "p", text: "a ___ b ___", answers: [["x"]] };
    const result = parseHomework(json({ version: 1, title: "t", tasks: [task] }));
    expect(!result.ok && result.errors[0]).toMatch(/^Задание 1, поле answers/);
  });
});

describe("studentView", () => {
  it("never carries a key", () => {
    const parsed = parseHomework(json(allTypes));
    if (!parsed.ok) throw new Error("fixture must parse");
    const view = JSON.stringify(parsed.homework.tasks.map(studentView));
    expect(view).not.toContain("carrots");
    expect(view).not.toMatch(/"answers?"|"pairs"|"alternatives"/);
  });
});
