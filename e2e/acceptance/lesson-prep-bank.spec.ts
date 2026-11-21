// Acceptance for #226: the workbook task bank, part C. In «Подготовка» →
// «Домашка к уроку» the teacher sees the confirmed tasks of the plan's book
// lesson as the child will see them, each with a checkbox. «Собрать домашку»
// creates «Домашка: урок 1.2» for the student from the checked tasks and
// attaches it to the lesson; building again appends to the attached draft.
// The tasks are copied: an edit of the bank afterwards leaving the built
// draft as it was is pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts). The PDF (six pages that
// say their number) and the tasks are synthetic, made here.
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

// The assistant has no teacher session: a context made here would otherwise inherit hers from test.use.
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

const workbook = (page: string, exercise: string) => ({ book: "Workbook", unit: "1", page, exercise });
const lemon = {
  type: "single_choice",
  prompt: "Choose the colour of a lemon.",
  options: ["yellow", "purple"],
  answer: 0,
  topic: "colours",
  skill: "vocabulary",
  source: workbook("5", "1"),
};
const frog = {
  type: "gap",
  prompt: "Complete the sentence about the frog.",
  text: "The frog ___ in the pond.",
  answers: [["swims"]],
  topic: "present simple",
  skill: "grammar",
  source: workbook("5", "2"),
};
const garden = {
  type: "written",
  prompt: "Write two lines about a garden.",
  topic: "nature",
  skill: "writing",
  source: workbook("5", "3"),
};

/** A textbook of six pages with lessons 1.1–1.3 confirmed, and lesson 1.2's three tasks confirmed in the bank. */
async function textbookWithBank(page: Page, assistant: APIRequestContext, token: string, title: string) {
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
  const saved = await agentCall(assistant, token, "agent.textbookStructure", { textbookId }, true);
  const lessonId: string = saved.body.result.data.structure.units[0].lessons[1].id;
  const tasks = [lemon, frog, garden];
  expect((await agentCall(assistant, token, "agent.saveTextbookLessonTasks", { textbookId, lessonId, tasks, skipped: [] })).status).toBe(200);
  await page.reload();
  const bank = page.getByRole("region", { name: "Задания" }).getByRole("region", { name: "Урок 1.2", exact: true });
  await bank.getByRole("button", { name: "Подтвердить урок", exact: true }).click();
  await expect(bank.getByRole("list", { name: "Подтверждённые задания" }).getByRole("listitem")).toHaveCount(3);
}

/** A student with the textbook chosen on the card and lesson 1.1 passed, so 1.2 comes next; a lesson with them tomorrow. Returns the card's address. */
async function studentWithTextbook(page: Page, firstName: string, textbook: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  const block = page.getByRole("region", { name: "Учебник ученика" });
  await block.getByLabel("Учебник").selectOption({ label: textbook });
  await block.getByLabel("Пройденный урок").selectOption({ label: "Unit 1 · 1.1" });
  await block.getByRole("button", { name: "Сохранить учебник", exact: true }).click();
  await expect(block.getByText("Сохранено")).toBeVisible();

  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
  return card;
}

async function openPreparation(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Подготовка" }).click();
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  return page.getByRole("region", { name: "Домашка к уроку" });
}

/** The draft's page from the student's card: its tasks' prompts are what the checks look for. */
async function openDraft(page: Page, card: string, title: string) {
  await page.goto(card);
  await page.getByRole("link", { name: new RegExp(title.replace(/[.]/g, "\\.")) }).click();
  await expect(page).toHaveURL(/\/homework\/[0-9a-f-]{36}$/);
}

test("checked bank tasks become the lesson's homework draft; building again appends to it", async ({ page, assistant }) => {
  const token = await createToken(page);
  await textbookWithBank(page, assistant, token, "Demo Bank Prep Book");
  const card = await studentWithTextbook(page, "Собираем", "Demo Bank Prep Book");

  // The plan's book lesson is 1.2: its confirmed tasks, as the child sees them, without the keys.
  let homework = await openPreparation(page, "Собираем");
  const tasks = homework.getByRole("list", { name: "Задания урока 1.2" });
  await expect(tasks.getByRole("listitem")).toHaveCount(3);
  await expect(tasks.getByRole("button", { name: "purple", exact: true })).toBeVisible();
  await expect(tasks).not.toContainText("swims");

  await tasks.getByRole("listitem").filter({ hasText: lemon.prompt }).getByRole("checkbox", { name: "В домашку" }).check();
  await tasks.getByRole("listitem").filter({ hasText: frog.prompt }).getByRole("checkbox", { name: "В домашку" }).check();
  await homework.getByRole("button", { name: "Собрать домашку", exact: true }).click();
  // A new draft, attached to the lesson.
  await expect(homework.getByLabel("Черновик домашки").locator("option:checked")).toHaveText("Домашка: урок 1.2");
  await page.reload();
  await expect(homework.getByLabel("Черновик домашки").locator("option:checked")).toHaveText("Домашка: урок 1.2");

  await openDraft(page, card, "Домашка: урок 1.2");
  await expect(page.getByText(lemon.prompt)).toBeVisible();
  await expect(page.getByText(frog.prompt)).toBeVisible();
  await expect(page.getByText(garden.prompt)).toHaveCount(0);

  // Building again appends to the attached draft.
  homework = await openPreparation(page, "Собираем");
  await tasks.getByRole("listitem").filter({ hasText: garden.prompt }).getByRole("checkbox", { name: "В домашку" }).check();
  await homework.getByRole("button", { name: "Собрать домашку", exact: true }).click();
  await expect(homework.getByLabel("Черновик домашки").locator("option:checked")).toHaveText("Домашка: урок 1.2");
  await openDraft(page, card, "Домашка: урок 1.2");
  await expect(page.getByText(garden.prompt)).toBeVisible();
  await expect(page.getByText(lemon.prompt)).toBeVisible();
});
