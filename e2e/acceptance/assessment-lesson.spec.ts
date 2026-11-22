// Acceptance for #253: the monthly assessment in a lesson, behind the
// student's link. While a lesson with the student is going on, the teacher
// opens an approved assessment to the child — on the card in «Замеры» or on
// the lesson panel (product owner, 2026-11-22). The child finds it in
// «Материалы урока» under «Замер» and goes section by section, each titled
// with its skill, in the format's order; they may go back and change an
// answer until «Сдать». Answers are kept as they go. The recording of
// «Аудирование» plays at most twice. «Говорение» shows the questions; the
// child answers live, and the teacher records on her panel with «Записать»
// and «Остановить»: the recording is kept with the assessment. «Сдать» gives
// «Готово!» without a score.
//
// The rest is pinned by integration tests: closed after the lesson with the
// answers kept and continued in a later one, «Завершить замер», a wrong
// «Лексика» answer due tomorrow, and nothing of the keys, the scores or the
// speaking recording for the child.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// students' are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago. The texts and the recordings are synthetic; the
// teacher's microphone is the browser's fake one (playwright.config.ts).
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

// A student's browser has no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const SECTIONS = ["Аудирование", "Чтение", "Грамматика", "Лексика", "Письмо", "Говорение"];

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

/** The section the child is on: its heading names the skill. */
const current = (student: Page) => student.getByRole("heading", { level: 2 });

/** Plays the recording of «Аудирование» to its end, muted. */
async function playToEnd(student: Page) {
  const audio = student.getByRole("main").locator("audio");
  await audio.evaluate(async (element: HTMLAudioElement) => {
    element.muted = true;
    const ended = new Promise((resolve) => element.addEventListener("ended", resolve, { once: true }));
    element.currentTime = 0;
    await element.play();
    await ended;
  });
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("opened on the card in a lesson, the assessment is taken by the link section by section and ends in «Готово!» without a score", async ({
  page,
  browser,
}) => {
  const { card, link } = await createStudent(page, "Проходит замер");
  await addLessonNow(page, "Проходит замер");
  const approved = await approvedAssessment(page, card, "Monthly check");

  // Not opened yet: nothing in «Материалы урока».
  const before = await openAsStudent(browser, link, "Проходит замер");
  await before.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: /^Материалы урока/ }).click();
  await expect(before.getByRole("region", { name: "Замер" })).toHaveCount(0);
  await before.context().close();

  await approved.getByRole("button", { name: "Открыть ученику", exact: true }).click();
  await expect(approved).toContainText("Открыт ученику");

  const student = await openAsStudent(browser, link, "Проходит замер");
  await openAssessment(student, "Monthly check");

  // «Аудирование» first; the recording plays twice, then no more.
  await expect(current(student)).toHaveText("Аудирование");
  await expect(student.getByText("Осталось прослушиваний: 2")).toBeVisible();
  await playToEnd(student);
  await expect(student.getByText("Осталось прослушиваний: 1")).toBeVisible();
  await playToEnd(student);
  await expect(student.getByText("Запись прослушана дважды")).toBeVisible();
  await expect(student.getByRole("main").locator("audio")).toHaveCount(0);
  await student.getByRole("radio", { name: "to the hill", exact: true }).check();

  // Section by section, in the format's order.
  const seen = ["Аудирование"];
  for (const section of SECTIONS.slice(1)) {
    await control(student, "Дальше").click();
    await expect(current(student)).toHaveText(section);
    seen.push(section);
    if (section === "Чтение") {
      await expect(student.getByRole("main")).toContainText("the demo robot Pim walks to the blue box");
      await student.getByRole("radio", { name: "blue", exact: true }).check();
    }
    if (section === "Грамматика") await student.getByLabel("Пропуск 1").selectOption({ label: "walked" });
    if (section === "Лексика") await student.getByLabel("камешек").fill("pebble");
    if (section === "Письмо") await student.getByLabel("Ответ").fill("Dear Pim, at the weekend I walked to the demo lake with my family.");
    if (section === "Говорение") await expect(student.getByRole("main")).toContainText("What is the robot doing?");
  }
  expect(seen).toEqual(SECTIONS);

  // Back to «Аудирование» to change the answer: kept as it goes, after a reload too, and the plays stay used.
  for (let i = 0; i < SECTIONS.length - 1; i++) await control(student, "Назад").click();
  await expect(current(student)).toHaveText("Аудирование");
  await student.getByRole("radio", { name: "to the farm", exact: true }).check();
  await student.reload();
  await expect(current(student)).toHaveText("Аудирование");
  await expect(student.getByRole("radio", { name: "to the farm", exact: true })).toBeChecked();
  await expect(student.getByText("Запись прослушана дважды")).toBeVisible();

  // «Сдать» on the last section: praise, no score, no keys.
  for (let i = 0; i < SECTIONS.length - 1; i++) await control(student, "Дальше").click();
  await expect(current(student)).toHaveText("Говорение");
  await control(student, "Сдать").click();
  await expect(student.getByText("Готово!")).toBeVisible();
  const text = await student.locator("body").innerText();
  expect(text).not.toMatch(/\d+\s*%|из \d+|верно|неверно/i);
  await student.context().close();
});

test("opened on the lesson panel, «Говорение» is recorded there with «Записать» and «Остановить» and kept with the assessment", async ({
  page,
  browser,
}) => {
  const { card, link } = await createStudent(page, "Говорит на замере");
  await addLessonNow(page, "Говорит на замере");
  await approvedAssessment(page, card, "Speaking check");

  // The lesson going on now: its preparation, then «Запустить урок».
  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: "Говорит на замере" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();

  const panel = page.getByRole("region", { name: "Замер" });
  await panel.getByLabel("Замер ученика").selectOption({ label: "Speaking check" });
  await panel.getByRole("button", { name: "Открыть ученику", exact: true }).click();
  await expect(panel).toContainText("Открыт ученику");

  // The child sees the speaking questions on their page.
  const student = await openAsStudent(browser, link, "Говорит на замере");
  await openAssessment(student, "Speaking check");
  for (let i = 0; i < SECTIONS.length - 1; i++) await control(student, "Дальше").click();
  await expect(current(student)).toHaveText("Говорение");
  await expect(student.getByRole("main")).toContainText("What can you see in the picture?");

  // The teacher records the answers from her microphone.
  await panel.getByRole("button", { name: "Записать", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Остановить", exact: true })).toBeVisible();
  await page.waitForTimeout(1500);
  await panel.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(panel.getByLabel("Запись говорения", { exact: true })).toBeVisible();

  // The child never gets the recording.
  await student.reload();
  await expect(student.getByRole("main").locator("audio")).toHaveCount(0);
  await student.context().close();
  await stage.close();

  // Kept with the assessment: the card plays it.
  await page.goto(card);
  const kept = page.getByRole("region", { name: "Замеры" }).getByRole("group", { name: "Speaking check" });
  await expect(kept.getByLabel("Запись говорения", { exact: true })).toBeVisible();
});
