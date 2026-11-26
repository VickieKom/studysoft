// Acceptance for #416: during the lesson the teacher follows the teacher's
// book while the child sees the student's book on the stage. On a book stage
// the panel has a collapsible «Teacher's Book» block with the lesson's pages
// in it (#415), opened at the first of them. It turns its own pages, past the
// lesson's range too; it never changes the stage, and nothing of it reaches
// the stage. A lesson without a teacher's book range has no block (product
// owner, 2026-11-26).
//
// The teacher starts signed in (sessions.setup.ts). The books are synthetic,
// made here: pages that say their number.
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
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

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The second scenario uses the textbook the first one sets up.
test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;
const BOOK = "Demo Panel Teacher Set";

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

/**
 * A set of an eight-page student's book and a five-page teacher's book with a
 * confirmed unit: 1.1 on pages 2–3, 1.2 on pages 4–5 with teacher's book
 * pages 2–3, 1.3 on pages 6–7 without any.
 */
async function textbook(page: Page, assistant: APIRequestContext) {
  const token = await assistantToken(page);
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(BOOK);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: pdf(8) });
  await page.getByLabel("Teacher's Book (PDF)").setInputFiles({ name: "teachers-book.pdf", mimeType: "application/pdf", buffer: pdf(5) });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: BOOK })).toBeVisible();
  await rendered(page, ["Student's Book", "Teacher's Book"]);
  const textbookId = page.url().split("/").at(-1)!;
  const structure = {
    units: [
      {
        title: "Unit 1",
        lessons: [
          { title: "1.1", pages: { students_book: { from: 2, to: 3 } }, tracks: [], words: [] },
          { title: "1.2", pages: { students_book: { from: 4, to: 5 }, teachers_book: { from: 2, to: 3 } }, tracks: [], words: [] },
          { title: "1.3", pages: { students_book: { from: 6, to: 7 } }, tracks: [], words: [] },
        ],
      },
    ],
  };
  expect((await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).status).toBe(200);
  await page.reload();
  const outline = page.getByRole("region", { name: "Структура" });
  await outline.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(outline).toContainText("Подтверждена");
}

/** A student with `passed` passed and a lesson tomorrow, its plan the proposed next book lesson; returns the stage window, the panel in `page`. */
async function launchedLesson(page: Page, firstName: string, passed: string, next: string) {
  await createStudent(page, firstName);
  const block = page.getByRole("region", { name: "Учебник ученика" });
  await block.getByLabel("Учебник").selectOption({ label: BOOK });
  await block.getByLabel("Пройденный урок").selectOption({ label: `Unit 1 · ${passed}` });
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
  await expect(page.getByRole("list", { name: "План урока" }).getByRole("listitem").first()).toContainText(`Student's Book: ${next}`);
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();

  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();
  return stage;
}

test("the panel shows the lesson's teacher's book pages and turns them, past the lesson too; the stage never changes or shows them", async ({
  page,
  assistant,
}) => {
  await textbook(page, assistant);
  const stage = await launchedLesson(page, "Пульт с книгой", "1.1", "1.2");
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 4", exact: true })).toBeVisible();

  const block = page.getByRole("region", { name: "Teacher's Book", exact: true });
  await block.getByRole("button", { name: "Показать Teacher's Book", exact: true }).click();
  await expect(block.getByRole("img", { name: "Teacher's Book, стр. 2", exact: true })).toBeVisible();
  await expect(block).toContainText("Урок: стр. 2–3");

  await block.getByRole("button", { name: "Следующая страница", exact: true }).click();
  await expect(block.getByRole("img", { name: "Teacher's Book, стр. 3", exact: true })).toBeVisible();
  await block.getByRole("button", { name: "Следующая страница", exact: true }).click();
  await expect(block.getByRole("img", { name: "Teacher's Book, стр. 4", exact: true })).toBeVisible();
  await block.getByRole("button", { name: "Предыдущая страница", exact: true }).click();
  await expect(block.getByRole("img", { name: "Teacher's Book, стр. 3", exact: true })).toBeVisible();

  // The stage is where it was, and nothing of the teacher's book is on it.
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 4", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Учебник на сцене" })).toContainText("Student's Book · стр. 4");
  await expect(stage.getByRole("img", { name: /Teacher's Book/ })).toHaveCount(0);
  expect(await stage.locator("body").innerText()).not.toContain("Teacher's Book");

  await block.getByRole("button", { name: "Скрыть Teacher's Book", exact: true }).click();
  await expect(block.getByRole("img")).toHaveCount(0);
});

test("a lesson without a teacher's book range has no teacher's book block on the panel", async ({ page }) => {
  const stage = await launchedLesson(page, "Пульт без книги", "1.2", "1.3");
  await expect(stage.getByRole("img", { name: "Student's Book, стр. 6", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Учебник на сцене" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Teacher's Book", exact: true })).toHaveCount(0);
});
