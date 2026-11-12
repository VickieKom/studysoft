import { describe, expect, it } from "vitest";
import allTypes from "../../../deploy/seed/homework/demo-all-types.json";
import short from "../../../deploy/seed/homework/demo-short.json";
import { isAnswered, parseHomework, type StudentTask, studentView } from "./homework-format";

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

  it("refuses another version, broken JSON, an unsupported or oversized image and a key outside the options", () => {
    const version = parseHomework(json({ ...short, version: 2 }));
    expect(!version.ok && version.errors[0]).toMatch(/version/);
    expect(parseHomework("{ not json").ok).toBe(false);

    const withImage = structuredClone(short);
    (withImage.tasks[0] as Record<string, unknown>).image = "data:image/gif;base64,R0lGODlh";
    const image = parseHomework(json(withImage));
    expect(!image.ok && image.errors[0]).toMatch(/^Задание 1, поле image/);
    (withImage.tasks[0] as Record<string, unknown>).image = `data:image/png;base64,${"A".repeat(2_796_204)}`;
    const big = parseHomework(json(withImage));
    expect(!big.ok && big.errors[0]).toMatch(/^Задание 1, поле image: картинка больше 2 МБ/);
    (withImage.tasks[0] as Record<string, unknown>).image = "data:image/png;base64,AAAA";
    expect(parseHomework(json(withImage)).ok).toBe(true);

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
  const parsed = parseHomework(json(allTypes));
  if (!parsed.ok) throw new Error("fixture must parse");
  const tasks = parsed.homework.tasks;

  it("never carries a key", () => {
    const view = JSON.stringify(tasks.map((task, i) => studentView(task, `seed:${i}`)));
    expect(view).not.toContain("carrots");
    expect(view).not.toMatch(/"answers?"|"pairs"|"alternatives"/);
  });

  it("shuffles the same way for the same seed and never leaves the solved order", () => {
    const order = { type: "order", prompt: "p", words: ["We", "play", "after", "school"] } as const;
    const match = {
      type: "match",
      prompt: "p",
      pairs: [
        { left: "hot", right: "cold" },
        { left: "big", right: "small" },
      ],
    } as const;
    for (let i = 0; i < 50; i++) {
      const seed = `homework:${i}`;
      const words = studentView({ ...order, words: [...order.words] }, seed);
      expect(words).toEqual(studentView({ ...order, words: [...order.words] }, seed));
      expect(words.type === "order" && words.words).not.toEqual(order.words);
      expect(words.type === "order" && [...words.words].sort()).toEqual([...order.words].sort());

      const pairs = studentView({ ...match, pairs: match.pairs.map((p) => ({ ...p })) }, seed);
      expect(pairs.type === "match" && pairs.left).toEqual(["hot", "big"]);
      expect(pairs.type === "match" && pairs.right).toEqual(["small", "cold"]);
    }
  });
});

describe("studentView with alternatives", () => {
  it("never shows any of the correct orders of an order task", () => {
    const words = ["a", "b"];
    for (let i = 0; i < 30; i++) {
      // Both orders of two words are correct: nothing else exists, so it stays as it is.
      const both = studentView({ type: "order", prompt: "p", words, alternatives: [["b", "a"]] }, `seed:${i}`);
      expect(both.type === "order" && both.words.length).toBe(2);
      const three = studentView(
        { type: "order", prompt: "p", words: ["x", "y", "z"], alternatives: [["y", "z", "x"], ["z", "x", "y"]] },
        `seed:${i}`,
      );
      expect(three.type === "order" && [["x", "y", "z"], ["y", "z", "x"], ["z", "x", "y"]]).not.toContainEqual(
        three.type === "order" && three.words,
      );
    }
  });
});

describe("isAnswered", () => {
  it("wants a full answer", () => {
    const gap: StudentTask = { type: "gap", prompt: "p", text: "___ and ___" };
    expect(isAnswered(gap, { type: "gap", gaps: ["a", "b"] })).toBe(true);
    expect(isAnswered(gap, { type: "gap", gaps: ["a", " "] })).toBe(false);
    expect(isAnswered(gap, null)).toBe(false);
    const order: StudentTask = { type: "order", prompt: "p", words: ["a", "b"] };
    expect(isAnswered(order, { type: "order", words: ["b"] })).toBe(false);
    expect(isAnswered(order, { type: "order", words: ["b", "a"] })).toBe(true);
    expect(isAnswered({ type: "multiple_choice", prompt: "p", options: ["a", "b"] }, { type: "multiple_choice", choices: [] })).toBe(
      false,
    );
  });
});
