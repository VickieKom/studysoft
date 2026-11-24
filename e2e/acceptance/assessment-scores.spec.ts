// Acceptance for #254: writing and speaking scored by the teacher, by the
// same three criteria every month — «Решение задачи», «Связность», «Язык»,
// each «0 — не справился», «1 — частично» or «2 — справился»; the section's
// percent is the sum of six. The other sections get the percent right by the
// automatic check. Once the assessment is ended («Завершить замер»), the
// teacher reads the child's text and scores both sections on the card; the
// assessment then has a percent for each of its skills. «Записать в
// прогресс» writes them into «Прогресс» at the day it was ended; before it,
// «Прогресс» shows nothing of them, and after it the scores no longer change
// (product owner, 2026-11-24).
//
// Pinned by integration tests: the percents (unit tests), a section the child
// did not start has no percent and writes nothing, another teacher's
// assessment is not found, the date and the results of that date entered by
// hand.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// student's are Moscow. The texts and the recording are synthetic.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

// A student's browser has no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

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

const assessment = (title: string) => ({
  version: 1,
  title,
  sections: [
    {
      skill: "listening",
      questions: [{ question: "Where does the demo bus go?", options: ["to the lake", "to the hill", "to the farm"], answer: 2 }],
    },
    {
      skill: "reading",
      text: READING,
      questions: [{ type: "choice", question: "What colour is the box?", options: ["red", "blue", "green"], answer: 1 }],
    },
    { skill: "grammar", text: "Yesterday Pim ___ to the box.", gaps: [{ options: ["walk", "walked", "walks"], answer: 1 }] },
    { skill: "vocabulary", questions: [{ type: "translation", translation: "камешек", answers: ["pebble"] }] },
    { skill: "writing", task: "Write a note to Pim about your weekend (30–60 words)." },
    { skill: "speaking", questions: ["What can you see in the picture?", "What is the robot doing?"] },
  ],
});

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Creates a student in Moscow; returns the card's address and the student's link. */
async function createStudent(page: Page, firstName: string): Promise<{ card: string; link: string }> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return { card, link: await page.evaluate(() => navigator.clipboard.readText()) };
}

/** «+ Урок» for today, five minutes ago in Moscow: a lesson going on now. */
async function addLessonNow(page: Page, firstName: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() - 5 * 60_000));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(`${part("year")}-${part("month")}-${part("day")}`);
  await page.getByLabel("Время", { exact: true }).fill(`${part("hour")}:${part("minute")}`);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
}

/** Today in Moscow, as the week names its day: «понедельник, 23 ноября». */
function todayLabel(): string {
  const iso = new Date(Date.now() - 5 * 60_000).toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/**
 * Cancels the lesson going on now, so it does not go on for the scenarios
 * that run after this one: a game page, for one, offers a lesson going on
 * instead of the students' words.
 */
async function cancelLessonNow(page: Page, firstName: string) {
  await page.goto("/teacher/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
  const day = page.getByRole("region", { name: todayLabel() });
  await day.getByRole("button", { name: new RegExp(firstName) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Отменить", exact: true }).click();
  await dialog.getByRole("button", { name: "Отменить урок", exact: true }).click();
  await expect(day.getByRole("button", { name: new RegExp(firstName) })).toContainText("отменён");
}

/** On the card: an approved assessment, imported with its recording for «Аудирование». */
async function approvedAssessment(page: Page, card: string, title: string): Promise<Locator> {
  await page.goto(card);
  const region = page.getByRole("region", { name: "Замеры" });
  await region.getByRole("button", { name: "Импортировать замер", exact: true }).click();
  await region.getByLabel("JSON замера").fill(JSON.stringify(assessment(title)));
  await region.getByRole("button", { name: "Импортировать", exact: true }).click();
  const draft = region.getByRole("group", { name: title });
  await draft
    .getByRole("region", { name: "Аудирование", exact: true })
    .getByLabel("Запись для аудирования", { exact: true })
    .setInputFiles({ name: "listening.wav", mimeType: "audio/wav", buffer: silence() });
  await expect(draft.getByRole("region", { name: "Аудирование", exact: true }).locator("audio")).toHaveCount(1);
  await draft.getByRole("button", { name: "Утвердить", exact: true }).click();
  await expect(draft).toContainText("Утверждён");
  return draft;
}

/** Opens a link in a fresh browser without any session, as the student would, and waits for their page. */
async function openAsStudent(browser: Browser, link: string, firstName: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect(page.getByText(firstName)).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

/** «Материалы урока» → «Замер» → the assessment. */
async function openAssessment(student: Page, title: string) {
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: /^Материалы урока/ }).click();
  await expect(student.getByRole("heading", { level: 1, name: "Материалы урока" })).toBeVisible();
  await student.getByRole("region", { name: "Замер" }).getByRole("link", { name: title }).click();
  await expect(student.getByRole("heading", { level: 1, name: title })).toBeVisible();
}



/** Scores a section on «Проверка»: the three criteria, then «Сохранить оценку». */
async function score(check: Locator, section: string, picks: [string, string, string]) {
  const region = check.getByRole("region", { name: section, exact: true });
  const criteria = ["Решение задачи", "Связность", "Язык"];
  for (const [i, criterion] of criteria.entries()) {
    await region.getByRole("radiogroup", { name: criterion, exact: true }).getByRole("radio", { name: picks[i], exact: true }).check();
  }
  await region.getByRole("button", { name: "Сохранить оценку", exact: true }).click();
  await expect(region).toContainText("Оценка сохранена");
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("an ended assessment is scored by the criteria, has a percent per skill, and «Записать в прогресс» puts them into «Прогресс»", async ({
  page,
  browser,
}) => {
  const { card, link } = await createStudent(page, "Оценивается замер");
  await addLessonNow(page, "Оценивается замер");
  const approved = await approvedAssessment(page, card, "Scored check");
  await approved.getByRole("button", { name: "Открыть ученику", exact: true }).click();
  await expect(approved).toContainText("Открыт ученику");

  // The child answers: listening, reading and grammar right, the word wrong, and a note.
  const student = await openAsStudent(browser, link, "Оценивается замер");
  await openAssessment(student, "Scored check");
  await student.getByRole("radio", { name: "to the farm", exact: true }).check();
  await control(student, "Дальше").click();
  await student.getByRole("radio", { name: "blue", exact: true }).check();
  await control(student, "Дальше").click();
  await student.getByLabel("Пропуск 1").selectOption({ label: "walked" });
  await control(student, "Дальше").click();
  await student.getByLabel("камешек").fill("rock");
  await control(student, "Дальше").click();
  await student.getByLabel("Ответ").fill("Dear Pim, at the weekend I walked to the demo lake with my family.");
  await control(student, "Дальше").click();
  await control(student, "Сдать").click();
  await expect(student.getByText("Готово!")).toBeVisible();
  await student.context().close();

  // Not ended yet: nothing to score.
  await page.goto(card);
  const assessmentGroup = page.getByRole("region", { name: "Замеры" }).getByRole("group", { name: "Scored check" });
  await expect(assessmentGroup.getByRole("region", { name: "Проверка", exact: true })).toHaveCount(0);
  await assessmentGroup.getByRole("button", { name: "Завершить замер", exact: true }).click();
  await expect(assessmentGroup).toContainText("Завершён");

  // The teacher reads the text and scores writing and speaking.
  const check = assessmentGroup.getByRole("region", { name: "Проверка", exact: true });
  await expect(check.getByRole("region", { name: "Письмо", exact: true })).toContainText("at the weekend I walked to the demo lake");
  const results = check.getByRole("list", { name: "Результаты по навыкам" });
  await expect(results.getByRole("listitem")).toHaveText(["Аудирование — 100%", "Чтение — 100%", "Грамматика — 100%", "Лексика — 0%"]);
  await score(check, "Письмо", ["2 — справился", "1 — частично", "1 — частично"]);
  // Speaking not scored yet: not complete, nothing to write.
  await expect(check.getByRole("button", { name: "Записать в прогресс", exact: true })).toBeDisabled();
  await score(check, "Говорение", ["2 — справился", "2 — справился", "1 — частично"]);
  await expect(results.getByRole("listitem")).toHaveText([
    "Аудирование — 100%",
    "Чтение — 100%",
    "Грамматика — 100%",
    "Лексика — 0%",
    "Письмо — 67%",
    "Говорение — 83%",
  ]);

  // Before «Записать в прогресс», «Прогресс» shows nothing of them.
  const progress = page.getByRole("region", { name: "Прогресс" });
  await expect(progress).toContainText("Результатов по навыкам пока нет");
  await check.getByRole("button", { name: "Записать в прогресс", exact: true }).click();
  await expect(check).toContainText("Записано в прогресс");
  await expect(check.getByRole("button", { name: "Записать в прогресс", exact: true })).toHaveCount(0);
  // Frozen: corrected in «Прогресс», no longer here.
  await expect(check.getByRole("button", { name: "Сохранить оценку", exact: true })).toHaveCount(0);

  const skills = progress.getByRole("table", { name: "Навыки по месяцам" });
  const row = (skill: string) => skills.getByRole("row").filter({ has: page.getByRole("rowheader", { name: skill, exact: true }) });
  await expect(row("Письмо")).toContainText("67%");
  await expect(row("Говорение")).toContainText("83%");
  await expect(row("Лексика")).toContainText("0%");
  await expect(row("Чтение")).toContainText("100%");

  await cancelLessonNow(page, "Оценивается замер");
});
