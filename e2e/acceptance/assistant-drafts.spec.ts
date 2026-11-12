// Acceptance for #43: the assistant reads the homework format, saves a draft
// on the student's card, revises it, and never publishes. The teacher reviews,
// edits and publishes.
//
// The assistant's calls are the HTTP calls the MCP server makes with the
// token, from a request context without the teacher's cookies (as in #3).
// Homework is synthetic (deploy/seed/homework/).
import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test as base } from "@playwright/test";
import allTypes from "../../deploy/seed/homework/demo-all-types.json" with { type: "json" };
import short from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
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
// One token per teacher: creating one revokes the previous one, so these
// scenarios must not run side by side.
test.describe.configure({ mode: "serial" });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

type Call = { status: number; body: { result?: { data: unknown }; error?: { message: string } }; text: string };

/** An agent query over HTTP, as the MCP server calls it. */
async function agentQuery(request: APIRequestContext, token: string, procedure: string, input?: unknown): Promise<Call> {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await request.get(`/api/trpc/${procedure}${query}`, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json();
  return { status: response.status(), body, text: JSON.stringify(body) };
}

/** An agent mutation over HTTP, as the MCP server calls it. */
async function agentMutation(request: APIRequestContext, token: string, procedure: string, input: unknown): Promise<Call> {
  const response = await request.post(`/api/trpc/${procedure}`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: JSON.stringify(input),
  });
  const body = await response.json();
  return { status: response.status(), body, text: JSON.stringify(body) };
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

/** A new student; returns the card address, the id and the student's link. */
async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return { card, studentId: card.split("/").pop()!, link: await page.evaluate(() => navigator.clipboard.readText()) };
}

function homeworkOnCard(page: Page): Locator {
  return page.getByRole("region", { name: "Домашки" }).getByRole("listitem");
}

const withTitle = <T extends { title: string }>(homework: T, title: string): T => ({ ...structuredClone(homework), title });

async function studentPage(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  return page;
}

test("the assistant reads the homework format with its version", async ({ page, assistant }) => {
  const token = await createToken(page);
  const { status, body } = await agentQuery(assistant, token, "agent.homeworkFormat");
  expect(status).toBe(200);
  const format = body.result!.data as { version: number; description: string };
  expect(format.version).toBe(1);
  for (const type of ["single_choice", "multiple_choice", "gap", "match", "order", "written", "voice", "file"]) {
    expect(format.description).toContain(type);
  }
  for (const field of ["topic", "skill", "source"]) expect(format.description).toContain(field);
});

test("a saved draft shows on the card «от ассистента», a second save replaces it, and it reads back", async ({
  page,
  browser,
  assistant,
}) => {
  const { card, studentId, link } = await createStudent(page, "Черновик ассистента");
  const token = await createToken(page);

  const first = withTitle(short, "Assistant: first version");
  expect((await agentMutation(assistant, token, "agent.saveHomeworkDraft", { studentId, homework: first })).status).toBe(200);
  await page.goto(card);
  const rows = homeworkOnCard(page);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(first.title);
  await expect(rows.first()).toContainText("Черновик");
  await expect(rows.first()).toContainText("от ассистента");

  // The student sees nothing of a draft.
  const student = await studentPage(browser, link);
  await expect(student.getByText("Домашних заданий пока нет")).toBeVisible();
  await student.context().close();

  // Saving again replaces the assistant's untouched draft.
  const second = withTitle(allTypes, "Assistant: second version");
  expect((await agentMutation(assistant, token, "agent.saveHomeworkDraft", { studentId, homework: second })).status).toBe(
    200,
  );
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(second.title);

  const read = await agentQuery(assistant, token, "agent.readHomeworkDraft", { studentId });
  expect(read.status).toBe(200);
  expect((read.body.result!.data as { homework: unknown }).homework).toEqual(second);
});

test("once the teacher edits the draft, the next save makes a new one and keeps hers", async ({ page, assistant }) => {
  const { card, studentId } = await createStudent(page, "Правка учителя");
  const token = await createToken(page);
  await agentMutation(assistant, token, "agent.saveHomeworkDraft", {
    studentId,
    homework: withTitle(short, "Assistant draft"),
  });

  await page.goto(card);
  await homeworkOnCard(page).filter({ hasText: "Assistant draft" }).getByRole("link").first().click();
  await page
    .getByRole("listitem")
    .filter({ hasText: short.tasks[0]!.prompt })
    .getByRole("button", { name: "Изменить задание", exact: true })
    .click();
  await page.getByLabel("Текст задания").fill("Edited by the teacher.");
  await page.getByRole("button", { name: "Сохранить задание", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Edited by the teacher." })).toBeVisible();

  await agentMutation(assistant, token, "agent.saveHomeworkDraft", {
    studentId,
    homework: withTitle(short, "Assistant draft, revised"),
  });
  await page.goto(card);
  await expect(homeworkOnCard(page)).toHaveCount(2);
  await expect(homeworkOnCard(page).filter({ hasText: "Assistant draft, revised" })).toContainText("от ассистента");

  // The teacher's version is untouched.
  await homeworkOnCard(page)
    .filter({ hasText: "Assistant draft", hasNotText: "revised" })
    .getByRole("link")
    .first()
    .click();
  await expect(page.getByRole("listitem").filter({ hasText: "Edited by the teacher." })).toBeVisible();
});

test("an invalid homework is refused naming the task and the field, and nothing is saved", async ({ page, assistant }) => {
  const { card, studentId } = await createStudent(page, "Ошибка ассистента");
  const token = await createToken(page);
  const broken = structuredClone(allTypes);
  (broken.tasks[1] as { type: string }).type = "riddle";

  const saved = await agentMutation(assistant, token, "agent.saveHomeworkDraft", { studentId, homework: broken });
  expect(saved.status).toBe(400);
  expect(saved.body.error!.message).toMatch(/Задание 2, поле type/);

  await page.goto(card);
  await expect(homeworkOnCard(page)).toHaveCount(0);
});

test("the assistant cannot publish or delete; the teacher publishes and the student sees it", async ({
  page,
  browser,
  assistant,
}) => {
  const { card, studentId, link } = await createStudent(page, "Публикует учитель");
  const token = await createToken(page);
  const draft = withTitle(short, "Only the teacher publishes");
  await agentMutation(assistant, token, "agent.saveHomeworkDraft", { studentId, homework: draft });
  const id = ((await agentQuery(assistant, token, "agent.readHomeworkDraft", { studentId })).body.result!.data as {
    id: string;
  }).id;
  const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

  // The teacher's procedures with the assistant's token: the same answer for a real draft and a missing one.
  for (const procedure of ["teacher.homework.publish", "teacher.homework.unpublish"]) {
    const real = await agentMutation(assistant, token, procedure, { id, dueDate: due });
    const missing = await agentMutation(assistant, token, procedure, { id: randomUUID(), dueDate: due });
    expect(real.status).toBe(missing.status);
    expect(real.status).toBeGreaterThanOrEqual(400);
  }
  // No agent procedure publishes or deletes: the same answer as a procedure that does not exist.
  const none = await agentMutation(assistant, token, "agent.noSuchProcedure", { id });
  for (const procedure of ["agent.publishHomework", "agent.deleteHomeworkDraft"]) {
    expect((await agentMutation(assistant, token, procedure, { id, dueDate: due })).status).toBe(none.status);
  }

  const student = await studentPage(browser, link);
  await expect(student.getByText("Домашних заданий пока нет")).toBeVisible();

  await page.goto(card);
  await homeworkOnCard(page).filter({ hasText: draft.title }).getByRole("link").first().click();
  await page.getByLabel("Срок").fill(due);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  await student.reload();
  await expect(student.getByText(/Домашка к/)).toBeVisible();
  await student.context().close();
});
