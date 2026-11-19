// Acceptance for #151: «Подготовка» — the teacher prepares a student's next
// lesson. The student's card names their textbook and their passed lesson
// (product owner, 2026-11-18: chosen on the card; the plan of the latest held
// lesson moves it on). The preparation proposes the next book lesson; the
// teacher adds a warm-up and a game from the library, skips exercises, moves
// a stage and saves: the lesson is «подготовлен» in the list. The assistant
// saves a plan as a draft through HTTP; the teacher sees it «от ассистента»,
// removes a stage and approves it; the assistant cannot approve. A homework
// draft attached to the lesson stays a draft: the student does not see it.
// Another teacher's lesson not found for the assistant is pinned by an
// integration test.
//
// The teacher starts signed in (sessions.setup.ts). The textbook, the
// materials and the homework are synthetic, made here.
import { type APIRequestContext, expect, type Locator, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

// A student's or the assistant's client has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// One token per teacher, and the second scenario uses what the first set up.
test.describe.configure({ mode: "serial" });

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

async function addMaterial(page: Page, kind: "Игра" | "Разминка", title: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: kind });
  if (kind === "Игра") {
    await page
      .getByLabel("Файл игры")
      .setInputFiles({ name: "game.html", mimeType: "text/html", buffer: Buffer.from(`<!doctype html><title>${title}</title><h1>${title}</h1>`) });
  } else {
    await page.getByLabel("Формат разминки").selectOption({ label: "Вопросы" });
    await page.getByLabel("Вопросы").fill("What did you do today?");
  }
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption({ label: "A2" });
  await page.getByLabel("Тема").fill("lesson prep");
  await page.getByLabel("Возраст").selectOption({ label: "младшие" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

let token: string;

test("the next book lesson is proposed; the teacher adds library stages, skips exercises, reorders, saves; a homework draft stays a draft", async ({
  page,
  browser,
  assistant,
}) => {
  token = await createToken(page);
  await textbookWithLessons(page, assistant, token, "Demo Prep Book");
  await addMaterial(page, "Разминка", "Prep warm-up");
  await addMaterial(page, "Игра", "Prep game");
  const { card, link } = await studentWithTextbook(page, "Готовимся", "Demo Prep Book");

  // A homework draft on the card, to attach to the lesson.
  await page.goto(card);
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(
    JSON.stringify({ version: 1, title: "Prep homework", tasks: [{ type: "single_choice", prompt: "Pick one.", options: ["a", "b"], answer: 0 }] }),
  );
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  // Saved before the scenario moves on: the import opens the new draft's page (#210).
  await expect(page).toHaveURL(/\/teacher\/students\/[0-9a-f-]{36}\/homework\/[0-9a-f-]{36}$/);

  const item = await openPreparation(page, "Готовимся");
  await expect(item).toContainText("не подготовлен");
  await item.getByRole("link").first().click();

  // The book stage is proposed: the lesson after the passed one.
  await expect(stages(page)).toHaveCount(1);
  await expect(stages(page).first()).toContainText("Student's Book: 1.3");

  await page.getByLabel("Добавить из библиотеки").selectOption({ label: "Prep warm-up" });
  await control(page, "Добавить этап").click();
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: "Prep game" });
  await control(page, "Добавить этап").click();
  await expect(stages(page)).toHaveCount(3);
  // The warm-up goes first.
  await stages(page).filter({ hasText: "Prep warm-up" }).getByRole("button", { name: "Выше", exact: true }).click();
  await expect(stages(page).first()).toContainText("Prep warm-up");
  const book = stages(page).filter({ hasText: "Student's Book" });
  await book.getByLabel("Пропустить упражнения").fill("3, 5");
  await book.getByLabel("Минуты").fill("25");

  const homework = page.getByRole("region", { name: "Домашка к уроку" });
  await homework.getByLabel("Черновик домашки").selectOption({ label: "Prep homework" });

  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();

  // Kept as saved.
  await page.reload();
  await expect(stages(page).nth(0)).toContainText("Prep warm-up");
  await expect(stages(page).nth(1)).toContainText("Student's Book: 1.3");
  await expect(stages(page).nth(1).getByLabel("Пропустить упражнения")).toHaveValue("3, 5");
  await expect(stages(page).nth(2)).toContainText("Prep game");
  await expect(homework.getByLabel("Черновик домашки")).toHaveValue(/.+/);
  await expect(await openPreparation(page, "Готовимся")).toContainText("подготовлен");
  await expect(await openPreparation(page, "Готовимся")).not.toContainText("не подготовлен");

  // The homework is attached, not published: the student sees none.
  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  await expect(student.getByText("Pick one.")).toHaveCount(0);
  await expect(student.getByText("Prep homework")).toHaveCount(0);
  await student.context().close();
});

test("the assistant's plan is a draft «от ассистента»; the teacher removes a stage and approves; the assistant cannot approve", async ({
  page,
  assistant,
}) => {
  await studentWithTextbook(page, "План ассистента", "Demo Prep Book");
  const item = await openPreparation(page, "План ассистента");
  await item.getByRole("link").first().click();
  // The lesson's own page, before its address is read.
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  const lessonId = page.url().split("/").at(-1)!;

  const books = await agentCall(assistant, token, "agent.listTextbooks", undefined, true);
  const textbook = books.body.result.data.find((t: { title: string }) => t.title === "Demo Prep Book");
  const structure = await agentCall(assistant, token, "agent.textbookStructure", { textbookId: textbook.id }, true);
  const third = structure.body.result.data.structure.units[0].lessons[2];
  const library = await agentCall(assistant, token, "agent.lessonMaterials", { lessonId }, true);
  const game = library.body.result.data.find((m: { title: string }) => m.title === "Prep game");

  const plan = {
    stages: [
      { type: "book", lessonId: third.id, skip: "", minutes: 30 },
      { type: "material", materialId: game.id, minutes: 10 },
    ],
  };
  expect((await agentCall(assistant, token, "agent.saveLessonPlan", { lessonId, plan })).status).toBe(200);
  // No agent procedure approves: the same answer as one that does not exist.
  const none = await agentCall(assistant, token, "agent.noSuchProcedure", { lessonId });
  expect((await agentCall(assistant, token, "agent.approveLessonPlan", { lessonId })).status).toBe(none.status);

  await page.reload();
  await expect(page.getByText("План от ассистента")).toBeVisible();
  await expect(stages(page)).toHaveCount(2);
  await stages(page).filter({ hasText: "Prep game" }).getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(stages(page)).toHaveCount(1);
  await control(page, "Утвердить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();
  await page.reload();
  await expect(page.getByText("План от ассистента")).toHaveCount(0);
  await expect(stages(page)).toHaveCount(1);
  await expect(stages(page).first()).toContainText("Student's Book: 1.3");
  await expect(await openPreparation(page, "План ассистента")).not.toContainText("не подготовлен");
});
