import { describe, expect, it } from "vitest";
import allTypes from "../../../deploy/seed/homework/demo-all-types.json";
import choices from "../../../deploy/seed/homework/demo-gap-choices.json";
import layout from "../../../deploy/seed/homework/demo-layout.json";
import orderSentences from "../../../deploy/seed/homework/demo-order-sentences.json";
import short from "../../../deploy/seed/homework/demo-short.json";
import { optionLabel } from "./homework";
import {
  audioDataUrl,
  isAnswered,
  parseHomework,
  partPictures,
  type StudentTask,
  studentView,
  tableBlanks,
  taskPoints,
  withPartPictures,
} from "./homework-format";

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
      expect("words" in words && words.words).not.toEqual(order.words);
      expect("words" in words && [...words.words].sort()).toEqual([...order.words].sort());

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
      expect("words" in both && both.words.length).toBe(2);
      const three = studentView(
        { type: "order", prompt: "p", words: ["x", "y", "z"], alternatives: [["y", "z", "x"], ["z", "x", "y"]] },
        `seed:${i}`,
      );
      expect(three.type === "order" && [["x", "y", "z"], ["y", "z", "x"], ["z", "x", "y"]]).not.toContainEqual(
        "words" in three && three.words,
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

describe("a gap's own options (#128)", () => {
  const task = choices.tasks[0]!;
  const withTask = (changes: object) => JSON.stringify({ ...choices, tasks: [{ ...task, ...changes }] });

  it("are accepted and reach the student, the keys do not", () => {
    const parsed = parseHomework(JSON.stringify(choices));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const view = studentView(parsed.homework.tasks[0]!, "seed");
    expect(view).toMatchObject({ type: "gap", choices: [["on", "at"], ["plays", "does"], null] });
    expect(JSON.stringify(view)).not.toContain("Mila");
  });

  it("name the task and the gap whose key is not among its options", () => {
    const result = parseHomework(withTask({ answers: [["on"], ["play"], ["Mila"]] }));
    expect(result).toEqual({ ok: false, errors: [expect.stringMatching(/^Задание 1, .*пропуск 2: ответа «play» нет среди его вариантов/)] });
  });

  it("refuse a list for the wrong number of gaps, a single option and both kinds of options together", () => {
    for (const changes of [
      { choices: [["on", "at"], null] },
      { choices: [["on"], ["plays", "does"], null] },
      { options: ["on", "at"] },
    ]) {
      expect(parseHomework(withTask(changes)).ok).toBe(false);
    }
  });

  it("accept a key that differs from its option only by case and spaces", () => {
    expect(parseHomework(withTask({ answers: [[" On "], ["plays"], ["Mila"]] })).ok).toBe(true);
  });
});

describe("a workbook exercise's parts (#131)", () => {
  it("accepts a reading text and an example, and the student gets both but no key", () => {
    const parsed = parseHomework(JSON.stringify(layout));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [blog, , gap] = parsed.homework.tasks;
    expect(studentView(blog!, "seed")).toMatchObject({ prompt: blog!.prompt, passage: blog!.passage });
    const view = studentView(gap!, "seed");
    expect(view).toMatchObject({ type: "gap", example: { text: "0 She ___ a teacher.", answer: "is" } });
    expect(JSON.stringify(view)).not.toContain("'re");
  });

  it("refuses an example without its text, an empty reading text and a field it does not know", () => {
    const task = { type: "written", prompt: "Write." };
    for (const extra of [{ example: { answer: "is" } }, { passage: "  " }, { example: { text: "x", points: 1 } }]) {
      const result = parseHomework(JSON.stringify({ version: 1, title: "t", tasks: [{ ...task, ...extra }] }));
      expect(result.ok).toBe(false);
    }
  });
});

describe("an order task of several sentences (#161)", () => {
  const homework = (task: object) => JSON.stringify({ version: 1, title: "t", tasks: [{ type: "order", prompt: "p", ...task }] });

  it("is one task of a point per sentence; the student gets each sentence shuffled and no right order", () => {
    const parsed = parseHomework(JSON.stringify(orderSentences));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [task] = parsed.homework.tasks;
    expect(taskPoints(task!)).toBe(3);
    expect(taskPoints({ type: "order", prompt: "p", words: ["a", "b"] })).toBe(1);
    for (let i = 0; i < 30; i++) {
      const view = studentView(task!, `seed:${i}`);
      expect(view).not.toHaveProperty("words");
      const shown = "sentences" in view ? view.sentences : [];
      expect(shown).toHaveLength(3);
      orderSentences.tasks[0]!.sentences.forEach(({ words }, n) => {
        expect([...shown[n]!].sort()).toEqual([...words].sort());
        expect(shown[n]).not.toEqual(words);
      });
      expect(view).toEqual(studentView(task!, `seed:${i}`));
    }
  });

  it("refuses both words and sentences, neither, one sentence alone, task-wide alternatives and another sentence's words", () => {
    const two = [{ words: ["a", "b"] }, { words: ["c", "d"] }];
    for (const task of [
      { words: ["a", "b"], sentences: two },
      {},
      { sentences: [{ words: ["a", "b"] }] },
      { sentences: two, alternatives: [["b", "a"]] },
      { sentences: [{ words: ["a", "b"], alternatives: [["c", "d"]] }, { words: ["c", "d"] }] },
    ]) {
      expect(parseHomework(homework(task)).ok).toBe(false);
    }
    expect(parseHomework(homework({ sentences: [{ words: ["a", "b"], alternatives: [["b", "a"]] }, { words: ["c", "d"] }] })).ok).toBe(true);
  });

  it("is answered when every sentence is placed in full", () => {
    const task: StudentTask = { type: "order", prompt: "p", sentences: [["a", "b"], ["c", "d"]] };
    expect(isAnswered(task, { type: "order", sentences: [["b", "a"], ["d", "c"]] })).toBe(true);
    expect(isAnswered(task, { type: "order", sentences: [["b", "a"], ["d"]] })).toBe(false);
    expect(isAnswered(task, { type: "order", words: ["a", "b"] })).toBe(false);
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

describe("a picture by each gap (#181)", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const gapTask = (gapImages: unknown[]) =>
    parseHomework(
      JSON.stringify({ version: 1, title: "t", tasks: [{ type: "gap", prompt: "p", text: "1 ___\n2 ___\n3 ___", answers: [["a"], ["b"], ["c"]], gapImages }] }),
    );

  it("takes a picture or null per gap, listed and addressed in order, and the student gets them", () => {
    const parsed = gapTask([PNG, null, PNG]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [task] = parsed.homework.tasks;
    expect(partPictures(task!).map((p) => p.place)).toEqual(["пропуск 1", "пропуск 3"]);
    expect(withPartPictures(task!, (_, n) => `/picture/${n}`)).toMatchObject({ gapImages: ["/picture/0", null, "/picture/1"] });
    expect(studentView(task!, "seed")).toMatchObject({ type: "gap", gapImages: [PNG, null, PNG] });
    expect(JSON.stringify(studentView(task!, "seed"))).not.toContain('"answers"');
  });

  it("refuses a picture count unlike the gaps and a GIF, naming the gap", () => {
    expect(gapTask([PNG, PNG])).toMatchObject({ ok: false, errors: [expect.stringMatching(/^Задание 1, поле gapImages: по картинке или null/)] });
    expect(gapTask([PNG, "data:image/gif;base64,R0lGODlh", null])).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/^Задание 1, пропуск 2: картинка — PNG, JPEG или WebP/)],
    });
  });
});

describe("pictures to match sentences to (#184)", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const matchTask = (pairs: unknown[]) => parseHomework(JSON.stringify({ version: 1, title: "t", tasks: [{ type: "match", prompt: "p", pairs }] }));

  it("puts pictures on the left, named for the answer, and the student gets them in the left's order", () => {
    const parsed = matchTask([
      { left: { images: [PNG] }, right: "one" },
      { left: { images: [PNG], text: "Tom" }, right: "two" },
      { left: "text", right: "three" },
    ]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [task] = parsed.homework.tasks;
    expect(partPictures(task!).map((p) => p.place)).toEqual(["пара 1, картинка 1", "пара 2, картинка 1"]);
    const view = studentView(task!, "seed");
    expect(view).toMatchObject({ type: "match", left: ["картинка 1", "Tom", "text"], leftImages: [[PNG], [PNG], null] });
    expect(withPartPictures(view, (_, n) => `/picture/${n}`)).toMatchObject({ leftImages: [["/picture/0"], ["/picture/1"], null] });
  });

  it("refuses a GIF naming the pair, a picture on the right, and two lefts alike when there are pictures", () => {
    expect(matchTask([{ left: "a", right: "one" }, { left: { images: ["data:image/gif;base64,R0lGODlh"] }, right: "two" }])).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/^Задание 1, пара 2, картинка 1: картинка — PNG, JPEG или WebP/)],
    });
    expect(matchTask([{ left: "a", right: { images: [PNG] } }, { left: "b", right: "two" }]).ok).toBe(false);
    expect(matchTask([{ left: { images: [PNG], text: "same" }, right: "one" }, { left: "same", right: "two" }]).ok).toBe(false);
    // Text-only tasks are as before.
    expect(matchTask([{ left: "same", right: "one" }, { left: "same", right: "two" }]).ok).toBe(true);
  });
});

describe("a table (#186)", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const tableTask = (task: object) => parseHomework(JSON.stringify({ version: 1, title: "t", tasks: [{ type: "table", prompt: "p", ...task }] }));
  const good = {
    header: ["", { images: [PNG], text: "A" }, "B"],
    rows: [
      ["red?", { mark: "yes" }, "✗"],
      ["colour", { gap: ["red"] }, ""],
    ],
  };

  it("lists its blanks in reading order, and the student gets the grid without keys", () => {
    const parsed = tableTask(good);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [task] = parsed.homework.tasks;
    expect(task!.type === "table" && tableBlanks(task!).map(({ row, column }) => [row, column])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(partPictures(task!).map((p) => p.place)).toEqual(["шапка, столбец 2, картинка 1"]);
    const view = studentView(task!, "seed");
    expect(view).toMatchObject({
      type: "table",
      rows: [
        ["red?", { blank: "mark" }, "✗"],
        ["colour", { blank: "text" }, ""],
      ],
    });
    expect(JSON.stringify(view)).not.toMatch(/"mark":|"gap":|"red"/);
    expect(isAnswered(view, { type: "table", cells: ["yes", "red"] })).toBe(true);
    expect(isAnswered(view, { type: "table", cells: ["yes", " "] })).toBe(false);
  });

  it("refuses a row unlike the header, no blank, another mark and a GIF in the header, naming the cell", () => {
    expect(tableTask({ ...good, rows: [["a", { gap: ["b"] }]] }).ok).toBe(false);
    expect(tableTask({ header: ["a"], rows: [["b"]] }).ok).toBe(false);
    expect(tableTask({ header: ["a"], rows: [[{ mark: "maybe" }]] })).toMatchObject({ ok: false, errors: [expect.stringMatching(/^Задание 1, строка 1, столбец 1/)] });
    expect(tableTask({ header: ["a", { images: ["data:image/gif;base64,R0lGODlh"] }], rows: [["b", { gap: ["c"] }]] })).toMatchObject({
      ok: false,
      errors: [expect.stringMatching(/^Задание 1, шапка, столбец 2, картинка 1: картинка — PNG, JPEG или WebP/)],
    });
  });
});
