import { describe, expect, it } from "vitest";
import allTypes from "../../../deploy/seed/homework/demo-all-types.json";
import short from "../../../deploy/seed/homework/demo-short.json";
import { optionLabel } from "./homework";
import { audioDataUrl, isAnswered, parseHomework, partPictures, type StudentTask, studentView, withPartPictures } from "./homework-format";

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

describe("a task's recording (#127)", () => {
  it("takes MP3, M4A, WAV and OGG under the names tools give them, and stores each under one type", () => {
    const of = (type: string) => audioDataUrl(`data:${type};base64,AAAA`)?.type ?? null;
    expect([of("audio/mp3"), of("audio/mpeg"), of("audio/x-m4a"), of("audio/x-wav"), of("audio/ogg")]).toEqual([
      "audio/mpeg",
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "audio/ogg",
    ]);
    expect([of("audio/flac"), of("video/mp4"), of("image/png")]).toEqual([null, null, null]);
  });

  it("is refused by the format when it is not a recording or over 10 MB", () => {
    const task = (audio: string) => JSON.stringify({ version: 1, title: "t", tasks: [{ type: "written", prompt: "Listen.", audio }] });
    expect(parseHomework(task("data:audio/wav;base64,UklGRg==")).ok).toBe(true);
    expect(parseHomework(task("https://example.test/track.mp3")).ok).toBe(false);
    const big = Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64");
    expect(parseHomework(task(`data:audio/wav;base64,${big}`))).toMatchObject({ ok: false, errors: [expect.stringContaining("больше 10 МБ")] });
  });
});

describe("pictures as answer options (#129)", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const choice = (options: unknown[]) =>
    parseHomework(JSON.stringify({ version: 1, title: "t", tasks: [{ type: "single_choice", prompt: "p", options, answer: 0 }] }));

  it("mixes text, a picture and a captioned picture, and lists the pictures in order", () => {
    const parsed = choice([{ images: [PNG] }, { images: [PNG, PNG], text: "two" }, "text"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [task] = parsed.homework.tasks;
    expect(partPictures(task!).map((p) => p.place)).toEqual(["вариант 1, картинка 1", "вариант 2, картинка 1", "вариант 2, картинка 2"]);
    const addressed = withPartPictures(task!, (_, n) => `/picture/${n}`);
    expect(addressed).toMatchObject({ options: [{ images: ["/picture/0"] }, { images: ["/picture/1", "/picture/2"], text: "two" }, "text"] });
    expect(optionLabel(task!.type === "single_choice" ? task!.options : [], 1)).toBe("two (картинка b)");
    expect(optionLabel(task!.type === "single_choice" ? task!.options : [], 0)).toBe("картинка a");
    expect(optionLabel(task!.type === "single_choice" ? task!.options : [], 2)).toBe("text");
  });

  it("refuses a GIF, no pictures, five pictures and an empty caption, naming the option", () => {
    const gif = choice(["text", { images: ["data:image/gif;base64,R0lGODlh"] }]);
    expect(gif).toMatchObject({ ok: false, errors: [expect.stringMatching(/^Задание 1, вариант 2, картинка 1: картинка — PNG, JPEG или WebP/)] });
    for (const bad of [{ images: [] }, { images: [PNG, PNG, PNG, PNG, PNG] }, { images: [PNG], text: " " }, { images: [PNG], size: 1 }]) {
      const result = choice(["text", bad]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toMatch(/^Задание 1, вариант 2/);
    }
  });
});
