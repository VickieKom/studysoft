// Acceptance for #44: the student's context for the assistant carries the
// recent submitted homework — tasks, answers, right or wrong — and a summary
// of mistakes by topic, so the next homework can repeat what was hard.
//
// The assistant's calls are the HTTP calls the MCP server makes with the
// token, without the teacher's cookies (as in #3). The student does the
// homework on their page in a fresh browser. Homework is synthetic
// (deploy/seed/homework/demo-auto-checked.json).
import { type APIRequestContext, type Browser, expect, type Page, test as base } from "@playwright/test";
import autoChecked from "../../deploy/seed/homework/demo-auto-checked.json" with { type: "json" };
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
// One token per teacher: these scenarios must not run side by side.
test.describe.configure({ mode: "serial" });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

type Task = { prompt: string; type: string; topic: string | null; answer: string | null; correct: boolean | null };
type Context = {
  recentHomework: { title: string; submittedAt: string; tasks: Task[] }[];
  mistakesByTopic: { topic: string; count: number }[];
};

async function studentContext(request: APIRequestContext, token: string, studentId: string) {
  const input = encodeURIComponent(JSON.stringify({ studentId }));
  const response = await request.get(`/api/trpc/agent.studentContext?input=${input}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { context: body.result.data as Context, text: JSON.stringify(body) };
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

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

async function publish(page: Page, card: string, title: string) {
  await page.goto(card);
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify({ ...autoChecked, title }));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
}

/**
 * The student opens the current homework, picks the sky's colour right and
 * only «cat» of the animals, leaves the rest blank and submits anyway.
 */
async function doHomework(student: Page, link: string) {
  await student.goto(link);
  const first = autoChecked.tasks[0]!.prompt;
  await expect(student.getByText(first).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  await student.getByRole("button", { name: "blue", exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await student.getByRole("button", { name: "cat", exact: true }).click();
  const submit = student.getByRole("button", { name: "Сдать", exact: true });
  while (!(await submit.isVisible())) await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await submit.click();
  const result = student.getByText(/\d+\s+верно/);
  const confirm = student.getByRole("button", { name: "Всё равно сдать", exact: true });
  await expect(result.or(confirm)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
  await expect(result).toBeVisible();
}

async function studentBrowser(browser: Browser): Promise<Page> {
  return (await browser.newContext({ storageState: NO_SESSION })).newPage();
}

test("the context has the submitted homework, newest first, with answers and right or wrong, and mistakes by topic", async ({
  page,
  browser,
  assistant,
}) => {
  const { card, studentId, link } = await createStudent(page, "Контекст домашек");
  const student = await studentBrowser(browser);
  await publish(page, card, "Context: first");
  await doHomework(student, link);
  await publish(page, card, "Context: second");
  await doHomework(student, link);
  // Published, not submitted: not part of the context.
  await publish(page, card, "Context: not submitted");
  await student.context().close();

  // Another student's submission never shows.
  const other = await createStudent(page, "Чужой контекст");
  const otherStudent = await studentBrowser(browser);
  await publish(page, other.card, "Context: another student");
  await doHomework(otherStudent, other.link);
  await otherStudent.context().close();

  const token = await createToken(page);
  const { context, text } = await studentContext(assistant, token, studentId);

  expect(context.recentHomework.map((h) => h.title)).toEqual(["Context: second", "Context: first"]);
  for (const homework of context.recentHomework) {
    expect(homework.tasks.map((t) => t.prompt)).toEqual(autoChecked.tasks.map((t) => t.prompt));
    expect(homework.tasks[0]).toMatchObject({ topic: "colours", answer: "blue", correct: true });
    expect(homework.tasks[1]).toMatchObject({ topic: "animals", answer: "cat", correct: false });
    expect(homework.tasks[2]).toMatchObject({ answer: null, correct: false });
  }

  // Every topic but the colours went wrong in both homework.
  const mistakes = Object.fromEntries(context.mistakesByTopic.map((m) => [m.topic, m.count]));
  expect(mistakes).toEqual({ animals: 2, "to be": 2, opposites: 2, "word order": 2 });

  for (const hidden of ["Context: not submitted", "Context: another student", "lastName", "/s#"]) {
    expect(text).not.toContain(hidden);
  }
});
