import { describe, expect, it } from "vitest";
import { taskSchema } from "./homework-format";
import { canChooseTranslation, choicePrompt, GAP_PROMPT, MATCH_PROMPT, type PickWord, typePrompt, vocabularyTasks, withKnownWords } from "./vocabulary-homework";

// «Из словаря» (#281): tasks built from the student's words. The words are synthetic.

const word = (n: number, translation = `перевод${n}`): PickWord => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, word: `word${n}`, translation });
const words = (count: number) => Array.from({ length: count }, (_, i) => word(i + 1));

describe("tasks from the vocabulary", () => {
  it("puts the words in matching tasks of at most 8 pairs, as even as can be", () => {
    for (const [count, sizes] of [[2, [2]], [8, [8]], [9, [5, 4]], [17, [6, 6, 5]]] as const) {
      const tasks = vocabularyTasks(words(count), words(count), ["match"]);
      expect(tasks.map((t) => (t.type === "match" ? t.pairs.length : 0))).toEqual(sizes);
      for (const task of tasks) expect(taskSchema.safeParse(task).success).toBe(true);
    }
    const [task] = vocabularyTasks(words(2), words(2), ["match"]);
    expect(task).toEqual({
      type: "match",
      prompt: MATCH_PROMPT,
      pairs: [
        { left: "word1", right: "перевод1" },
        { left: "word2", right: "перевод2" },
      ],
      skill: "vocabulary",
      vocabularyWords: [word(1).id, word(2).id],
    });
  });

  it("asks each word's translation among four, the key pointing at it, the others from the student's other words", () => {
    const pool = words(6);
    const tasks = vocabularyTasks(pool.slice(0, 2), pool, ["choose_translation"], () => 0.3);
    expect(tasks).toHaveLength(2);
    for (const [index, task] of tasks.entries()) {
      if (task.type !== "single_choice") throw new Error("not a choice");
      expect(task.prompt).toBe(choicePrompt(`word${index + 1}`));
      expect(task.options).toHaveLength(4);
      expect(new Set(task.options).size).toBe(4);
      expect(task.options[task.answer]).toBe(`перевод${index + 1}`);
      expect(task.vocabularyWords).toEqual([word(index + 1).id]);
      expect(taskSchema.safeParse(task).success).toBe(true);
    }
  });

  it("needs four different translations for a choice and two words for matching; it leaves out what it cannot build", () => {
    expect(canChooseTranslation(words(3))).toBe(false);
    // Two words with one translation are one option.
    expect(canChooseTranslation([...words(3), word(4, "перевод1")])).toBe(false);
    expect(canChooseTranslation(words(4))).toBe(true);
    expect(vocabularyTasks(words(3), words(3), ["match", "choose_translation"]).map((t) => t.type)).toEqual(["match"]);
    expect(vocabularyTasks(words(1), words(4), ["match", "choose_translation"]).map((t) => t.type)).toEqual(["single_choice"]);
  });

  it("keeps a task's known words only, and the task without words when none is known", () => {
    const [match, choice] = vocabularyTasks(words(4), words(4), ["match", "choose_translation"]);
    const [kept, plain] = withKnownWords([match!, choice!], new Set([word(2).id, word(3).id]));
    expect(kept!.vocabularyWords).toEqual([word(2).id, word(3).id]);
    expect(plain).not.toHaveProperty("vocabularyWords");
    expect(plain!.prompt).toBe(choice!.prompt);
  });

  it("gaps each word in its example where the example uses it as it is, and skips the others (#283)", () => {
    const chosen = [
      { ...word(1), word: "teapot", example: "The Teapot is hot." },
      { ...word(2), word: "pebble", example: "Pebbles are round." },
      { ...word(3), word: "ladder", example: null },
      { ...word(4), word: "ice cream", example: "I like ice  cream." },
    ];
    const tasks = vocabularyTasks(chosen, chosen, ["fill_gap"]);
    expect(tasks).toEqual([
      { type: "gap", prompt: GAP_PROMPT, text: "The ___ is hot.", answers: [["teapot"]], skill: "vocabulary", words: [chosen[0]!.id] },
      { type: "gap", prompt: GAP_PROMPT, text: "I like ___.", answers: [["ice cream"]], skill: "vocabulary", words: [chosen[3]!.id] },
    ]);
    for (const task of tasks) expect(taskSchema.safeParse(task).success).toBe(true);
  });

  it("asks each word written from its translation (#283)", () => {
    const tasks = vocabularyTasks(words(2), words(2), ["type_word"]);
    expect(tasks).toEqual([1, 2].map((n) => ({ type: "gap", prompt: typePrompt(`перевод${n}`), text: "___", answers: [[`word${n}`]], skill: "vocabulary", words: [word(n).id] })));
    for (const task of tasks) expect(taskSchema.safeParse(task).success).toBe(true);
  });
});
