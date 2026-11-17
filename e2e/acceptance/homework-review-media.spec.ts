// Acceptance for #93: «Проверка домашек» plays a student's recording and
// shows their photo, in the current submission and in an earlier attempt
// after «Открыть заново для ученика». Another teacher gets the same 404 as
// for a missing file.
//
// The teacher's part starts signed in (sessions.setup.ts). The student opens
// the link in a fresh phone-sized browser without the teacher's cookies. The
// homework is synthetic (deploy/seed/homework/demo-open-answers.json); the
// photo is a tiny PNG made here, and the microphone is Chromium's fake device
// (playwright.config.ts).
import { type Browser, type BrowserContextOptions, expect, type Locator, type Page, test } from "@playwright/test";
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
const [choice, , voice, photo] = homework.tasks as [
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
];

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

async function onPhone(browser: Browser, storageState: BrowserContextOptions["storageState"]) {
  const context = await browser.newContext({
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    storageState,
    permissions: ["microphone"],
  });
  return context.newPage();
}

async function start(page: Page) {
  await expect(page.getByText(choice.prompt).or(control(page, "Начать"))).toBeVisible();
  if (await control(page, "Начать").isVisible()) await control(page, "Начать").click();
  await expect(page.getByText(choice.prompt)).toBeVisible();
}

const next = (page: Page) => page.getByRole("button", { name: "Дальше", exact: true }).click();

async function goTo(page: Page, prompt: string) {
  while (!(await page.getByText(prompt).isVisible())) await next(page);
}

/** Records for a moment and waits until the recording is uploaded. */
async function record(page: Page) {
  await page.getByRole("button", { name: "Записать", exact: true }).click();
  await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeVisible();
  // The fake microphone plays a tone meanwhile.
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(page.getByText("Запись сохранена")).toBeVisible();
}

/** The recording and the photo, then «Сдать», confirming that the written task is left blank. */
async function answerAndSubmit(page: Page) {
  await start(page);
  await goTo(page, voice.prompt);
  await record(page);
  await goTo(page, photo.prompt);
  await page
    .getByLabel("Прикрепить фото или аудио")
    .setInputFiles({ name: "notebook.png", mimeType: "image/png", buffer: PIXEL_PNG });
  await expect(page.locator('main img[src^="/api/files/"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Сдать", exact: true }).click();
  const result = page.getByText(/\d+\s+верно/);
  const confirm = page.getByRole("button", { name: "Всё равно сдать", exact: true });
  await expect(result.or(confirm)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
  await expect(result).toBeVisible();
}

/** Opens «Проверка домашек», filters by the student and opens their current submission. */
async function openSubmission(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await page.getByRole("link", { name: /Проверка домашек/ }).click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  const rows = page.getByRole("listitem").filter({ hasText: firstName });
  await expect(rows).toHaveCount(1);
  await rows.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(firstName);
}

function task(page: Page, prompt: string): Locator {
  return page.getByRole("listitem").filter({ hasText: prompt });
}

/** The task's recording is on the page and the browser can play it; returns its bytes. */
async function playableRecording(page: Page): Promise<Buffer> {
  const audio = task(page, voice.prompt).locator("audio");
  await expect(audio).toHaveCount(1);
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState >= 1)).toBe(true);
  const response = await page.request.get(new URL((await audio.getAttribute("src"))!, page.url()).toString());
  expect(response.status()).toBe(200);
  return response.body();
}

/** The task's photo is on the page and has loaded. */
async function shownPhoto(page: Page) {
  const img = task(page, photo.prompt).locator("img");
  await expect(img).toHaveCount(1);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
}

test("the submission plays the recording and shows the photo", async ({ page, browser }) => {
  const link = await publishedHomeworkLink(page, "Голос и фото");
  const student = await onPhone(browser, NO_SESSION);
  await student.goto(link);
  await answerAndSubmit(student);
  await student.context().close();

  await openSubmission(page, "Голос и фото");
  expect((await playableRecording(page)).length).toBeGreaterThan(0);
  await shownPhoto(page);
});

test("after «Открыть заново для ученика» the first attempt still plays its own recording", async ({ page, browser }) => {
  const link = await publishedHomeworkLink(page, "Две записи");
  const first = await onPhone(browser, NO_SESSION);
  await first.goto(link);
  await answerAndSubmit(first);
  const studentState = await first.context().storageState();
  await first.context().close();

  await openSubmission(page, "Две записи");
  const firstRecording = await playableRecording(page);
  await page.getByRole("button", { name: "Открыть заново для ученика", exact: true }).click();
  await expect(page.getByText("Открыта заново")).toBeVisible();

  const again = await onPhone(browser, studentState);
  await again.goto(new URL(link).pathname);
  await answerAndSubmit(again);
  await again.context().close();

  // The current attempt has the new recording.
  await openSubmission(page, "Две записи");
  const secondRecording = await playableRecording(page);
  expect(secondRecording.equals(firstRecording)).toBe(false);

  // The first attempt still has its own.
  await page.getByRole("region", { name: "Попытки" }).getByRole("link", { name: /Попытка 1/ }).click();
  await expect(page.getByRole("main").getByText(/попытка 1/)).toBeVisible();
  expect((await playableRecording(page)).equals(firstRecording)).toBe(true);
  await shownPhoto(page);
});

test("another teacher gets the same 404 for a recording as for a missing file", async ({ page, browser }) => {
  const link = await publishedHomeworkLink(page, "Чужая запись");
  const student = await onPhone(browser, NO_SESSION);
  await student.goto(link);
  await answerAndSubmit(student);
  await student.context().close();

  await openSubmission(page, "Чужая запись");
  await playableRecording(page);
  const src = new URL((await task(page, voice.prompt).locator("audio").getAttribute("src"))!, page.url());
  const missing = new URL(src.toString().replace(/\/(\d+)$/, "/49"));
  const own = await page.request.get(missing.toString());
  const missingResult = { status: own.status(), body: await own.text() };
  expect(missingResult.status).toBe(404);

  const otherTeacher = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const foreign = await otherTeacher.request.get(src.toString());
  expect({ status: foreign.status(), body: await foreign.text() }).toEqual(missingResult);
  await otherTeacher.close();
});
