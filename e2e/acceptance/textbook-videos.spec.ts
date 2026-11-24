// Acceptance for #329: videos of a textbook set. The teacher uploads a set
// with its videos — MP4, WebM or MOV, at most 200 MB each — and marks which
// lesson a video belongs to in the structure, as she does tracks. In the
// preparation of a lesson on that book lesson the video is offered as a
// stage; she adds tasks to it from the lesson's task bank (#224). From the
// preparation she opens it to the student (product owner, 2026-11-23): at
// once, until an hour after that lesson's end. The student watches it on
// their page with those tasks under it, as a library video's (#327). The
// stage reviewing the answers as #328 does is pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts). The PDF (six pages that
// say their number), the video (a second of a moving square, recorded by the
// browser) and the tasks are synthetic, made here.
import { open as openFile } from "node:fs/promises";
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
// One token per teacher: creating one revokes the previous one.
test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const PRAISE = "Готово! Ответы отправлены, учитель посмотрит";

/** A PDF of `pages` pages, each saying its number. */
function pdf(pages: number): Buffer {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  const font = 3 + pages * 2;
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 48 Tf 72 700 Td (Page ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
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

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

async function agentCall(request: APIRequestContext, token: string, procedure: string, input: unknown, query = false) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const response = query
    ? await request.get(`/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers })
    : await request.post(`/api/trpc/${procedure}`, { headers, data: JSON.stringify(input) });
  return { status: response.status(), body: await response.json() };
}

const workbook = (page: string, exercise: string) => ({ book: "Workbook", unit: "1", page, exercise });
const lemon = {
  type: "single_choice",
  prompt: "Choose the colour of the lemon in the video.",
  options: ["yellow", "purple"],
  answer: 0,
  topic: "colours",
  skill: "listening",
  source: workbook("5", "1"),
};
const frog = {
  type: "gap",
  prompt: "Complete the sentence about the frog in the video.",
  text: "The frog ___ in the pond.",
  answers: [["swims"]],
  topic: "present simple",
  skill: "listening",
  source: workbook("5", "2"),
};
const garden = {
  type: "written",
  prompt: "Write two lines about the garden in the video.",
  topic: "nature",
  skill: "writing",
  source: workbook("5", "3"),
};

async function openUploadForm(page: Page) {
  await page.goto("/teacher/library");
  await control(page, "Учебники").click();
  await control(page, "Загрузить учебник").click();
}

/** Uploads a six-page book with one video; waits for the pages; returns the textbook's id. */
async function uploadWithVideo(page: Page, title: string, video: Buffer): Promise<string> {
  await openUploadForm(page);
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "book.pdf", mimeType: "application/pdf", buffer: pdf(6) });
  await page.getByLabel("Видео").setInputFiles({ name: "1-2-clip.webm", mimeType: "video/webm", buffer: video });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("region", { name: "Student's Book" }).getByText("Готов", { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  return page.url().split("/").at(-1)!;
}

/** A student with the textbook chosen on the card and lesson 1.1 passed, so 1.2 comes next; a lesson with them tomorrow. Returns their link. */
async function studentWithTextbook(page: Page, firstName: string, textbook: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const block = page.getByRole("region", { name: "Учебник ученика" });
  await block.getByLabel("Учебник").selectOption({ label: textbook });
  await block.getByLabel("Пройденный урок").selectOption({ label: "Unit 1 · 1.1" });
  await block.getByRole("button", { name: "Сохранить учебник", exact: true }).click();
  await expect(block.getByText("Сохранено")).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
  return link;
}

async function openPreparation(page: Page, firstName: string) {
  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
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

const stages = (page: Page) => page.getByRole("list", { name: "План урока" }).getByRole("listitem");

/** One task under the video on the student's page, by its statement. */
function task(student: Page, prompt: string): Locator {
  return student.getByRole("region", { name: "Задания к видео" }).getByRole("listitem").filter({ hasText: prompt });
}

test("a video uploaded with the set and marked on 1.2 is a stage of a lesson on 1.2 with tasks from its bank, and opened from the preparation it plays for the student with those tasks", async ({
  page,
  browser,
  assistant,
}) => {
  await page.goto("/teacher/library");
  const clip = await recordClip(page);
  const textbookId = await uploadWithVideo(page, "Demo Video Book", clip);
  // The set's videos are listed on its page, and play there.
  const videos = page.getByRole("list", { name: "Видео" }).getByRole("listitem");
  await expect(videos).toHaveCount(1);
  await expect(videos.first()).toContainText("1-2-clip");
  await expect.poll(() => videos.first().locator("video").evaluate((element: HTMLVideoElement) => element.duration), { timeout: 10_000 }).toBeGreaterThan(0);

  // The assistant drafts lessons 1.1–1.3; the teacher marks the video on 1.2 by hand, as a track, and confirms.
  const token = await createToken(page);
  const lesson = (name: string, from: number) => ({ title: name, pages: { students_book: { from, to: from + 1 } }, tracks: [], words: [] });
  const structure = { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1), lesson("1.2", 3), lesson("1.3", 5)] }] };
  expect((await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).status).toBe(200);
  await page.goto(`/teacher/library/textbooks/${textbookId}`);
  const editor = page.getByRole("region", { name: "Структура" });
  await editor.getByRole("group", { name: "Юнит 1", exact: true }).getByRole("group", { name: "Урок 2", exact: true }).getByLabel("Видео").fill("1-2-clip");
  await editor.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(editor).toContainText("Подтверждена");

  // Lesson 1.2's bank: three tasks, confirmed.
  const saved = await agentCall(assistant, token, "agent.textbookStructure", { textbookId }, true);
  const lessonId: string = saved.body.result.data.structure.units[0].lessons[1].id;
  expect((await agentCall(assistant, token, "agent.saveTextbookLessonTasks", { textbookId, lessonId, tasks: [lemon, frog, garden], skipped: [] })).status).toBe(200);
  await page.reload();
  const bank = page.getByRole("region", { name: "Задания" }).getByRole("region", { name: "Урок 1.2", exact: true });
  await bank.getByRole("button", { name: "Подтвердить урок", exact: true }).click();
  await expect(bank.getByRole("list", { name: "Подтверждённые задания" }).getByRole("listitem")).toHaveCount(3);

  // Lesson 1.2's page shows its video.
  await page.getByRole("link", { name: "1.2", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "1.2" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Видео" })).toContainText("1-2-clip");

  // The preparation of the next lesson, on 1.2, offers the video as a stage; two of the bank's tasks go with it.
  const link = await studentWithTextbook(page, "Смотрит учебник", "Demo Video Book");
  await openPreparation(page, "Смотрит учебник");
  await page.getByLabel("Видео урока").selectOption({ label: "1-2-clip" });
  await control(page, "Добавить видео").click();
  const stage = stages(page).filter({ hasText: "1-2-clip" });
  await expect(stage).toHaveCount(1);
  const offered = stage.getByRole("list", { name: "Задания к видео" }).getByRole("listitem");
  await expect(offered).toHaveCount(3);
  await offered.filter({ hasText: lemon.prompt }).getByRole("checkbox", { name: "К видео" }).check();
  await offered.filter({ hasText: frog.prompt }).getByRole("checkbox", { name: "К видео" }).check();
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();
  await page.reload();
  await expect(stages(page).filter({ hasText: "1-2-clip" }).getByRole("checkbox", { name: "К видео", checked: true })).toHaveCount(2);

  // Opened to the student from the preparation, before the lesson.
  await stages(page).filter({ hasText: "1-2-clip" }).getByRole("button", { name: "Открыть ученику", exact: true }).click();
  await expect(stages(page).filter({ hasText: "1-2-clip" })).toContainText("Открыто ученику");

  // The student watches it on their page, the two tasks under it, without the keys.
  const student = await openAsStudent(browser, link, "Смотрит учебник");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: /^Материалы урока/ }).click();
  await expect(student.getByRole("heading", { level: 1, name: "Материалы урока" })).toBeVisible();
  await student.getByRole("region", { name: "Видео" }).getByRole("link", { name: "1-2-clip" }).click();
  await expect(student.getByRole("heading", { level: 1, name: "1-2-clip" })).toBeVisible();
  const player = student.getByRole("main").locator("video");
  await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.duration), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(student.getByRole("region", { name: "Задания к видео" }).getByRole("listitem")).toHaveCount(2);
  await expect(task(student, lemon.prompt)).toBeVisible();
  await expect(task(student, frog.prompt)).toBeVisible();
  await expect(student.getByText(garden.prompt)).toHaveCount(0);
  await expect(student.getByRole("main")).not.toContainText("swims");

  // They answer as under a library video: praise only.
  await task(student, lemon.prompt).getByRole("button", { name: "yellow", exact: true }).click();
  await student.getByRole("region", { name: "Задания к видео" }).getByRole("button", { name: "Готово", exact: true }).click();
  await expect(student.getByRole("region", { name: "Задания к видео" })).toContainText(PRAISE);
  await student.context().close();
});

test("a video over 200 MB or not MP4, WebM or MOV is refused with a message, and the set is not saved", async ({ page }, testInfo) => {
  // Sparse on disk: one byte over the limit without writing 200 MB.
  const hugePath = testInfo.outputPath("too-big.mp4");
  const huge = await openFile(hugePath, "w");
  await huge.truncate(MAX_VIDEO_BYTES + 1);
  await huge.close();
  await openUploadForm(page);
  await page.getByLabel("Название").fill("Demo Video Book too big");
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "book.pdf", mimeType: "application/pdf", buffer: pdf(2) });
  await page.getByLabel("Видео").setInputFiles(hugePath);
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  // Next announces the page in an alert of its own: the form's message is the one that names the file.
  await expect(page.getByRole("alert").filter({ hasText: "too-big.mp4" })).toContainText("200 МБ");

  const flv = Buffer.concat([Buffer.from("FLV"), Buffer.from([1, 5, 0, 0, 0, 9]), Buffer.alloc(64)]);
  await openUploadForm(page);
  await page.getByLabel("Название").fill("Demo Video Book old format");
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "book.pdf", mimeType: "application/pdf", buffer: pdf(2) });
  await page.getByLabel("Видео").setInputFiles({ name: "old-clip.flv", mimeType: "video/x-flv", buffer: flv });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "old-clip.flv" })).toContainText("MP4");

  await page.goto("/teacher/library");
  await control(page, "Учебники").click();
  await expect(page.getByText("Demo Video Book too big")).toHaveCount(0);
  await expect(page.getByText("Demo Video Book old format")).toHaveCount(0);
});
