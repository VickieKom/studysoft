// Acceptance for #293: in a student's lesson prep, «Добавить из
// библиотеки» offers the games in three labelled groups, each by title: the
// ones made for this student, then the ones linked to a textbook lesson that
// is a book stage of the plan, then the rest. Removing the book stage moves
// its games to the rest. A game in both of the first two groups is listed
// once, in the first; that is pinned by a unit test.
//
// The teacher starts signed in (sessions.setup.ts). The textbook, the
// student and the games are synthetic, made here.
import { type APIRequestContext, expect, type Locator, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const DAY = 86_400_000;

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

/** A textbook of six pages with a confirmed unit of lessons 1.1–1.3, saved by the assistant and confirmed by the teacher. */
async function textbookWithLessons(page: Page, assistant: APIRequestContext, token: string, title: string) {
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "book.pdf", mimeType: "application/pdf", buffer: pdf(6) });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("region", { name: "Student's Book" }).getByText("Готов", { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const textbookId = page.url().split("/").at(-1)!;
  const lesson = (name: string, from: number) => ({ title: name, pages: { students_book: { from, to: from + 1 } }, tracks: [], words: [] });
  const structure = { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1), lesson("1.2", 3), lesson("1.3", 5)] }] };
  expect((await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).status).toBe(200);
  await page.reload();
  await page.getByRole("region", { name: "Структура" }).getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("region", { name: "Структура" })).toContainText("Подтверждена");
  return textbookId;
}

/** A student with the textbook chosen on the card and lesson 1.2 passed; a lesson with them tomorrow. Returns the card's address and the student's link. */
async function studentWithTextbook(page: Page, firstName: string, textbook: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  const block = page.getByRole("region", { name: "Учебник ученика" });
  await block.getByLabel("Учебник").selectOption({ label: textbook });
  await block.getByLabel("Пройденный урок").selectOption({ label: "Unit 1 · 1.2" });
  await block.getByRole("button", { name: "Сохранить учебник", exact: true }).click();
  await expect(block.getByText("Сохранено")).toBeVisible();

  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
  return { card, link };
}

/** «Подготовка» in the menu, and the student's upcoming lesson in it. */
async function openPreparation(page: Page, firstName: string): Promise<Locator> {
  await page.goto("/teacher/students");
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Подготовка" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Подготовка" })).toBeVisible();
  return page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName });
}

const stages = (page: Page) => page.getByRole("list", { name: "План урока" }).getByRole("listitem");

/** A game uploaded with «Учебник» and «Урок», or «Для учеников», as given. */
async function uploadGame(page: Page, title: string, { lesson, forStudent }: { lesson?: string; forStudent?: string } = {}) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: Buffer.from(`<!doctype html><title>${title}</title><h1>${title}</h1>`) });
  await page.getByLabel("Название").fill(title);
  if (lesson) {
    await page.getByLabel("Учебник").selectOption({ label: "Ordering book" });
    await page.getByLabel("Урок").selectOption({ label: lesson });
  }
  if (forStudent) await page.getByRole("group", { name: "Для учеников" }).getByRole("checkbox", { name: forStudent, exact: true }).check();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

/** The titles of one labelled group of «Добавить из библиотеки», in order. */
function group(page: Page, label: string): Locator {
  return page.getByLabel("Добавить из библиотеки").locator(`optgroup[label="${label}"] option`);
}

test("games come for this student first, then for the plan's book lessons, then the rest; removing the book stage moves its game", async ({ page, assistant }) => {
  const token = await createToken(page);
  await textbookWithLessons(page, assistant, token, "Ordering book");
  await studentWithTextbook(page, "Порядковый", "Ordering book");
  await uploadGame(page, "Zeta for the student", { forStudent: "Порядковый" });
  await uploadGame(page, "Alpha of 1.3", { lesson: "Unit 1 · 1.3" });
  await uploadGame(page, "Beta of 1.1", { lesson: "Unit 1 · 1.1" });
  await uploadGame(page, "Gamma plain");

  const item = await openPreparation(page, "Порядковый");
  await item.getByRole("link").first().click();
  // The proposed book stage is 1.3, the lesson after the passed one.
  await expect(stages(page)).toHaveCount(1);
  await expect(stages(page).first()).toContainText("Student's Book: 1.3");

  await expect(group(page, "Для ученика")).toHaveText(["Zeta for the student"]);
  await expect(group(page, "К урокам плана")).toHaveText(["Alpha of 1.3"]);
  const rest = await group(page, "Остальные").allTextContents();
  expect(rest).toEqual(expect.arrayContaining(["Beta of 1.1", "Gamma plain"]));
  expect(rest).not.toContain("Alpha of 1.3");
  expect(rest).not.toContain("Zeta for the student");

  // Without the book stage, its game goes to the rest.
  await stages(page).first().getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(group(page, "К урокам плана")).toHaveCount(0);
  expect(await group(page, "Остальные").allTextContents()).toContain("Alpha of 1.3");
  await expect(group(page, "Для ученика")).toHaveText(["Zeta for the student"]);
});
