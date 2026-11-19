// Acceptance for #158: a video shared from the stage stutters for the
// student, so during a lesson the teacher opens a video to the student, the
// way a game is opened in #118. The student finds it under «Видео» behind
// their permanent link: their own file plays on their page, served in byte
// ranges by the same address as for the teacher; a link is a button that
// opens it in a new tab. Another student gets the same 404 for the video's
// page and file as for a missing one. The end of the access — one hour
// after the lesson's end — is pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// students' are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago. The video file is synthetic: the browser records
// a second of a moving square on a canvas, as in #117.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The videos and the student made by one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

// A student's browser has no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const OWN = "Weather song clip";
const LINKED = "Counting rhyme link";
const LINK = "https://video.example.test/watch?v=counting-rhyme";

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

/** Creates a student in Moscow; returns their link. */
async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
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

async function startVideo(page: Page, source: "Ссылка" | "Файл", title: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Видео" });
  await page.getByLabel("Источник видео").selectOption({ label: source });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("students' videos");
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible({ timeout: 30_000 });
}

/** On the video's page in «Библиотека»: «Открыть ученику» to this student. */
async function openToStudent(page: Page, title: string, firstName: string) {
  await page.goto("/teacher/library");
  await materials(page).filter({ hasText: title }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await control(page, "Открыть ученику").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(page.getByText(new RegExp(`Открыто ученику: ${firstName}`))).toBeVisible();
}

/** The «Видео» section of the student's page. */
function studentVideos(student: Page) {
  return student.getByRole("region", { name: "Видео" });
}

let viewerLink: string;
let videoPage: string;
let videoFile: string;

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("during a lesson the teacher opens her own video to the student, who finds it under «Видео» and plays it", async ({ page, browser }) => {
  viewerLink = await createStudent(page, "Наблюдатель");
  await addLessonNow(page, "Наблюдатель");
  await page.goto("/teacher/library");
  const clip = await recordClip(page);
  await startVideo(page, "Файл", OWN);
  await page.getByLabel("Файл видео").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: clip });
  await save(page);

  // Before anything is opened, the student has no videos.
  const before = await openAsStudent(browser, viewerLink, "Наблюдатель");
  await expect(studentVideos(before)).toHaveCount(0);
  await before.context().close();

  await openToStudent(page, OWN, "Наблюдатель");

  const student = await openAsStudent(browser, viewerLink, "Наблюдатель");
  await studentVideos(student).getByRole("link", { name: OWN }).click();
  await expect(student.getByRole("heading", { level: 1, name: OWN })).toBeVisible();
  videoPage = student.url();
  const video = student.getByRole("main").locator("video");
  await expect(video).toHaveCount(1);
  await video.evaluate((element: HTMLVideoElement) => {
    element.muted = true;
    return element.play();
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0);

  // Served in byte ranges, as for the teacher.
  videoFile = new URL(await video.evaluate((element: HTMLVideoElement) => element.currentSrc), student.url()).toString();
  const range = await student.request.get(videoFile, { headers: { range: "bytes=0-9" } });
  expect(range.status()).toBe(206);
  expect((await range.body()).byteLength).toBe(10);
  await student.context().close();
});

test("a video link opened to the student is a button under «Видео» that opens the link in a new tab", async ({ page, browser }) => {
  await startVideo(page, "Ссылка", LINKED);
  await page.getByLabel("Ссылка на видео").fill(LINK);
  await save(page);
  await openToStudent(page, LINKED, "Наблюдатель");

  const student = await openAsStudent(browser, viewerLink, "Наблюдатель");
  const watch = studentVideos(student).getByRole("link", { name: LINKED });
  await expect(watch).toHaveAttribute("href", LINK);
  await expect(watch).toHaveAttribute("target", "_blank");
  await student.context().close();
});

test("another student gets the same 404 for the opened video's page and file as for a missing one", async ({ page, browser }) => {
  const otherLink = await createStudent(page, "Посторонний");
  const other = await openAsStudent(browser, otherLink, "Посторонний");
  await expect(studentVideos(other)).toHaveCount(0);

  const missing = "00000000-0000-4000-8000-000000000000";
  expect((await other.goto(videoPage))?.status()).toBe(404);
  expect((await other.goto(videoPage.replace(/[0-9a-f-]{36}$/, missing)))?.status()).toBe(404);
  const foreignFile = await other.request.get(videoFile);
  const missingFile = await other.request.get(videoFile.replace(/[0-9a-f-]{36}/, missing));
  expect({ status: foreignFile.status(), body: await foreignFile.text() }).toEqual({
    status: missingFile.status(),
    body: await missingFile.text(),
  });
  expect(foreignFile.status()).toBe(404);
  await other.context().close();
});
