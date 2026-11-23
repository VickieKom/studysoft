// Acceptance for #328: a video's tasks and the student's answers on the
// lesson stage. After the student answers a video's tasks under it (#327),
// the teacher goes through them together on the stage, as she does with
// homework (#153): a «Видео» stage of the lesson's plan shows each task with
// the student's answer from this lesson, right or wrong; on the panel, «Все
// задания» / «Только ошибки» and «Показать ответ» per task. Before the
// student has answered, the stage shows the tasks without answers. The video
// itself does not play on the stage: it stutters over screen sharing.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// student's are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago, and prepared with the video as its only stage.
// The video file is synthetic, recorded by the browser as in #117; the tasks
// are saved by the assistant and confirmed by the teacher as in #326.
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
// One token per teacher, and the lessons of one scenario must not overlap another's.
test.describe.configure({ mode: "serial" });

const HINT = "В Телемосте покажите окно «Экран для ученика» и включите звук";
const PRAISE = "Готово! Ответы отправлены, учитель посмотрит";
const TRUE_FALSE = ["True", "False"];
const TASKS = {
  version: 1,
  title: "Robot evening",
  tasks: [
    { type: "single_choice", prompt: "The robot goes to bed at nine.", options: TRUE_FALSE, answer: 0, topic: "robot's evening" },
    { type: "single_choice", prompt: "The robot reads a book.", options: TRUE_FALSE, answer: 1, topic: "robot's evening" },
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

/** The student's lesson going on now, prepared with the video as its only stage; returns to the preparation page. */
async function prepareWithVideo(page: Page, firstName: string, title: string) {
  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: title });
  await control(page, "Добавить этап").click();
  await expect(page.getByRole("list", { name: "План урока" }).getByRole("listitem")).toHaveCount(1);
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();
}

/** «Запустить урок»: the panel in this tab, the stage in a new window. Returns the stage. */
async function launch(page: Page): Promise<Page> {
  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();
  await expect(page.getByText(HINT)).toBeVisible();
  return stage;
}

/** One task of the video on the stage, by its statement. */
function stageTask(stage: Page, prompt: string): Locator {
  return stage.getByRole("region", { name: "Видео", exact: true }).getByRole("listitem").filter({ hasText: prompt });
}

/** The video's controls on the panel. */
function videoControls(page: Page): Locator {
  return page.getByRole("region", { name: "Видео на сцене" });
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("after the student answers, the «Видео» stage shows each task with their answer, right or wrong; the panel filters and shows the answer", async ({
  page,
  browser,
  assistant,
}) => {
  const viewer = await createStudent(page, "Разборщик");
  await addLessonNow(page, "Разборщик");
  const videoId = await uploadVideo(page, "Robot review clip");
  await confirmTasks(page, assistant, videoId, "Robot review clip");
  await openToStudent(page, "Robot review clip", "Разборщик");

  // The student answers under the video: right on bedtime, wrong on the book.
  const student = await openAsStudent(browser, viewer.link, "Разборщик");
  await studentVideo(student, "Robot review clip");
  await task(student, "The robot goes to bed at nine.").getByRole("button", { name: "True", exact: true }).click();
  await task(student, "The robot reads a book.").getByRole("button", { name: "True", exact: true }).click();
  await student.getByRole("region", { name: "Задания к видео" }).getByRole("button", { name: "Готово", exact: true }).click();
  await expect(student.getByRole("region", { name: "Задания к видео" })).toContainText(PRAISE);
  await student.context().close();

  await prepareWithVideo(page, "Разборщик", "Robot review clip");
  const stage = await launch(page);
  const tabs = stage.getByRole("tablist", { name: "Этапы урока" }).getByRole("tab");
  await expect(tabs.first()).toContainText("Robot review clip");

  const review = stage.getByRole("region", { name: "Видео", exact: true });
  await expect(stageTask(stage, "The robot goes to bed at nine.")).toContainText("True");
  await expect(stageTask(stage, "The robot goes to bed at nine.")).toContainText("Верно");
  await expect(stageTask(stage, "The robot reads a book.")).toContainText("True");
  await expect(stageTask(stage, "The robot reads a book.")).toContainText("Неверно");
  // No key on the stage before the teacher shows it, nothing of the panel, and no player.
  const shown = await stage.locator("body").innerText();
  for (const forbidden of ["Правильный ответ", "Показать ответ", "Только ошибки", "План урока", "Заметка", HINT]) expect(shown).not.toContain(forbidden);
  await expect(review.locator("video, iframe")).toHaveCount(0);

  // «Только ошибки» leaves the wrong one.
  await videoControls(page).getByRole("button", { name: "Только ошибки", exact: true }).click();
  await expect(stageTask(stage, "The robot goes to bed at nine.")).toHaveCount(0);
  await expect(stageTask(stage, "The robot reads a book.")).toBeVisible();

  // «Показать ответ» for it shows the right answer on the stage.
  await videoControls(page).getByRole("listitem").filter({ hasText: "The robot reads a book." }).getByRole("button", { name: "Показать ответ", exact: true }).click();
  await expect(stageTask(stage, "The robot reads a book.")).toContainText("Правильный ответ: False");

  // «Все задания» brings the other back, its key still hidden.
  await videoControls(page).getByRole("button", { name: "Все задания", exact: true }).click();
  await expect(stageTask(stage, "The robot goes to bed at nine.")).toBeVisible();
  await expect(stageTask(stage, "The robot goes to bed at nine.")).not.toContainText("Правильный ответ");
  await stage.close();
});

test("before the student has answered, the «Видео» stage shows the tasks without answers", async ({ page, assistant }) => {
  await createStudent(page, "Неответивший");
  await addLessonNow(page, "Неответивший");
  const videoId = await uploadVideo(page, "Robot night clip");
  await confirmTasks(page, assistant, videoId, "Robot night clip");
  await prepareWithVideo(page, "Неответивший", "Robot night clip");
  const stage = await launch(page);

  await expect(stageTask(stage, "The robot goes to bed at nine.")).toBeVisible();
  await expect(stageTask(stage, "The robot reads a book.")).toBeVisible();
  const review = stage.getByRole("region", { name: "Видео", exact: true });
  await expect(review).toContainText("Ученик ещё не ответил");
  await expect(review).not.toContainText("Верно");
  await expect(review).not.toContainText("Неверно");
  await stage.close();
});
