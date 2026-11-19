// Acceptance for #117: videos in «Библиотека». A video is a link (http or
// https), which opens in a new tab, or the teacher's own file — MP4, WebM or
// MOV up to 200 MB — which plays in the page and is served in byte ranges, so
// it plays in Safari too. Saved with the same tags as a game, edited and
// deleted as games are; another teacher sees none of it.
//
// The teacher starts signed in (sessions.setup.ts). The video file is
// synthetic: the browser records a second of a moving square on a canvas.
import { open as openFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The videos made by one scenario are opened by the next ones.
test.describe.configure({ mode: "serial" });

const LINK = "https://video.example.test/watch?v=present-perfect";
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

type Tags = { title: string; level: string; topic: string; age: string };

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

function materials(page: Page): Locator {
  return page.getByRole("list", { name: "Материалы" }).getByRole("listitem");
}

async function openLibrary(page: Page) {
  await page.goto("/teacher/students");
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Библиотека" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека" })).toBeVisible();
}

async function startVideo(page: Page, source: "Ссылка" | "Файл") {
  await openLibrary(page);
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Видео" });
  await page.getByLabel("Источник видео").selectOption({ label: source });
}

async function fillTags(page: Page, { title, level, topic, age }: Tags) {
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption({ label: level });
  await page.getByLabel("Тема").fill(topic);
  await page.getByLabel("Возраст").selectOption({ label: age });
}

/** Saves the form; over once back on the list or refused with a message. */
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page
      .getByRole("heading", { level: 1, name: "Библиотека", exact: true })
      .or(page.getByRole("alert").filter({ hasText: /МБ|MP4|http/ })),
  ).toBeVisible({ timeout: 30_000 });
}

async function saveLink(page: Page, url: string, tags: Tags) {
  await startVideo(page, "Ссылка");
  await page.getByLabel("Ссылка на видео").fill(url);
  await fillTags(page, tags);
  await save(page);
}

async function saveFile(page: Page, file: Parameters<Locator["setInputFiles"]>[0], tags: Tags) {
  await startVideo(page, "Файл");
  await page.getByLabel("Файл видео").setInputFiles(file);
  await fillTags(page, tags);
  await save(page);
}

async function openMaterial(page: Page, title: string) {
  await openLibrary(page);
  await materials(page).filter({ hasText: title }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
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
      context.fillStyle = "#2e7d32";
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

/** The address the page's player loads its video from. */
async function videoSource(page: Page): Promise<string> {
  const video = page.getByRole("main").locator("video");
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentSrc)).not.toBe("");
  return new URL(await video.evaluate((element: HTMLVideoElement) => element.currentSrc), page.url()).toString();
}

let clip: Buffer;

test("a video link is saved with tags, listed under «Видео» and opens in a new tab", async ({ page }) => {
  await saveLink(page, LINK, { title: "Present perfect explained", level: "B1", topic: "present perfect", age: "подростки" });

  await openLibrary(page);
  await control(page, "Видео").click();
  const card = materials(page).filter({ hasText: "Present perfect explained" });
  await expect(card).toHaveCount(1);
  for (const tag of ["B1", "present perfect", "подростки"]) await expect(card).toContainText(tag);

  // Videos are not games.
  await control(page, "Игры").click();
  await expect(materials(page).filter({ hasText: "Present perfect explained" })).toHaveCount(0);

  await openMaterial(page, "Present perfect explained");
  const watch = page.getByRole("main").getByRole("link", { name: "Смотреть" });
  await expect(watch).toHaveAttribute("href", LINK);
  await expect(watch).toHaveAttribute("target", "_blank");
});

test("a link that is not http or https is refused with a message, and nothing is saved", async ({ page }) => {
  await saveLink(page, "javascript:alert(1)", { title: "Not a link", level: "A1", topic: "links", age: "младшие" });
  await expect(page.getByRole("alert").filter({ hasText: "http" })).toBeVisible();

  await openLibrary(page);
  await expect(materials(page).filter({ hasText: "Not a link" })).toHaveCount(0);
});

test("an own video file is listed under «Видео», plays in the page and is served in byte ranges", async ({ page }) => {
  await page.goto("/teacher/library");
  clip = await recordClip(page);
  expect(clip.byteLength).toBeGreaterThan(100);

  await saveFile(page, { name: "clip.webm", mimeType: "video/webm", buffer: clip }, {
    title: "Mascot says hello",
    level: "A1",
    topic: "greetings",
    age: "младшие",
  });

  await openLibrary(page);
  await control(page, "Видео").click();
  const card = materials(page).filter({ hasText: "Mascot says hello" });
  await expect(card).toHaveCount(1);
  for (const tag of ["A1", "greetings", "младшие"]) await expect(card).toContainText(tag);

  await openMaterial(page, "Mascot says hello");
  const video = page.getByRole("main").locator("video");
  await expect(video).toHaveCount(1);
  await video.evaluate((element: HTMLVideoElement) => {
    element.muted = true;
    return element.play();
  });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(0);

  // Safari asks for the file in pieces: a range comes back as 206 with exactly those bytes.
  const src = await videoSource(page);
  const whole = await page.request.get(src);
  expect(whole.status()).toBe(200);
  expect(whole.headers()["accept-ranges"]).toBe("bytes");
  expect(Buffer.compare(await whole.body(), clip)).toBe(0);

  const part = await page.request.get(src, { headers: { Range: "bytes=10-109" } });
  expect(part.status()).toBe(206);
  expect(part.headers()["content-range"]).toBe(`bytes 10-109/${clip.byteLength}`);
  expect(Buffer.compare(await part.body(), clip.subarray(10, 110))).toBe(0);
});

test("a file over 200 MB or not MP4, WebM or MOV is refused with a message, and nothing is saved", async ({ page }, testInfo) => {
  // Sparse on disk: one byte over the limit without writing 200 MB.
  const hugePath = testInfo.outputPath("too-big.mp4");
  const huge = await openFile(hugePath, "w");
  await huge.truncate(MAX_VIDEO_BYTES + 1);
  await huge.close();
  await saveFile(page, hugePath, { title: "Too long a film", level: "A2", topic: "size", age: "младшие" });
  await expect(page.getByRole("alert").filter({ hasText: "200 МБ" })).toBeVisible();

  const flv = Buffer.concat([Buffer.from("FLV"), Buffer.from([1, 5, 0, 0, 0, 9]), Buffer.alloc(64)]);
  await saveFile(page, { name: "old-clip.flv", mimeType: "video/x-flv", buffer: flv }, {
    title: "Old format",
    level: "A2",
    topic: "size",
    age: "младшие",
  });
  await expect(page.getByRole("alert").filter({ hasText: "MP4" })).toBeVisible();

  await openLibrary(page);
  await expect(materials(page).filter({ hasText: "Too long a film" })).toHaveCount(0);
  await expect(materials(page).filter({ hasText: "Old format" })).toHaveCount(0);
});

test("a video can be renamed and retagged, and once deleted it is gone with its file", async ({ page }) => {
  await saveFile(page, { name: "draft.webm", mimeType: "video/webm", buffer: clip }, {
    title: "Draft clip",
    level: "A2",
    topic: "food",
    age: "младшие",
  });
  await openMaterial(page, "Draft clip");
  const src = await videoSource(page);

  await control(page, "Изменить").click();
  await page.getByLabel("Название").fill("Food song");
  await page.getByLabel("Уровень").selectOption({ label: "A1" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Food song" })).toBeVisible();

  await openLibrary(page);
  const card = materials(page).filter({ hasText: "Food song" });
  await expect(card).toContainText("A1");
  await expect(materials(page).filter({ hasText: "Draft clip" })).toHaveCount(0);

  await card.getByRole("link", { name: "Открыть" }).click();
  await control(page, "Удалить").click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека" })).toBeVisible();
  await expect(materials(page).filter({ hasText: "Food song" })).toHaveCount(0);
  expect((await page.request.get(src)).status()).toBe(404);
});

test("another teacher gets the same 404 for a video's page and its file as for missing ones", async ({ page, browser }) => {
  await openMaterial(page, "Mascot says hello");
  const videoPage = page.url();
  const file = await videoSource(page);
  const missingPage = videoPage.replace(/[0-9a-f-]{36}$/, "00000000-0000-4000-8000-000000000000");
  const missingFile = file.replace(/[0-9a-f-]{36}/, "00000000-0000-4000-8000-000000000000");

  const other = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const otherPage = await other.newPage();
  expect((await otherPage.goto(videoPage))?.status()).toBe(404);
  expect((await otherPage.goto(missingPage))?.status()).toBe(404);

  // A range request is refused the same way: no piece of the file leaks.
  for (const headers of [{}, { Range: "bytes=0-99" }] as Record<string, string>[]) {
    const foreignFile = await other.request.get(file, { headers });
    const missingFileResponse = await other.request.get(missingFile, { headers });
    expect({ status: foreignFile.status(), body: await foreignFile.text() }).toEqual({
      status: missingFileResponse.status(),
      body: await missingFileResponse.text(),
    });
    expect(foreignFile.status()).toBe(404);
  }
  await other.close();
});
