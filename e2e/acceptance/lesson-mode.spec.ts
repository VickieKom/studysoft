// Acceptance for #152: the lesson mode — the stage for the student and the
// control panel for the teacher. «Запустить урок» on a prepared lesson opens
// the panel and the stage as a separate window. The stage shows the plan's
// stages as tabs and only lesson content: a warm-up, the book's page (one or
// a spread, either book of the set) and the lesson's track; never the plan,
// the note or the platform's menu. Everything is switched on the panel, and
// the stage follows at once. The book opens at the lesson's first page, but
// the whole book can be paged (product owner, 2026-11-18). A stage closed
// mid-lesson opens again on the same stage and page; the note is kept on the
// server as the teacher writes it.
//
// The teacher starts signed in (sessions.setup.ts). The textbook, the tracks
// and the warm-up are synthetic, made here.
import { type APIRequestContext, type Browser, expect, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

// The assistant's client has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION });
// The second scenario uses the textbook the first one set up.
test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;
const BOOK = "Demo Stage Book";
const WARM_UP = "Stage warm-up";
const QUESTION = "What did you have for breakfast?";
const HINT = "В Телемосте покажите окно «Экран для ученика» и включите звук";

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

/** About twenty seconds of MP3 silence: long enough to be playing while it is checked. */
function mp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc4]);
  return Buffer.concat(Array.from({ length: 770 }, () => frame));
}

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function agentCall(request: APIRequestContext, token: string, procedure: string, input: unknown) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const response = await request.post(`/api/trpc/${procedure}`, { headers, data: JSON.stringify(input) });
  return response.status();
}

/**
 * A set of an eight-page Student's Book, a four-page Workbook and two tracks,
 * with a confirmed unit: 1.1 on pages 2–3, 1.2 on pages 4–5 with track 1-02
 * and Workbook page 2, 1.3 on pages 6–7. And a warm-up of one question.
 */
async function textbookAndWarmUp(page: Page, assistant: APIRequestContext) {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const tokenField = page.getByLabel("Токен ассистента");
  await expect(tokenField).not.toHaveValue("");
  const token = await tokenField.inputValue();

  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(BOOK);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: pdf(8) });
  await page.getByLabel("Workbook (PDF)").setInputFiles({ name: "workbook.pdf", mimeType: "application/pdf", buffer: pdf(4) });
  await page.getByLabel("Треки").setInputFiles([
    { name: "1-01.mp3", mimeType: "audio/mpeg", buffer: mp3() },
    { name: "1-02.mp3", mimeType: "audio/mpeg", buffer: mp3() },
  ]);
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: BOOK })).toBeVisible();
  await expect(async () => {
    await page.reload();
    for (const book of ["Student's Book", "Workbook"]) {
      await expect(page.getByRole("region", { name: book }).getByText("Готов", { exact: true })).toBeVisible({ timeout: 1000 });
    }
  }).toPass({ timeout: 30_000 });
  const textbookId = page.url().split("/").at(-1)!;
  const structure = {
    units: [
      {
        title: "Unit 1",
        lessons: [
          { title: "1.1", pages: { students_book: { from: 2, to: 3 }, workbook: { from: 1, to: 1 } }, tracks: ["1-01"], words: [] },
          { title: "1.2", pages: { students_book: { from: 4, to: 5 }, workbook: { from: 2, to: 2 } }, tracks: ["1-02"], words: [] },
          { title: "1.3", pages: { students_book: { from: 6, to: 7 }, workbook: { from: 3, to: 3 } }, tracks: [], words: [] },
        ],
      },
    ],
  };
  expect(await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).toBe(200);
  await page.reload();
  await page.getByRole("region", { name: "Структура" }).getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("region", { name: "Структура" })).toContainText("Подтверждена");

  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Разминка" });
  await page.getByLabel("Формат разминки").selectOption({ label: "Вопросы" });
  await page.getByLabel("Вопросы").fill(QUESTION);
  await page.getByLabel("Название").fill(WARM_UP);
  await page.getByLabel("Уровень").selectOption({ label: "A2" });
  await page.getByLabel("Тема").fill("lesson mode");
  await page.getByLabel("Возраст").selectOption({ label: "младшие" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

/**
 * A student on the textbook with 1.1 passed and a lesson tomorrow, prepared:
 * the warm-up, then Student's Book 1.2. Leaves the page on the lesson's
 * preparation.
 */
async function preparedLesson(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const block = page.getByRole("region", { name: "Учебник ученика" });
  await block.getByLabel("Учебник").selectOption({ label: BOOK });
  await block.getByLabel("Пройденный урок").selectOption({ label: "Unit 1 · 1.1" });
  await block.getByRole("button", { name: "Сохранить учебник", exact: true }).click();
  await expect(block.getByText("Сохранено")).toBeVisible();

  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("11:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();

  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  const stages = page.getByRole("list", { name: "План урока" }).getByRole("listitem");
  await expect(stages.first()).toContainText("Student's Book: 1.2");
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: WARM_UP });
  await control(page, "Добавить этап").click();
  await stages.filter({ hasText: WARM_UP }).getByRole("button", { name: "Выше", exact: true }).click();
  await expect(stages.first()).toContainText(WARM_UP);
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

/** The panel's stage list, and one stage in it by its name. */
function panelStage(page: Page, name: string) {
  return page.getByRole("list", { name: "Этапы урока" }).getByRole("listitem").filter({ hasText: name });
}

/** The book controls on the panel, under the current book stage. */
function bookControls(page: Page) {
  return page.getByRole("region", { name: "Учебник на сцене" });
}

/** True while some recording on the page is playing. */
function playing(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll("audio")].some((a) => !a.paused && !a.ended));
}

/** What the stage shows must never include what only the teacher sees. */
async function expectNothingOfThePanel(stage: Page, note?: string) {
  const text = await stage.locator("body").innerText();
  for (const forbidden of ["План урока", "Заметка", "мин", "Подготовка", "Ученики", "Расписание", "Завершить", HINT, ...(note ? [note] : [])]) {
    expect(text).not.toContain(forbidden);
  }
}

async function freshPanel(browser: Browser, url: string) {
  const context = await browser.newContext({ storageState: TEACHER_SESSION });
  const page = await context.newPage();
  await page.goto(url);
  return page;
}

test("«Запустить урок» opens the stage and the panel; the panel switches the stage, the page, the book, the layout and the track", async ({
  page,
  assistant,
}) => {
  await textbookAndWarmUp(page, assistant);
  await preparedLesson(page, "Сцена");
  const stage = await launch(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Сцена");

  // The plan's stages as tabs; the first is current and shows the warm-up.
  const tabs = stage.getByRole("tablist", { name: "Этапы урока" }).getByRole("tab");
  await expect(tabs).toHaveText([WARM_UP, "Student's Book: 1.2"]);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(stage.getByText(QUESTION)).toBeVisible();
  await expectNothingOfThePanel(stage);

  // The book stage opens at the lesson's first page of the Student's Book.
  await panelStage(page, "Student's Book: 1.2").getByRole("button", { name: "Student's Book: 1.2", exact: true }).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 4", exact: true })).toBeVisible();
  await expect(bookControls(page)).toContainText("Student's Book · стр. 4");

  // Paging goes past the lesson's pages; «К страницам урока» comes back.
  await bookControls(page).getByRole("button", { name: "Следующая страница", exact: true }).click();
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 5", exact: true })).toBeVisible();
  await bookControls(page).getByRole("button", { name: "Следующая страница", exact: true }).click();
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 6", exact: true })).toBeVisible();
  await expect(bookControls(page)).toContainText("Student's Book · стр. 6");
  await bookControls(page).getByRole("button", { name: "К страницам урока", exact: true }).click();
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 4", exact: true })).toBeVisible();

  // A spread: the left even page and the right odd one.
  await bookControls(page).getByRole("button", { name: "Разворот", exact: true }).click();
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 4", exact: true })).toBeVisible();
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 5", exact: true })).toBeVisible();
  await bookControls(page).getByRole("button", { name: "1 страница", exact: true }).click();
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 5", exact: true })).toHaveCount(0);

  // The Workbook opens at the lesson's page in it.
  await bookControls(page).getByRole("button", { name: "Workbook", exact: true }).click();
  await expect(stage.getByRole("img", { name: "Workbook, стр. 2", exact: true })).toBeVisible();
  await expect(stage.getByRole("img", { name: /Student's Book/ })).toHaveCount(0);

  // The lesson's track plays on the stage, started and stopped on the panel.
  // A browser lets a new window play sound only after a click in it: the teacher turns the sound on once.
  await stage.getByRole("button", { name: "Включить звук", exact: true }).click();
  const track = page.getByRole("region", { name: "Треки урока" });
  await track.getByRole("button", { name: "Играть 1-02", exact: true }).click();
  await expect.poll(() => playing(stage)).toBe(true);
  expect(await playing(page)).toBe(false);
  await track.getByRole("button", { name: "Стоп", exact: true }).click();
  await expect.poll(() => playing(stage)).toBe(false);

  await expectNothingOfThePanel(stage);
});

test("a stage closed mid-lesson opens again on the same stage and page; the note is kept as she writes", async ({ page, browser }) => {
  await preparedLesson(page, "Сцена снова");
  let stage = await launch(page);
  const panel = page.url();
  expect(panel).toMatch(/\/teacher\/lesson\/[0-9a-f-]{36}$/);

  await panelStage(page, "Student's Book: 1.2").getByRole("button", { name: "Student's Book: 1.2", exact: true }).click();
  await bookControls(page).getByRole("button", { name: "Следующая страница", exact: true }).click();
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 5", exact: true })).toBeVisible();

  // Closed by accident and opened again from the panel: the same stage and page.
  await stage.close();
  const reopened = page.context().waitForEvent("page");
  await control(page, "Открыть сцену").click();
  stage = await reopened;
  const tabs = stage.getByRole("tablist", { name: "Этапы урока" }).getByRole("tab");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 5", exact: true })).toBeVisible();

  // The note is saved as she writes, and never reaches the stage.
  const note = "Asked about pets, practise plurals";
  await page.getByLabel("Заметка к уроку").fill(note);
  await expect(page.getByText("Заметка сохранена")).toBeVisible();
  await expectNothingOfThePanel(stage, note);

  // The panel reloaded keeps the note, the stage and the page.
  await page.reload();
  await expect(page.getByLabel("Заметка к уроку")).toHaveValue(note);
  await expect(bookControls(page)).toContainText("Student's Book · стр. 5");

  // Kept on the server too: a browser without this one's storage sees the same.
  // The state goes to the server every few seconds, so this browser looks again until it is there.
  const elsewhere = await freshPanel(browser, panel);
  await expect(async () => {
    await elsewhere.reload();
    await expect(elsewhere.getByLabel("Заметка к уроку")).toHaveValue(note, { timeout: 1000 });
    await expect(bookControls(elsewhere)).toContainText("Student's Book · стр. 5", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await elsewhere.context().close();
});
