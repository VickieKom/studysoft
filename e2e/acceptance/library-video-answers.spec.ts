// Acceptance for #327: the student answers a video's tasks under it. The
// student watches a video on their own device (#158), so «Открыть ученику»
// on a video opens it together with its confirmed tasks (#326), during a
// lesson and an hour after. Under the video the student answers: one
// attempt, «Готово», then praise only — no score, no right answers — as in
// homework (#227; product owner, 2026-11-23). The score is shown nowhere in
// this slice, to the teacher neither: she sees the mistakes on the card, and
// reviews the answers on the stage with #328.
// The answers are checked on the server; the mistakes join «Ошибки по темам»
// on the card, marked «Видео: <title>». A video without confirmed tasks shows
// the video only. That no key reaches the student before «Готово», and that
// after the access ends the tasks are closed with the answers kept, are
// pinned by integration tests.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// student's are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago. The video files are synthetic: the browser records
// a second of a moving square on a canvas, as in #117. The tasks are saved by
// the assistant over HTTP with the teacher's token and confirmed by her, as
// in #326; they are synthetic, written here.
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

// The student's browser and the assistant have no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// One token per teacher, and the student and videos of one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

const WITH_TASKS = "Robot morning clip";
const PRAISE = "Готово! Ответы отправлены, учитель посмотрит";
const WITHOUT_TASKS = "Robot evening clip";

const TRUE_FALSE = ["True", "False"];
const TASKS = {
  version: 1,
  title: "Robot morning",
  tasks: [
    { type: "single_choice", prompt: "The robot wakes up at seven.", options: TRUE_FALSE, answer: 0, topic: "robot's morning" },
    { type: "single_choice", prompt: "The robot drinks milk.", options: TRUE_FALSE, answer: 1, topic: "robot's morning" },
    { type: "single_choice", prompt: "The robot walks to the blue box.", options: TRUE_FALSE, answer: 0, topic: "robot's morning" },
  ],
};

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

function materials(page: Page): Locator {
  return page.getByRole("list", { name: "Материалы" }).getByRole("listitem");
}

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Creates a student in Moscow; returns their card's address and their link. */
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

/** Opens a link in a fresh browser without any session, as the student would, and waits for their page. */
async function openAsStudent(browser: Browser, link: string, firstName: string): Promise<Page> {
  const context = await browser.newContext({ storageState: NO_SESSION });
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByText(firstName)).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

/** «+ Урок» for today, five minutes ago in Moscow: a lesson going on now. */
async function addLessonNow(page: Page, firstName: string) {
  const startedAt = new Date(Date.now() - 5 * 60_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(startedAt);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(`${part("year")}-${part("month")}-${part("day")}`);
  await page.getByLabel("Время", { exact: true }).fill(`${part("hour")}:${part("minute")}`);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  // Saved before the scenario moves on: the form has closed and «+ Урок» is back.
  await expect(control(page, "+ Урок")).toBeVisible();
}

/** A second of a moving square, recorded by the browser as WebM. */
async function recordClip(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    let frame = 0;
    const draw = () => {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 64, 64);
      context.fillStyle = "#1565c0";
      context.fillRect(frame % 48, 16, 16, 16);
      frame += 2;
    };
    draw();
    const timer = setInterval(draw, 40);
    const recorder = new MediaRecorder(canvas.captureStream(25), { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    recorder.stop();
    await stopped;
    clearInterval(timer);
    const bytes = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  return Buffer.from(base64, "base64");
}

/** Uploads an own video to the library; returns its id. */
async function uploadVideo(page: Page, title: string): Promise<string> {
  await page.goto("/teacher/library");
  const clip = await recordClip(page);
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Видео" });
  await page.getByLabel("Источник видео").selectOption({ label: "Файл" });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("video answers");
  await page.getByLabel("Файл видео").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: clip });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible({ timeout: 30_000 });
  await openInLibrary(page, title);
  return page.url().match(/[0-9a-f-]{36}/)![0];
}

async function openInLibrary(page: Page, title: string) {
  await page.goto("/teacher/library");
  await materials(page).filter({ hasText: title }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

/** The assistant saves the tasks, and the teacher confirms them on the video's page (#326). */
async function confirmTasks(page: Page, assistant: APIRequestContext, videoId: string, title: string) {
  const token = await createToken(page);
  const saved = await assistant.post("/api/trpc/agent.saveVideoTasksDraft", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: JSON.stringify({ videoId, tasks: TASKS }),
  });
  expect(saved.status()).toBe(200);
  await openInLibrary(page, title);
  await page.getByRole("region", { name: "Задания к видео" }).getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("region", { name: "Задания к видео" })).toContainText("Подтверждено");
}

/** On the video's page in «Библиотека»: «Открыть ученику» to this student. */
async function openToStudent(page: Page, title: string, firstName: string) {
  await openInLibrary(page, title);
  await control(page, "Открыть ученику").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(page.getByText(new RegExp(`Открыто ученику: ${firstName}`))).toBeVisible();
}

/** The student's video page, from «Видео» in «Материалы урока» (#241). */
async function studentVideo(student: Page, title: string) {
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: /^Материалы урока/ }).click();
  await expect(student.getByRole("heading", { level: 1, name: "Материалы урока" })).toBeVisible();
  await student.getByRole("region", { name: "Видео" }).getByRole("link", { name: title }).click();
  await expect(student.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/** One task under the video, by its statement. */
function task(student: Page, prompt: string): Locator {
  return student.getByRole("region", { name: "Задания к видео" }).getByRole("listitem").filter({ hasText: prompt });
}

let viewer: { card: string; link: string };

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("the student answers the video's tasks under it and gets praise only: no score, no right answers", async ({ page, browser, assistant }) => {
  viewer = await createStudent(page, "Смотрящий");
  await addLessonNow(page, "Смотрящий");
  const videoId = await uploadVideo(page, WITH_TASKS);
  await confirmTasks(page, assistant, videoId, WITH_TASKS);
  await openToStudent(page, WITH_TASKS, "Смотрящий");

  const student = await openAsStudent(browser, viewer.link, "Смотрящий");
  await studentVideo(student, WITH_TASKS);
  await expect(student.getByRole("main").locator("video")).toHaveCount(1);
  const tasks = student.getByRole("region", { name: "Задания к видео" });
  await expect(tasks.getByRole("listitem")).toHaveCount(3);

  // Two right, one wrong: the robot drinks no milk, but the student says it does.
  await task(student, "The robot wakes up at seven.").getByRole("button", { name: "True", exact: true }).click();
  await task(student, "The robot drinks milk.").getByRole("button", { name: "True", exact: true }).click();
  await task(student, "The robot walks to the blue box.").getByRole("button", { name: "True", exact: true }).click();
  await tasks.getByRole("button", { name: "Готово", exact: true }).click();

  await expect(tasks).toContainText(PRAISE);
  // One attempt, praise only: no score, nothing marked right or wrong, nothing to press.
  await expect(tasks.getByRole("button", { name: "Готово", exact: true })).toHaveCount(0);
  expect(await tasks.innerText()).not.toMatch(/\d|верно|неверно|правильн/i);
  await student.reload();
  const after = student.getByRole("region", { name: "Задания к видео" });
  await expect(after).toContainText(PRAISE);
  await expect(after.getByRole("button", { name: "Готово", exact: true })).toHaveCount(0);
  expect(await after.innerText()).not.toMatch(/\d|верно|неверно|правильн/i);
  await student.context().close();
});

test("the wrong answer shows in «Ошибки по темам» on the card, from the video", async ({ page }) => {
  await page.goto(viewer.card);
  const mistakes = page.getByRole("region", { name: "Ошибки по темам" });
  const topic = mistakes.getByRole("listitem").filter({ has: page.getByText("robot's morning", { exact: true }) });
  await expect(topic).toContainText("The robot drinks milk.");
  await expect(topic).toContainText(`Видео: ${WITH_TASKS}`);
  await expect(topic).not.toContainText("The robot wakes up at seven.");
});

test("a video without confirmed tasks shows the video only", async ({ page, browser }) => {
  await uploadVideo(page, WITHOUT_TASKS);
  await openToStudent(page, WITHOUT_TASKS, "Смотрящий");

  const student = await openAsStudent(browser, viewer.link, "Смотрящий");
  await studentVideo(student, WITHOUT_TASKS);
  await expect(student.getByRole("main").locator("video")).toHaveCount(1);
  await expect(student.getByRole("region", { name: "Задания к видео" })).toHaveCount(0);
  await student.context().close();
});
