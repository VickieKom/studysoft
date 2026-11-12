// Acceptance for #3: the teacher connects the assistant with a personal token;
// the assistant finds a student and reads the student's context.
//
// The assistant reaches the platform through the MCP server, which calls the
// platform's agent procedures over HTTP with the token. These scenarios make
// the same HTTP calls the MCP server makes. Every scenario starts signed in
// (sessions.setup.ts); students and notes are synthetic.
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

// The assistant's calls come from the teacher's computer with the token only,
// never with the teacher's browser cookies: "assistant" is a request context
// of its own, without the signed-in session the pages use.
const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION });
// One token per teacher: creating one revokes the previous one, so these
// scenarios must not run side by side.
test.describe.configure({ mode: "serial" });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** An agent procedure over HTTP, as the MCP server calls it. */
async function agentCall(request: APIRequestContext, token: string, procedure: string, input?: unknown) {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await request.get(`/api/trpc/${procedure}${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  return { status: response.status(), body, text: JSON.stringify(body) };
}

/** Creates a token on the "Ассистент" page and returns it. */
async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await expect(page.getByRole("heading", { level: 1, name: "Ассистент" })).toBeVisible();
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

async function createStudent(page: Page, firstName: string, lastName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Фамилия").fill(lastName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url().split("/").pop()!;
}

test("the token is shown once with a configuration snippet; after a reload only its date", async ({ page }) => {
  const token = await createToken(page);
  expect(token.length).toBeGreaterThanOrEqual(32);
  await expect(page.getByLabel("Настройка для ассистента")).toHaveValue(new RegExp(token));

  await page.reload();
  await expect(page.getByText(/[Тт]окен создан/)).toBeVisible();
  await expect(page.getByLabel("Токен ассистента")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(token);
});

test("the assistant lists the teacher's students with first names and statuses only", async ({ page, assistant }) => {
  await createStudent(page, "Список", "Невидимая");
  const token = await createToken(page);

  const { status, body, text } = await agentCall(assistant, token, "agent.listStudents");
  expect(status).toBe(200);
  expect(body.result.data).toContainEqual(expect.objectContaining({ firstName: "Список", status: "discussion" }));
  expect(text).not.toContain("Невидимая");
  expect(text).not.toContain("lastName");
});

test("the assistant reads a student's context with the profile and the latest notes", async ({ page, assistant }) => {
  const studentId = await createStudent(page, "Контекст", "Скрытова");
  await control(page, "Изменить").click();
  const profile: Record<string, string> = {
    Возраст: "13",
    Класс: "7",
    Учебник: "Учебник 2",
    "Текущий юнит": "Unit 4",
    Интересы: "комиксы",
    "Что заходит": "игры на скорость",
    Пробелы: "Past Simple",
  };
  for (const [label, value] of Object.entries(profile)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Уровень").selectOption({ label: "B1" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Контекст" })).toBeVisible();
  for (const text of ["Первая заметка про урок", "Вторая заметка про урок"]) {
    await page.getByLabel("Новая заметка").fill(text);
    await page.getByRole("button", { name: "Добавить заметку" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: text })).toBeVisible();
  }
  const token = await createToken(page);

  const { status, body, text } = await agentCall(assistant, token, "agent.studentContext", { studentId });
  expect(status).toBe(200);
  expect(body.result.data).toMatchObject({
    firstName: "Контекст",
    age: "13",
    schoolYear: "7",
    level: "B1",
    textbook: "Учебник 2",
    currentUnit: "Unit 4",
    interests: "комиксы",
    whatWorks: "игры на скорость",
    gaps: "Past Simple",
  });
  const notes = body.result.data.notes.map((note: { body: string }) => note.body);
  expect(notes).toEqual(expect.arrayContaining(["Первая заметка про урок", "Вторая заметка про урок"]));
  for (const hidden of ["Скрытова", "lastName", "contact", "payment", "/s#"]) expect(text).not.toContain(hidden);
});

test("after «Отозвать» every assistant call is unauthorized", async ({ page, assistant }) => {
  const studentId = await createStudent(page, "Отзыв", "Тестова");
  const token = await createToken(page);
  expect((await agentCall(assistant, token, "agent.listStudents")).status).toBe(200);

  await control(page, "Отозвать").click();
  await expect(page.getByText(/[Тт]окена нет|[Тт]окен отозван/)).toBeVisible();

  expect((await agentCall(assistant, token, "agent.listStudents")).status).toBe(401);
  expect((await agentCall(assistant, token, "agent.studentContext", { studentId })).status).toBe(401);
});

test("the token reaches neither another teacher's student nor the teacher's own procedures", async ({
  page,
  browser,
  assistant,
}) => {
  // A student of the second teacher.
  const other = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const otherPage = await other.newPage();
  const foreignId = await createStudent(otherPage, "Чужой", "Чужев");
  await other.close();

  const token = await createToken(page);
  const foreign = await agentCall(assistant, token, "agent.studentContext", { studentId: foreignId });
  const missing = await agentCall(assistant, token, "agent.studentContext", { studentId: randomUUID() });
  expect(foreign.status).toBe(404);
  expect(foreign.status).toBe(missing.status);
  expect(foreign.body.error.data.code).toBe(missing.body.error.data.code);
  expect(foreign.text).not.toContain("Чужой");

  // The token is not a teacher session.
  expect((await agentCall(assistant, token, "teacher.students.list")).status).toBe(401);
});
