// Acceptance for #35: the student answers the tasks the teacher checks — a
// written text, a voice recording and a photo — and the result screen counts
// them as «проверит учитель».
//
// The teacher's part starts signed in (sessions.setup.ts). The student opens
// the link in a fresh phone-sized browser without the teacher's cookies. The
// homework is synthetic (deploy/seed/homework/demo-open-answers.json); the
// photo is a tiny PNG made here, and the microphone is Chromium's fake device
// (playwright.config.ts). Limits from the product owner: a file up to 10 MB,
// a recording up to 5 minutes.
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-open-answers.json" with { type: "json" };
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };
const PHONE = { width: 390, height: 844 };
// A 1×1 PNG, written for this test.
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const [choice, written, voice, photo] = homework.tasks as [
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
];
const TEXT = "I went to the park. I played football.";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function publishedHomeworkLink(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
  return link;
}

async function openOnPhone(browser: Browser, link: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    storageState: NO_SESSION,
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  await page.goto(link);
  await start(page);
  return { context, page };
}

async function start(page: Page) {
  await expect(page.getByText(choice.prompt).or(control(page, "Начать"))).toBeVisible();
  if (await control(page, "Начать").isVisible()) await control(page, "Начать").click();
  await expect(page.getByText(choice.prompt)).toBeVisible();
}

const next = (page: Page) => page.getByRole("button", { name: "Дальше", exact: true }).click();

/** Goes forward to the task with this prompt. */
async function goTo(page: Page, prompt: string) {
  while (!(await page.getByText(prompt).isVisible())) await next(page);
}

/** Records for a moment and stops; the student can listen to it before moving on. */
async function record(page: Page, button: "Записать" | "Записать заново") {
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeVisible();
  // A short answer: the fake microphone plays a tone meanwhile.
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  const audio = page.locator("main audio");
  await expect(audio).toHaveCount(1);
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState >= 1 && a.duration > 0)).toBe(true);
  // Uploaded before the student moves on or closes the page.
  await expect(page.getByText("Запись сохранена")).toBeVisible();
}

async function attachPhoto(page: Page, bytes: Buffer, name = "notebook.png") {
  await page.getByLabel("Прикрепить фото или аудио").setInputFiles({ name, mimeType: "image/png", buffer: bytes });
}

/** The photo is uploaded: the page shows it from the server, not from the phone. */
async function expectSavedPhoto(page: Page) {
  await expect(page.locator('main img[src^="/api/files/"]')).toHaveCount(1);
}

/** The written answer, the recording and the photo, then back to the start. */
async function answerOpenTasks(page: Page) {
  await option(page, "green").click();
  await goTo(page, written.prompt);
  await page.getByLabel("Ваш ответ").fill(TEXT);
  await goTo(page, voice.prompt);
  await record(page, "Записать");
  await goTo(page, photo.prompt);
  await attachPhoto(page, PIXEL_PNG);
  await expectSavedPhoto(page);
}

/** The saved recording, as the server gives it back. */
async function recordingBytes(page: Page): Promise<Buffer> {
  const audio = page.locator("main audio");
  await expect(audio).toHaveCount(1);
  const src = await audio.getAttribute("src");
  const response = await page.request.get(new URL(src!, page.url()).toString());
  expect(response.status()).toBe(200);
  return response.body();
}

function option(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true }).or(page.getByRole("radio", { name, exact: true }));
}

test("written, voice and photo answers are kept across a reload, and a new recording replaces the old one", async ({
  page,
  browser,
}) => {
  const link = await publishedHomeworkLink(page, "Открытые");
  const { context, page: student } = await openOnPhone(browser, link);
  await answerOpenTasks(student);

  await student.reload();
  await start(student);
  await goTo(student, written.prompt);
  await expect(student.getByLabel("Ваш ответ")).toHaveValue(TEXT);

  // The recording is there and plays; a new one replaces it.
  await goTo(student, voice.prompt);
  const before = await recordingBytes(student);
  await record(student, "Записать заново");
  await student.reload();
  await start(student);
  await goTo(student, voice.prompt);
  expect((await recordingBytes(student)).equals(before)).toBe(false);

  await goTo(student, photo.prompt);
  await expect(student.locator("main img")).toHaveCount(1);
  await expect.poll(() => student.locator("main img").evaluate((img: HTMLImageElement) => img.naturalWidth > 0)).toBe(true);
  await context.close();
});

test("the result counts the open tasks as «проверит учитель»", async ({ page, browser }) => {
  const link = await publishedHomeworkLink(page, "Итог открытых");
  const { context, page: student } = await openOnPhone(browser, link);
  await answerOpenTasks(student);
  await student.getByRole("button", { name: "Сдать", exact: true }).click();

  await expect(student.getByText(/1\s+верно/)).toBeVisible();
  await expect(student.getByText(/0\s+неверно/)).toBeVisible();
  await expect(student.getByText(/3\s+задания\s+проверит учитель/)).toBeVisible();
  await context.close();
});

test("a file over 10 MB is refused with a message, and the other answers stay", async ({ page, browser }) => {
  const link = await publishedHomeworkLink(page, "Большой файл");
  const { context, page: student } = await openOnPhone(browser, link);
  await goTo(student, written.prompt);
  await student.getByLabel("Ваш ответ").fill(TEXT);
  await goTo(student, photo.prompt);

  const huge = Buffer.concat([PIXEL_PNG, Buffer.alloc(11 * 1024 * 1024)]);
  await attachPhoto(student, huge, "huge.png");
  await expect(student.getByRole("alert").filter({ hasText: "10 МБ" })).toBeVisible();
  await expect(student.locator("main img")).toHaveCount(0);

  await student.reload();
  await start(student);
  await goTo(student, written.prompt);
  await expect(student.getByLabel("Ваш ответ")).toHaveValue(TEXT);
  await context.close();
});

test("an uploaded file opens for its student and their teacher only", async ({ page, browser, playwright }) => {
  const link = await publishedHomeworkLink(page, "Свой файл");
  const { context, page: student } = await openOnPhone(browser, link);
  await goTo(student, photo.prompt);
  await attachPhoto(student, PIXEL_PNG);
  await expectSavedPhoto(student);
  const src = await student.locator("main img").getAttribute("src");
  expect(src).toBeTruthy();
  const url = new URL(src!, student.url());

  const own = await student.request.get(url.toString());
  expect(own.status()).toBe(200);
  const missing = await student.request.get(`${url.toString()}x`);
  const missingResult = { status: missing.status(), body: await missing.text() };
  expect(missingResult.status).toBe(404);

  // The teacher of this student can open it.
  expect((await page.request.get(url.toString())).status()).toBe(200);

  // Another student, another teacher and nobody: the same answer as a missing file.
  const otherLink = await publishedHomeworkLink(page, "Чужой файл");
  const other = await openOnPhone(browser, otherLink);
  const otherTeacher = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const nobody = await playwright.request.newContext({ storageState: NO_SESSION });
  for (const request of [other.page.request, otherTeacher.request, nobody]) {
    const response = await request.get(url.toString());
    expect({ status: response.status(), body: await response.text() }).toEqual(missingResult);
  }
  await nobody.dispose();
  await otherTeacher.close();
  await other.context.close();
  await context.close();
});
