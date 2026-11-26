// Acceptance for #417: a wrong PDF uploaded as the teacher's book can be put
// right. On the textbook's page «Заменить» puts a new PDF in its place, and
// «Убрать» takes it off the set. A teacher's book range that reaches past the
// new file's pages shows as an error at its lesson, never dropped silently;
// «Убрать», once confirmed, removes the book and its ranges from the confirmed
// structure at once, the rest of it unchanged (product owner, 2026-11-26).
// The old file is served to nobody once replaced.
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

test.use({ storageState: TEACHER_SESSION });
// The second scenario uses the textbook the first one sets up.
test.describe.configure({ mode: "serial" });

const BOOK = "Demo Teacher Replace";

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

let textbookId: string;

test("«Заменить» puts a new teacher's book in place; a range past its pages shows as an error at its lesson; the old file is gone", async ({
  page,
  assistant,
}) => {
  const token = await assistantToken(page);
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(BOOK);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: pdf(6) });
  await page.getByLabel("Teacher's Book (PDF)").setInputFiles({ name: "teachers-book.pdf", mimeType: "application/pdf", buffer: pdf(3) });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: BOOK })).toBeVisible();
  textbookId = page.url().split("/").at(-1)!;
  await rendered(page, ["Student's Book", "Teacher's Book"]);

  const structure = {
    units: [
      {
        title: "Unit 1",
        lessons: [
          { title: "1.1", pages: { students_book: { from: 2, to: 3 }, teachers_book: { from: 2, to: 3 } }, tracks: [], words: [] },
          { title: "1.2", pages: { students_book: { from: 4, to: 5 }, teachers_book: { from: 1, to: 1 } }, tracks: [], words: [] },
        ],
      },
    ],
  };
  expect((await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).status).toBe(200);
  await page.reload();
  const outline = page.getByRole("region", { name: "Структура" });
  await outline.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(outline).toContainText("Подтверждена");

  const teachers = page.getByRole("region", { name: "Teacher's Book", exact: true });
  const oldPage = new URL((await teachers.getByRole("img", { name: "Страница 2", exact: true }).getAttribute("src"))!, page.url()).toString();
  expect((await page.request.get(oldPage)).status()).toBe(200);

  await teachers.getByLabel("Новый Teacher's Book (PDF)").setInputFiles({ name: "teachers-book-2.pdf", mimeType: "application/pdf", buffer: pdf(2) });
  await teachers.getByRole("button", { name: "Заменить", exact: true }).click();
  // The old book is gone once the replacement is saved; only then is the new one's rendering worth waiting for.
  await expect.poll(async () => (await page.request.get(oldPage)).status(), { timeout: 30_000 }).toBe(404);
  await rendered(page, ["Teacher's Book"]);
  await expect(page.getByRole("region", { name: "Teacher's Book", exact: true }).getByRole("img", { name: /^Страница \d+$/ })).toHaveCount(2);
  await expect(outline).toContainText("юнит 1, урок 1: в Teacher's Book 2 страниц, а урок доходит до 3");
  await expect(outline).not.toContainText("урок 2:");
});

test("«Убрать», once confirmed, takes the teacher's book off with its ranges; the rest of the structure stays", async ({ page }) => {
  await page.goto(`/teacher/library/textbooks/${textbookId}`);
  const teachers = page.getByRole("region", { name: "Teacher's Book", exact: true });
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Убрать Teacher's Book?");
    void dialog.accept();
  });
  await teachers.getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(page.getByRole("region", { name: "Teacher's Book", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Добавить Teacher's Book", exact: true })).toBeVisible();

  const outline = page.getByRole("region", { name: "Структура" });
  await expect(outline).toContainText("Подтверждена");
  await expect(outline).not.toContainText("Teacher's Book");
  await outline.getByRole("link", { name: "1.1", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "1.1" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Student's Book", exact: true }).getByRole("img", { name: /^Страница \d+$/ })).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Teacher's Book", exact: true })).toHaveCount(0);
});
