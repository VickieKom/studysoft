// Acceptance for #330: a video with tasks in homework. In a homework draft
// the teacher adds a library video: the video goes into the homework, and
// its confirmed tasks (#326) are copied into it as homework tasks, edited and
// removed like the rest (product owner, 2026-11-23). The student watches it
// on their homework page and answers its tasks with the others; they are
// checked with the rest on «Сдать», and «Проверка домашек» shows them with
// the answers like any task. A later change of the video's tasks leaving the
// homework as it was, and a YouTube link embedded on the page (#325), are
// pinned by integration tests.
//
// The teacher starts signed in (sessions.setup.ts). The video file is
// synthetic, recorded by the browser as in #117; its tasks are saved by the
// assistant and confirmed by the teacher as in #326; the homework is
// synthetic, made here.
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

const TRUE_FALSE = ["True", "False"];
const BEDTIME = "The robot in the homework clip goes to bed at nine.";
const BOOK = "The robot in the homework clip reads a book.";
const VIDEO_TASKS = {
  version: 1,
  title: "Robot homework",
  tasks: [
    { type: "single_choice", prompt: BEDTIME, options: TRUE_FALSE, answer: 0, topic: "robot's evening" },
    { type: "single_choice", prompt: BOOK, options: TRUE_FALSE, answer: 1, topic: "robot's evening" },
  ],
};
const SKY = "Pick the colour of the sky in the homework.";
const HOMEWORK = {
  version: 1,
  title: "Video homework",
  tasks: [{ type: "single_choice", prompt: SKY, options: ["blue", "green"], answer: 0, topic: "colours" }],
};

function control(page: Page | Locator, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

function materials(page: Page): Locator {
  return page.getByRole("list", { name: "Материалы" }).getByRole("listitem");
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

async function openInLibrary(page: Page, title: string) {
  await page.goto("/teacher/library");
  await materials(page).filter({ hasText: title }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/** Uploads an own video to the library; returns its id. */
async function uploadVideo(page: Page, title: string): Promise<string> {
  await page.goto("/teacher/library");
  const clip = await recordClip(page);
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Видео" });
  await page.getByLabel("Источник видео").selectOption({ label: "Файл" });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("homework video");
  await page.getByLabel("Файл видео").setInputFiles({ name: "clip.webm", mimeType: "video/webm", buffer: clip });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible({ timeout: 30_000 });
  await openInLibrary(page, title);
  return page.url().match(/[0-9a-f-]{36}/)![0];
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
    data: JSON.stringify({ videoId, tasks: VIDEO_TASKS }),
  });
  expect(saved.status()).toBe(200);
  await openInLibrary(page, title);
  await page.getByRole("region", { name: "Задания к видео" }).getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("region", { name: "Задания к видео" })).toContainText("Подтверждено");
}

/** A new student with an imported homework draft; returns their link, the draft's page left open. */
async function draftForNewStudent(page: Page, firstName: string): Promise<string> {
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
  await page.getByLabel("JSON домашки").fill(JSON.stringify(HOMEWORK));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();
  return link;
}

/** A task of the draft's preview or of a submission, by its prompt. */
function task(page: Page, prompt: string): Locator {
  return page.getByRole("listitem").filter({ hasText: prompt });
}

/** Opens a link in a fresh browser without any session, as the student would. */
async function openAsStudent(browser: Browser, link: string): Promise<Page> {
  const student = await (await browser.newContext({ storageState: NO_SESSION, viewport: { width: 390, height: 844 } })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  return student;
}

test("a library video with its tasks is added to a homework draft; the student watches it and answers, checked with the rest; «Проверка домашек» shows its tasks", async ({
  page,
  browser,
  assistant,
}) => {
  const videoId = await uploadVideo(page, "Robot homework clip");
  await confirmTasks(page, assistant, videoId, "Robot homework clip");

  // «Добавить видео» in the draft: the video and a copy of its confirmed tasks, after the homework's own.
  const link = await draftForNewStudent(page, "Смотрит дома");
  await control(page, "Добавить видео").click();
  await page.getByLabel("Видео из библиотеки").selectOption({ label: "Robot homework clip" });
  await page.getByRole("button", { name: "Добавить в домашку", exact: true }).click();
  await expect(task(page, BEDTIME)).toBeVisible();
  await expect(task(page, BOOK)).toBeVisible();
  await expect(page.getByRole("main").locator("video")).toHaveCount(1);
  await page.reload();
  await expect(task(page, SKY)).toBeVisible();
  await expect(task(page, BEDTIME)).toBeVisible();
  // The copied tasks are the homework's own: edited like the rest.
  await expect(control(task(page, BEDTIME), "Изменить задание")).toBeVisible();

  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  // The student: the sky right; under the video, bedtime right and the book wrong.
  const student = await openAsStudent(browser, link);
  await expect(student.getByText(SKY).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  await expect(student.getByText(SKY)).toBeVisible();
  await student.getByRole("button", { name: "blue", exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(student.getByText(BEDTIME)).toBeVisible();
  // The video plays on the homework page, above its tasks.
  const player = student.getByRole("main").locator("video");
  await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.duration), { timeout: 10_000 }).toBeGreaterThan(0);
  await student.getByRole("button", { name: "True", exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(student.getByText(BOOK)).toBeVisible();
  await expect(student.getByRole("main").locator("video")).toHaveCount(1);
  await student.getByRole("button", { name: "True", exact: true }).click();
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  const result = student.getByText("Домашка сдана");
  const confirm = student.getByRole("button", { name: "Всё равно сдать", exact: true });
  await expect(result.or(confirm)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
  await expect(result).toBeVisible();
  await student.context().close();

  // Checked with the rest: two right, one wrong; each video task with its answer, like any task.
  await page.goto("/teacher/homework-review");
  await page.getByLabel("Ученик").selectOption({ label: "Смотрит дома" });
  const row = page.getByRole("listitem").filter({ hasText: "Смотрит дома" });
  await expect(row).toContainText("2 верно, 1 неверно");
  await row.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Смотрит дома");
  await expect(task(page, BEDTIME)).toContainText("True");
  await expect(task(page, BEDTIME)).not.toContainText("Правильный ответ");
  await expect(task(page, BOOK)).toContainText("True");
  await expect(task(page, BOOK)).toContainText("Правильный ответ: False");
});
