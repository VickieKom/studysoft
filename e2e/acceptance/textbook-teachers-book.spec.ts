// Acceptance for #414: the teacher's book is an optional third book of a
// textbook set. It is attached when the textbook is created, or added later
// on the textbook's page; its pages render like the other books'. Its file
// and its pages are the teacher's only: a student by their link and another
// teacher get the same 404 as for a missing one. The assistant lists it and
// reads its text and its pages. It is never a book of the stage, which the
// child sees: the panel offers no teacher's book among the stage's books
// (product owner, 2026-11-26). A lesson state whose stage shows it is refused
// by an integration test.
//
// The teacher starts signed in (sessions.setup.ts). The books and the warm-up
// are synthetic, made here: pages that say their number.
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

// The assistant's client, a student's browser and a parent's have no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// Later scenarios use the textbook the first one uploads.
test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;
const BOOK = "Demo Teacher Set";
const LATER = "Demo Teacher Set Later";
const WARM_UP = "Teacher's book warm-up";

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

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function assistantToken(page: Page) {
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

/** Waits until every named book of the textbook's page is rendered. */
async function rendered(page: Page, books: string[]) {
  await expect(async () => {
    await page.reload();
    for (const book of books) {
      await expect(page.getByRole("region", { name: book, exact: true }).getByText("Готов", { exact: true })).toBeVisible({ timeout: 1000 });
    }
  }).toPass({ timeout: 30_000 });
}

/** A new student; returns the student's link. */
async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

let textbookId: string;
let teacherPage: string;
let teacherFile: string;

test("a textbook is created with a teacher's book, whose pages render like the other books'", async ({ page }) => {
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(BOOK);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: pdf(6) });
  await page.getByLabel("Workbook (PDF)").setInputFiles({ name: "workbook.pdf", mimeType: "application/pdf", buffer: pdf(3) });
  await page.getByLabel("Teacher's Book (PDF)").setInputFiles({ name: "teachers-book.pdf", mimeType: "application/pdf", buffer: pdf(3) });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: BOOK })).toBeVisible();
  textbookId = page.url().split("/").at(-1)!;

  await rendered(page, ["Student's Book", "Workbook", "Teacher's Book"]);
  const pages = page.getByRole("region", { name: "Teacher's Book", exact: true }).getByRole("img", { name: /^Страница \d+$/ });
  await expect(pages).toHaveCount(3);
  teacherPage = new URL((await pages.nth(1).getAttribute("src"))!, page.url()).toString();
  teacherFile = teacherPage.replace(/\/pages\/\d+$/, "");
  const forTeacher = await page.request.get(teacherPage);
  expect(forTeacher.status()).toBe(200);
  expect(forTeacher.headers()["content-type"]).toMatch(/^image\//);
  expect((await page.request.get(teacherFile)).status()).toBe(200);
});

test("a student by their link and another teacher get the same 404 for the teacher's book as for a missing one", async ({ page, browser }) => {
  const link = await createStudent(page, "Без книги учителя");
  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  const otherTeacher = await (await browser.newContext({ storageState: SECOND_TEACHER_SESSION })).newPage();

  for (const visitor of [student, otherTeacher]) {
    for (const real of [teacherPage, teacherFile]) {
      const missing = real.replace(/[0-9a-f-]{36}/, "00000000-0000-4000-8000-000000000000");
      const got = await visitor.request.get(real);
      const none = await visitor.request.get(missing);
      expect(got.status()).toBe(404);
      expect({ status: got.status(), body: await got.text() }).toEqual({ status: none.status(), body: await none.text() });
    }
    await visitor.context().close();
  }
});

test("the assistant lists the teacher's book and reads its text and its pages", async ({ page, assistant }) => {
  const token = await assistantToken(page);
  const listed = await agentCall(assistant, token, "agent.listTextbooks", undefined, true);
  expect(listed.status).toBe(200);
  const set = listed.body.result.data.find((t: { id: string }) => t.id === textbookId);
  const book = set.books.find((b: { kind: string }) => b.kind === "teachers_book");
  expect(book).toMatchObject({ status: "done", pageCount: 3 });

  const text = await agentCall(assistant, token, "agent.textbookText", { bookId: book.id, from: 2, to: 2 }, true);
  expect(text.status).toBe(200);
  expect(text.body.result.data).toEqual([{ page: 2, text: expect.stringContaining("Page 2") }]);

  const image = await agentCall(assistant, token, "agent.textbookPage", { bookId: book.id, page: 2 }, true);
  expect(image.status).toBe(200);
  expect(image.body.result.data.contentType).toMatch(/^image\//);
  expect(image.body.result.data.base64.length).toBeGreaterThan(0);
});

test("a teacher's book is added to a textbook created without one, and its structure stays", async ({ page, assistant }) => {
  const token = await assistantToken(page);
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(LATER);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: pdf(4) });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: LATER })).toBeVisible();
  const laterId = page.url().split("/").at(-1)!;
  await rendered(page, ["Student's Book"]);
  await expect(page.getByRole("region", { name: "Teacher's Book", exact: true })).toHaveCount(0);

  const structure = {
    units: [{ title: "Unit 1", lessons: [{ title: "1.1", pages: { students_book: { from: 2, to: 3 } }, tracks: [], words: [] }] }],
  };
  expect((await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId: laterId, structure })).status).toBe(200);
  await page.reload();
  const outline = page.getByRole("region", { name: "Структура" });
  await outline.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(outline).toContainText("Подтверждена");

  await page.getByLabel("Teacher's Book (PDF)").setInputFiles({ name: "teachers-book.pdf", mimeType: "application/pdf", buffer: pdf(2) });
  await control(page, "Добавить Teacher's Book").click();
  await rendered(page, ["Teacher's Book"]);
  await expect(page.getByRole("region", { name: "Teacher's Book", exact: true }).getByRole("img", { name: /^Страница \d+$/ })).toHaveCount(2);
  await expect(outline).toContainText("Подтверждена");
  await expect(outline.getByRole("link", { name: "1.1", exact: true })).toBeVisible();
});

test("in the lesson mode the panel offers no teacher's book among the stage's books", async ({ page, assistant }) => {
  const token = await assistantToken(page);
  const structure = {
    units: [
      {
        title: "Unit 1",
        lessons: [
          { title: "1.1", pages: { students_book: { from: 2, to: 3 }, workbook: { from: 1, to: 1 } }, tracks: [], words: [] },
          { title: "1.2", pages: { students_book: { from: 4, to: 5 }, workbook: { from: 2, to: 2 } }, tracks: [], words: [] },
        ],
      },
    ],
  };
  expect((await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).status).toBe(200);
  await page.goto(`/teacher/library/textbooks/${textbookId}`);
  const outline = page.getByRole("region", { name: "Структура" });
  await outline.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(outline).toContainText("Подтверждена");

  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Разминка" });
  await page.getByLabel("Формат разминки").selectOption({ label: "Вопросы" });
  await page.getByLabel("Вопросы").fill("What is your favourite day?");
  await page.getByLabel("Название").fill(WARM_UP);
  await page.getByLabel("Уровень").selectOption({ label: "A2" });
  await page.getByLabel("Тема").fill("teacher's book");
  await page.getByLabel("Возраст").selectOption({ label: "младшие" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();

  const firstName = "Книга учителя";
  await createStudent(page, firstName);
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
  const stages = page.getByRole("list", { name: "План урока" }).getByRole("listitem");
  await expect(stages.first()).toContainText("Student's Book: 1.2");
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: WARM_UP });
  await control(page, "Добавить этап").click();
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();

  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();

  await page
    .getByRole("list", { name: "Этапы урока" })
    .getByRole("listitem")
    .filter({ hasText: "Student's Book: 1.2" })
    .getByRole("button", { name: "Student's Book: 1.2", exact: true })
    .click();
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 4", exact: true })).toBeVisible();
  const books = page.getByRole("region", { name: "Учебник на сцене" });
  await expect(books.getByRole("button", { name: "Workbook", exact: true })).toBeVisible();
  await expect(books.getByRole("button", { name: "Teacher's Book", exact: true })).toHaveCount(0);
  await expect(stage.getByRole("img", { name: /Teacher's Book/ })).toHaveCount(0);
  expect(await stage.locator("body").innerText()).not.toContain("Teacher's Book");
});
