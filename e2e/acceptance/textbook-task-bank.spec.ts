// Acceptance for #224: the workbook task bank, part A. The assistant saves a
// textbook lesson's tasks through the agent procedures, as the MCP server
// does: tasks in the homework format, each with its source, and the
// exercises that did not become tasks, each with its reason. The teacher sees
// them on the textbook's page under «Задания», lesson by lesson, as the child
// will see them and without the keys; she removes one and confirms the
// lesson. The assistant cannot confirm. Saving the lesson again leaves the
// confirmed tasks where they are and puts a new draft beside them; a task
// from the Student's Book comes into that draft with its source. A draft
// that does not pass the format, a lesson not in the textbook, another
// teacher's textbook and the student's and parent's procedures never
// returning the bank are pinned by integration tests.
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

const workbook = (page: string, exercise: string) => ({ book: "Workbook", unit: "1", page, exercise });

const kennel = {
  type: "single_choice",
  prompt: "Choose the word for a little house for a dog.",
  options: ["kennel", "kettle"],
  answer: 0,
  topic: "home",
  skill: "vocabulary",
  source: workbook("5", "1"),
};
const owl = {
  type: "gap",
  prompt: "Complete the sentence about the owl.",
  text: "The owl ___ at night.",
  answers: [["hoots"]],
  topic: "present simple",
  skill: "grammar",
  source: workbook("5", "2"),
};
const bedroom = {
  type: "written",
  prompt: "Write three lines about your bedroom.",
  topic: "home",
  skill: "writing",
  source: workbook("5", "3"),
};
const rhyme = {
  type: "gap",
  prompt: "Finish the rhyme about the cat.",
  text: "The cat sat on the ___.",
  answers: [["mat"]],
  topic: "rhymes",
  skill: "vocabulary",
  source: { book: "Student's Book", unit: "1", page: "4", exercise: "3" },
};

test("the assistant's tasks are a lesson's draft; the teacher removes one and confirms; a second save lies beside the confirmed tasks", async ({
  page,
  assistant,
}) => {
  const token = await createToken(page);
  const { textbookId, lessonId } = await textbookWithLessons(page, assistant, token, "Demo Bank Book");

  const first = await agentCall(assistant, token, "agent.saveTextbookLessonTasks", {
    textbookId,
    lessonId,
    tasks: [kennel, owl, bedroom],
    skipped: [{ source: workbook("5", "4"), reason: "аудирование без записи" }],
  });
  expect(first.status).toBe(200);
  // The assistant cannot confirm: the same answer as for a procedure that does not exist.
  const none = await agentCall(assistant, token, "agent.noSuchProcedure", { textbookId, lessonId });
  expect((await agentCall(assistant, token, "agent.confirmTextbookLessonTasks", { textbookId, lessonId })).status).toBe(none.status);

  // The draft, as the child will see it, without the keys.
  await page.goto(`/teacher/library/textbooks/${textbookId}`);
  const lesson = page.getByRole("region", { name: "Задания" }).getByRole("region", { name: "Урок 1.2", exact: true });
  const draft = lesson.getByRole("list", { name: "Черновик от ассистента" });
  await expect(draft.getByRole("listitem")).toHaveCount(3);
  await expect(draft).toContainText(kennel.prompt);
  await expect(draft.getByRole("button", { name: "kettle", exact: true })).toBeVisible();
  await expect(draft).toContainText(owl.prompt);
  await expect(draft).not.toContainText("hoots");
  await expect(lesson).toContainText("Не превращены");
  await expect(lesson).toContainText("аудирование без записи");

  // The teacher removes the writing task and confirms the lesson.
  await draft.getByRole("listitem").filter({ hasText: bedroom.prompt }).getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(draft.getByRole("listitem")).toHaveCount(2);
  await lesson.getByRole("button", { name: "Подтвердить урок", exact: true }).click();
  await expect(lesson.getByText("Подтверждён", { exact: true })).toBeVisible();
  const confirmed = lesson.getByRole("list", { name: "Подтверждённые задания" });
  await expect(confirmed.getByRole("listitem")).toHaveCount(2);
  await expect(confirmed).not.toContainText(bedroom.prompt);
  await expect(lesson.getByRole("list", { name: "Черновик от ассистента" })).toHaveCount(0);

  // The assistant saves the lesson again, with a task from the Student's Book: the confirmed tasks stay, the new draft lies beside them.
  const second = await agentCall(assistant, token, "agent.saveTextbookLessonTasks", { textbookId, lessonId, tasks: [rhyme], skipped: [] });
  expect(second.status).toBe(200);
  await page.reload();
  await expect(confirmed.getByRole("listitem")).toHaveCount(2);
  await expect(confirmed).toContainText(kennel.prompt);
  const again = lesson.getByRole("list", { name: "Черновик от ассистента" });
  await expect(again.getByRole("listitem")).toHaveCount(1);
  await expect(again).toContainText(rhyme.prompt);
  await expect(again).toContainText("Student's Book");
  await expect(again).not.toContainText(" mat");

  // Confirming the new draft replaces the lesson's tasks.
  await lesson.getByRole("button", { name: "Подтвердить урок", exact: true }).click();
  await expect(again).toHaveCount(0);
  await expect(confirmed.getByRole("listitem")).toHaveCount(1);
  await expect(confirmed).toContainText(rhyme.prompt);
});
