// Acceptance for #225: the workbook task bank, part B. A confirmed lesson's
// task opens in «Задания» on the textbook's page in the same task editor as a
// homework draft's task, and saves back into the bank: the bank then shows
// the new prompt, after a reload too. A homework already built from the bank
// keeping its old copy is pinned by an integration test with the building
// (#226).
//
// The teacher starts signed in (sessions.setup.ts). The PDF (six pages that
// say their number) and the task are synthetic, made here.
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

test.use({ storageState: TEACHER_SESSION });
// One token per teacher: creating one revokes the previous one.
test.describe.configure({ mode: "serial" });

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

/** A textbook of six pages with a confirmed unit of lessons 1.1–1.3; returns its id and the id of lesson 1.2. */
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
  const saved = await agentCall(assistant, token, "agent.textbookStructure", { textbookId }, true);
  const lessonId: string = saved.body.result.data.structure.units[0].lessons[1].id;
  return { textbookId, lessonId };
}

const owl = {
  type: "gap",
  prompt: "Complete the sentense about the owl.",
  text: "The owl ___ at night.",
  answers: [["hoots"]],
  topic: "present simple",
  skill: "grammar",
  source: { book: "Workbook", unit: "1", page: "5", exercise: "2" },
};

test("a confirmed task is fixed once in the bank with the homework task editor", async ({ page, assistant }) => {
  const token = await createToken(page);
  const { textbookId, lessonId } = await textbookWithLessons(page, assistant, token, "Demo Fixed Bank");
  expect((await agentCall(assistant, token, "agent.saveTextbookLessonTasks", { textbookId, lessonId, tasks: [owl], skipped: [] })).status).toBe(200);

  await page.goto(`/teacher/library/textbooks/${textbookId}`);
  const lesson = page.getByRole("region", { name: "Задания" }).getByRole("region", { name: "Урок 1.2", exact: true });
  await lesson.getByRole("button", { name: "Подтвердить урок", exact: true }).click();
  const confirmed = lesson.getByRole("list", { name: "Подтверждённые задания" });
  await expect(confirmed.getByRole("listitem")).toHaveCount(1);

  // The same editor as a homework draft's task: the prompt and the key.
  await confirmed.getByRole("listitem").filter({ hasText: owl.prompt }).getByRole("button", { name: "Изменить задание", exact: true }).click();
  await expect(page.getByLabel("Ответы для пропуска 1")).toHaveValue("hoots");
  await page.getByLabel("Текст задания").fill("Complete the sentence about the owl.");
  await page.getByRole("button", { name: "Сохранить задание", exact: true }).click();

  await expect(confirmed).toContainText("Complete the sentence about the owl.");
  await expect(confirmed).not.toContainText("sentense");
  await page.reload();
  await expect(confirmed).toContainText("Complete the sentence about the owl.");
  await expect(confirmed.getByRole("listitem")).toHaveCount(1);
});
