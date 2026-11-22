import { describe, expect, it } from "vitest";
import { assessmentView, parseAssessment, validateAssessment, withoutQuestion, type AssessmentDocument } from "./assessment-format";

const READING = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: the demo robot walks to the blue box and back.`).join(" ");
const WORD = "00000000-0000-4000-8000-000000000001";

const full = {
  version: 1,
  title: "Demo",
  sections: [
    { skill: "speaking", questions: ["What can you see?"] },
    { skill: "writing", task: "Write a note (30–60 words)." },
    {
      skill: "vocabulary",
      questions: [
        { type: "translation", translation: "камешек", answers: ["pebble"], vocabularyWord: WORD },
        { type: "sentence", text: "A ___ of stones.", answers: ["crate", "box"] },
      ],
    },
    { skill: "grammar", text: "Pim ___ home and ___.", gaps: [{ options: ["go", "went"], answer: 1 }, { options: ["sleep", "slept", "sleeps"], answer: 1 }] },
    {
      skill: "reading",
      text: READING,
      questions: [
        { type: "true_false", statement: "The box is blue.", answer: "true" },
        { type: "choice", question: "Who walks?", options: ["a cat", "a robot", "a dog"], answer: 1 },
      ],
    },
    { skill: "listening", prompt: "Listen.", questions: [{ question: "Where?", options: ["here", "there", "nowhere"], answer: 0 }] },
  ],
};

const parsed = (input: unknown): AssessmentDocument => {
  const result = validateAssessment(input);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.assessment;
};

const errors = (input: unknown): string[] => {
  const result = validateAssessment(input);
  return result.ok ? [] : result.errors;
};

const withSection = (skill: string, patch: Record<string, unknown>) => ({
  ...full,
  sections: full.sections.map((s) => (s.skill === skill ? { ...s, ...patch } : s)),
});

describe("the assessment format (#252)", () => {
  it("takes the six sections and keeps them in the format's order, whatever the order in the JSON", () => {
    expect(parsed(full).sections.map((s) => s.skill)).toEqual(["listening", "reading", "grammar", "vocabulary", "writing", "speaking"]);
  });

  it("takes an assessment without some sections and with fewer questions than the form", () => {
    const short = { version: 1, title: "Short", sections: [full.sections[2]] };
    expect(parsed(short).sections.map((s) => s.skill)).toEqual(["vocabulary"]);
  });

  it("refuses what is not JSON, another version, a section twice and an unknown section", () => {
    expect(parseAssessment("{")).toEqual({ ok: false, errors: ["Это не JSON: проверьте скобки, кавычки и запятые"] });
    expect(errors({ ...full, version: 2 })).toEqual(["Поле version: поддерживается версия 1"]);
    expect(errors({ ...full, sections: [full.sections[0], full.sections[0]] })).toEqual(["Поле sections: каждый раздел — не больше одного раза"]);
    expect(errors({ ...full, sections: [{ skill: "spelling" }] })[0]).toBe(
      "Раздел 1: неизвестный раздел «spelling»; возможные: listening, reading, grammar, vocabulary, writing, speaking",
    );
  });

  it("names the section, the question and the field of a problem", () => {
    const vocabulary = full.sections[2] as { questions: Record<string, unknown>[] };
    const broken = withSection("vocabulary", { questions: [vocabulary.questions[0], { ...vocabulary.questions[1], answers: [] }] });
    expect(errors(broken)).toEqual([expect.stringMatching(/^Лексика, вопрос 2, поле answers: /)]);
    expect(errors(withSection("listening", { questions: [{ question: "Where?", options: ["a", "b", "c"], answer: 3 }] }))).toEqual([
      "Аудирование, вопрос 1, поле answer: нет варианта с таким номером",
    ]);
    expect(errors(withSection("grammar", { gaps: [{ options: ["go", "went"], answer: 1 }] }))).toEqual(["Грамматика, поле gaps: столько же пропусков, сколько ___ в тексте"]);
    expect(errors(withSection("grammar", { gaps: [{ options: ["go"], answer: 0 }, { options: ["a", "b"], answer: 0 }] }))[0]).toMatch(/^Грамматика, пропуск 1, поле options: /);
  });

  it("holds the form's counts as upper limits and the reading text to its length", () => {
    const question = { question: "Where?", options: ["a", "b", "c"], answer: 0 };
    expect(errors(withSection("listening", { questions: Array(6).fill(question) }))[0]).toMatch(/^Аудирование, поле questions: /);
    expect(errors(withSection("listening", { questions: [] }))[0]).toMatch(/^Аудирование, поле questions: /);
    const word = { type: "translation", translation: "дом", answers: ["house"] };
    expect(errors(withSection("vocabulary", { questions: Array(10).fill(word) }))).toEqual([]);
    expect(errors(withSection("vocabulary", { questions: Array(11).fill(word) }))[0]).toMatch(/^Лексика, поле questions: /);
    expect(errors(withSection("reading", { text: "Too short a text." }))).toEqual(["Чтение, поле text: текст на 80–250 слов"]);
    expect(errors(withSection("listening", { questions: [{ ...question, options: ["a", "b"] }] }))[0]).toMatch(/^Аудирование, вопрос 1, поле options: /);
  });

  it("wants one gap in a vocabulary sentence and a vocabulary link that is an id", () => {
    const vocabulary = full.sections[2] as { questions: Record<string, unknown>[] };
    expect(errors(withSection("vocabulary", { questions: [{ ...vocabulary.questions[1], text: "No gap here." }] }))).toEqual([
      "Лексика, вопрос 1, поле text: один пропуск ___ в предложении",
    ]);
    expect(errors(withSection("vocabulary", { questions: [{ ...vocabulary.questions[0], vocabularyWord: "pebble" }] }))[0]).toMatch(
      /^Лексика, вопрос 1, поле vocabularyWord: /,
    );
  });

  it("shows the assessment as the child will see it: no keys and no vocabulary links", () => {
    const view = assessmentView(parsed(full));
    const shown = JSON.stringify(view);
    for (const key of ["pebble", "crate", '"answer"', '"answers"', WORD, "not_given"]) expect(shown).not.toContain(key);
    expect(view.map((s) => [s.skill, s.removable])).toEqual([
      ["listening", true],
      ["reading", true],
      ["grammar", false],
      ["vocabulary", true],
      ["writing", false],
      ["speaking", true],
    ]);
    expect(view[1]?.questions).toEqual([
      { type: "true_false", statement: "The box is blue." },
      { type: "choice", question: "Who walks?", options: ["a cat", "a robot", "a dog"] },
    ]);
    expect(view[2]?.gaps).toEqual([
      ["go", "went"],
      ["sleep", "slept", "sleeps"],
    ]);
  });

  it("removes a question, the section with its last one, and never the assessment's last question", () => {
    const document = parsed(full);
    const fewer = withoutQuestion(document, "vocabulary", 0)!;
    expect(fewer.sections.find((s) => s.skill === "vocabulary")).toMatchObject({ questions: [{ type: "sentence" }] });
    expect(withoutQuestion(document, "listening", 0)!.sections.map((s) => s.skill)).not.toContain("listening");
    expect(withoutQuestion(document, "grammar", 0)).toBeNull();
    expect(withoutQuestion(document, "writing", 0)).toBeNull();
    expect(withoutQuestion(document, "vocabulary", 2)).toBeNull();
    expect(withoutQuestion(document, "vocabulary", -1)).toBeNull();
    const last = parsed({ version: 1, title: "One", sections: [{ skill: "speaking", questions: ["Why?"] }] });
    expect(withoutQuestion(last, "speaking", 0)).toBeNull();
    // What is left is still an assessment of the format.
    expect(validateAssessment(fewer).ok).toBe(true);
  });
});
