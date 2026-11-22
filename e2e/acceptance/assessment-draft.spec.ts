// Acceptance for #252: the monthly assessment's draft on the card. An
// assessment imported in «Замеры» shows by section, in the order of the
// format, as the child will see it and without its keys. «Утвердить» says
// the recording for «Аудирование» is missing until the teacher uploads it;
// she removes a question and approves: «Утверждён», one question fewer, and
// nothing left to change. A draft that fails the format is refused, naming
// the section, the question and the field, and nothing is saved. That no
// student or parent procedure returns an assessment's keys is pinned by an
// integration test.
//
// The teacher starts signed in (sessions.setup.ts). The student, the texts
// and the recording are synthetic.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const SECTIONS = ["Аудирование", "Чтение", "Грамматика", "Лексика", "Письмо", "Говорение"];

/** One second of silence as a WAV file: 8 kHz, 8-bit, mono. */
function silence(): Buffer {
  const samples = 8000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 0x80)]);
}

/** A synthetic reading text of about 130 words. */
const READING = Array.from(
  { length: 7 },
  (_, i) => `Day ${i + 1}: the demo robot Pim walks to the blue box, opens it and counts the round stones inside.`,
).join(" ");

const assessment = {
  version: 1,
  title: "Demo assessment",
  sections: [
    {
      skill: "reading",
      text: READING,
      questions: [
        { type: "true_false", statement: "Pim is a robot.", answer: "true" },
        { type: "choice", question: "What colour is the box?", options: ["red", "blue", "green"], answer: 1 },
      ],
    },
    {
      skill: "listening",
      questions: [
        { question: "Where does the demo bus go?", options: ["to the lake", "to the hill", "to the farm"], answer: 2 },
        { question: "When does it leave?", options: ["at six", "at seven", "at eight"], answer: 0 },
      ],
    },
    { skill: "grammar", text: "Yesterday Pim ___ to the box and ___ the stones.", gaps: [{ options: ["walk", "walked", "walks"], answer: 1 }, { options: ["count", "counted", "counting"], answer: 1 }] },
    {
      skill: "vocabulary",
      questions: [
        { type: "translation", translation: "камешек", answers: ["pebble"] },
        { type: "sentence", text: "Pim keeps the stones in a ___.", answers: ["crate"] },
      ],
    },
    { skill: "writing", task: "Write a note to Pim about your weekend (30–60 words)." },
    { skill: "speaking", questions: ["What can you see in the picture?", "What is the robot doing?"] },
  ],
};

async function newStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await page.getByRole("link", { name: "Новый ученик", exact: true }).or(page.getByRole("button", { name: "Новый ученик", exact: true })).click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url();
}

async function importAssessment(page: Page, json: unknown) {
  const region = page.getByRole("region", { name: "Замеры" });
  await region.getByRole("button", { name: "Импортировать замер", exact: true }).click();
  await region.getByLabel("JSON замера").fill(JSON.stringify(json));
  await region.getByRole("button", { name: "Импортировать", exact: true }).click();
  return region;
}

test("an imported assessment shows by section without keys, waits for its recording, and is approved one question fewer", async ({ page }) => {
  const card = await newStudent(page, "Замеряемая");
  const region = await importAssessment(page, assessment);
  const draft = region.getByRole("group", { name: "Demo assessment" });
  await expect(draft).toContainText("Черновик");

  // By section, in the format's order whatever the order in the JSON.
  await expect(draft.getByRole("heading", { level: 3 })).toHaveText(SECTIONS);
  const section = (name: string) => draft.getByRole("region", { name, exact: true });
  await expect(section("Чтение")).toContainText("the demo robot Pim walks to the blue box");
  await expect(section("Чтение")).toContainText("Pim is a robot.");
  await expect(section("Чтение").getByText("Не сказано", { exact: true })).toBeVisible();
  await expect(section("Аудирование")).toContainText("to the farm");
  await expect(section("Грамматика")).toContainText("walked");
  await expect(section("Лексика")).toContainText("камешек");
  await expect(section("Письмо")).toContainText("Write a note to Pim");
  await expect(section("Говорение")).toContainText("What is the robot doing?");
  // As the child will see it: no keys of the typed answers.
  await expect(draft).not.toContainText("pebble");
  await expect(draft).not.toContainText("crate");

  // Without the recording «Утвердить» says it is missing, and the draft stays a draft.
  await draft.getByRole("button", { name: "Утвердить", exact: true }).click();
  await expect(draft.getByRole("alert")).toContainText("Нет записи для аудирования");
  await expect(draft).toContainText("Черновик");

  await section("Аудирование").getByLabel("Запись для аудирования", { exact: true }).setInputFiles({ name: "listening.wav", mimeType: "audio/wav", buffer: silence() });
  await expect(section("Аудирование").locator("audio")).toHaveCount(1);

  const vocabulary = section("Лексика").getByRole("listitem");
  await expect(vocabulary).toHaveCount(2);
  await vocabulary.filter({ hasText: "камешек" }).getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(vocabulary).toHaveCount(1);
  await expect(section("Лексика")).not.toContainText("камешек");

  await draft.getByRole("button", { name: "Утвердить", exact: true }).click();
  await expect(draft).toContainText("Утверждён");

  // Kept: approved, one question fewer, nothing left to change.
  await page.goto(card);
  const approved = page.getByRole("region", { name: "Замеры" }).getByRole("group", { name: "Demo assessment" });
  await expect(approved).toContainText("Утверждён");
  await expect(approved.getByRole("region", { name: "Лексика", exact: true }).getByRole("listitem")).toHaveCount(1);
  await expect(approved.getByRole("region", { name: "Аудирование", exact: true }).locator("audio")).toHaveCount(1);
  await expect(approved.getByRole("button", { name: "Убрать", exact: true })).toHaveCount(0);
  await expect(approved.getByRole("button", { name: "Утвердить", exact: true })).toHaveCount(0);
});

test("a draft that fails the format is refused, naming the section, the question and the field, and nothing is saved", async ({ page }) => {
  const card = await newStudent(page, "Неформатная");
  const broken = structuredClone(assessment);
  (broken.sections[3]!.questions![1] as { answers: string[] }).answers = [];
  const region = await importAssessment(page, broken);
  const message = region.getByRole("alert");
  await expect(message).toContainText("Лексика");
  await expect(message).toContainText("вопрос 2");
  await expect(message).toContainText("answers");

  await page.goto(card);
  await expect(page.getByRole("region", { name: "Замеры" })).toContainText("Замеров пока нет");
});
