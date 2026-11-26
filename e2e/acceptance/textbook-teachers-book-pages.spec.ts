// Acceptance for #415: each lesson of a textbook's structure has its own page
// range in the teacher's book (#414), like the student's book and the
// workbook: the assistant saves it in its draft, the teacher corrects and
// confirms it, or enters it by hand; a range past the book's pages is refused
// with the lesson named. The lesson's page in «Библиотека» shows its teacher's
// book pages next to the other books', and in «Подготовка» the book stage
// links to that page (product owner, 2026-11-26).
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
// Later scenarios use the textbook the first one marks out; one token per teacher.
test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;
const BOOK = "Demo Teacher Pages";

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

/** A set of a six-page student's book and a three-page teacher's book, rendered; returns its id. */
async function uploadSet(page: Page, title: string) {
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: pdf(6) });
  await page.getByLabel("Teacher's Book (PDF)").setInputFiles({ name: "teachers-book.pdf", mimeType: "application/pdf", buffer: pdf(3) });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await rendered(page, ["Student's Book", "Teacher's Book"]);
  return page.url().split("/").at(-1)!;
}

const lessonOf = (title: string, from: number, teachers?: { from: number; to: number }) => ({
  title,
  pages: { students_book: { from, to: from + 1 }, ...(teachers ? { teachers_book: teachers } : {}) },
  tracks: [],
  words: [],
});

let textbookId: string;

test("the assistant saves a lesson's teacher's book range; the teacher corrects and confirms it; the lesson's page shows those pages", async ({
  page,
  assistant,
}) => {
  textbookId = await uploadSet(page, BOOK);
  const token = await assistantToken(page);
  const structure = { units: [{ title: "Unit 1", lessons: [lessonOf("1.1", 2, { from: 1, to: 1 }), lessonOf("1.2", 4, { from: 2, to: 3 })] }] };
  expect((await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).status).toBe(200);

  await page.goto(`/teacher/library/textbooks/${textbookId}`);
  const editor = page.getByRole("region", { name: "Структура" });
  await expect(editor).toContainText("Черновик от ассистента");
  const second = editor.getByRole("group", { name: "Юнит 1", exact: true }).getByRole("group", { name: "Урок 2", exact: true });
  await expect(second.getByLabel("Teacher's Book с")).toHaveValue("2");
  await expect(second.getByLabel("Teacher's Book по")).toHaveValue("3");
  await second.getByLabel("Teacher's Book по").fill("2");
  await editor.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(editor).toContainText("Подтверждена");

  await page.getByRole("link", { name: "1.2", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "1.2" })).toBeVisible();
  const teachers = page.getByRole("region", { name: "Teacher's Book", exact: true });
  await expect(teachers).toContainText("Teacher's Book, стр. 2");
  await expect(teachers.getByRole("img", { name: /^Страница \d+$/ })).toHaveCount(1);
  await expect(teachers.getByRole("img", { name: "Страница 2", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Student's Book", exact: true }).getByRole("img", { name: /^Страница \d+$/ })).toHaveCount(2);
});

test("a teacher's book range past the book's pages is refused with the lesson named", async ({ page, assistant }) => {
  const token = await assistantToken(page);
  const structure = { units: [{ title: "Unit 1", lessons: [lessonOf("1.1", 2, { from: 2, to: 9 })] }] };
  const refused = await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure });
  expect(refused.status).toBe(400);
  expect(JSON.stringify(refused.body)).toContain("юнит 1, урок 1: в Teacher's Book 3 страниц, а урок доходит до 9");
});

test("the teacher enters a teacher's book range by hand and confirms it", async ({ page }) => {
  const handId = await uploadSet(page, "Demo Teacher Pages by Hand");
  await page.goto(`/teacher/library/textbooks/${handId}`);
  const editor = page.getByRole("region", { name: "Структура" });
  await editor.getByRole("button", { name: "Разметить вручную", exact: true }).click();
  const unit = editor.getByRole("group", { name: "Юнит 1", exact: true });
  await unit.getByLabel("Название юнита").fill("Starter unit");
  const lesson = unit.getByRole("group", { name: "Урок 1", exact: true });
  await lesson.getByLabel("Название урока").fill("Starter");
  await lesson.getByLabel("Student's Book с").fill("1");
  await lesson.getByLabel("Student's Book по").fill("2");
  await lesson.getByLabel("Teacher's Book с").fill("3");
  await lesson.getByLabel("Teacher's Book по").fill("3");
  await editor.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(editor).toContainText("Подтверждена");

  await page.getByRole("link", { name: "Starter", exact: true }).click();
  await expect(page.getByRole("region", { name: "Teacher's Book", exact: true })).toContainText("Teacher's Book, стр. 3");
});

test("in «Подготовка» the book stage links to the lesson's page with its teacher's book pages", async ({ page }) => {
  const firstName = "Страницы учителя";
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
  const stage = page.getByRole("list", { name: "План урока" }).getByRole("listitem").filter({ hasText: "Student's Book: 1.2" });
  await stage.getByRole("link", { name: "Страницы урока", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "1.2" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Teacher's Book", exact: true })).toContainText("Teacher's Book, стр. 2");
});
