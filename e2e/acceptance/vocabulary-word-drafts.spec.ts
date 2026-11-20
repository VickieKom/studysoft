// Acceptance for #237: the assistant proposes translations and examples for
// the student's words, as a draft (AGENTS.md, rule 5). Through the agent
// procedures, as the MCP server calls them, it reads the student's words and
// saves a translation and an example for those without. The student sees
// nothing of it; on the card each such word shows «от ассистента», and the
// teacher confirms one word or «Подтвердить все»; then the student sees the
// confirmed ones. A draft for a word with a confirmed translation leaving it
// as it is until confirmed, and another teacher's student, are integration
// tests.
//
// The teacher starts signed in (sessions.setup.ts); the student opens the
// link in a fresh browser without her cookies. The words are synthetic.
import { type APIRequestContext, type Browser, expect, type Page, test as base } from "@playwright/test";
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
// One token per teacher: creating one revokes the previous one.
test.describe.configure({ mode: "serial" });

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

async function addWord(page: Page, word: string) {
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await vocabulary.getByRole("button", { name: "Добавить слово", exact: true }).click();
  const form = vocabulary.getByRole("group", { name: "Новое слово" });
  await form.getByLabel("Слово").fill(word);
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(vocabulary.getByRole("listitem").filter({ hasText: word })).toHaveCount(1);
}

async function studentWords(browser: Browser, link: string) {
  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Тренировка слов", exact: true }).click();
  await expect(student.getByRole("list", { name: "Мои слова" })).toBeVisible();
  return student;
}

test("the assistant's translations are drafts until the teacher confirms them on the card", async ({ page, browser, assistant }) => {
  const token = await createToken(page);
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Переводимый");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Переводимый" })).toBeVisible();
  const card = page.url();
  const studentId = card.split("/").at(-1)!;
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  for (const word of ["lantern", "compass", "hammock"]) await addWord(page, word);

  // The assistant reads the words, then proposes translations and examples.
  const read = await agentCall(assistant, token, "agent.studentWords", { studentId }, true);
  expect(read.status).toBe(200);
  const ids: Record<string, string> = Object.fromEntries(read.body.result.data.map((w: { id: string; word: string }) => [w.word, w.id]));
  const saved = await agentCall(assistant, token, "agent.saveWordDrafts", {
    studentId,
    words: [
      { wordId: ids.lantern, translation: "фонарь", example: "The lantern is bright." },
      { wordId: ids.compass, translation: "компас", example: "Take the compass." },
      { wordId: ids.hammock, translation: "гамак", example: "" },
    ],
  });
  expect(saved.status).toBe(200);
  // The assistant cannot confirm: the same answer as for a procedure that does not exist.
  const none = await agentCall(assistant, token, "agent.noSuchProcedure", { studentId });
  expect((await agentCall(assistant, token, "agent.confirmWordDrafts", { studentId })).status).toBe(none.status);

  // The student sees none of it yet.
  let student = await studentWords(browser, link);
  for (const draft of ["фонарь", "компас", "гамак", "The lantern is bright."]) await expect(student.getByRole("list", { name: "Мои слова" })).not.toContainText(draft);
  await student.context().close();

  // On the card: «от ассистента» by each; the teacher confirms one, then the rest.
  await page.goto(card);
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  const lantern = vocabulary.getByRole("listitem").filter({ hasText: "lantern" });
  await expect(lantern).toContainText("от ассистента");
  await expect(lantern).toContainText("фонарь");
  await expect(lantern).toContainText("The lantern is bright.");
  await lantern.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(lantern).not.toContainText("от ассистента");
  await expect(lantern).toContainText("фонарь");

  student = await studentWords(browser, link);
  const mine = student.getByRole("list", { name: "Мои слова" });
  await expect(mine.getByRole("listitem").filter({ hasText: "lantern" })).toContainText("фонарь");
  await expect(mine.getByRole("listitem").filter({ hasText: "lantern" })).toContainText("The lantern is bright.");
  await expect(mine).not.toContainText("компас");
  await student.context().close();

  await vocabulary.getByRole("button", { name: "Подтвердить все", exact: true }).click();
  await expect(vocabulary).not.toContainText("от ассистента");
  await page.reload();
  await expect(vocabulary).not.toContainText("от ассистента");

  student = await studentWords(browser, link);
  await expect(student.getByRole("list", { name: "Мои слова" }).getByRole("listitem").filter({ hasText: "compass" })).toContainText("компас");
  await expect(student.getByRole("list", { name: "Мои слова" }).getByRole("listitem").filter({ hasText: "hammock" })).toContainText("гамак");
  await student.context().close();
});
