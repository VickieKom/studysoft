// Acceptance for #99: the teacher publishes or edits only the version of a
// draft she has seen. When the assistant replaces its draft after her page
// loaded, publishing and saving from that page are refused with a message that
// the draft has changed, and nothing changes; after a reload she sees the new
// version and can publish it.
//
// The assistant's calls are the HTTP calls the MCP server makes with the
// token, from a request context without the teacher's cookies (as in #43).
// Homework is synthetic (deploy/seed/homework/).
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

/** The assistant saves a draft over HTTP, as the MCP server does. */
async function saveDraft(request: APIRequestContext, token: string, studentId: string, homework: unknown) {
  const response = await request.post("/api/trpc/agent.saveHomeworkDraft", {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: JSON.stringify({ studentId, homework }),
  });
  expect(response.status()).toBe(200);
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

const due = () => new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

test("publishing a draft the assistant replaced after the page loaded is refused; after a reload the new version publishes", async ({
  page,
  browser,
  assistant,
}) => {
  const { card, studentId, link } = await createStudent(page, "Устаревшая страница");
  const token = await createToken(page);
  const seen = withTitle(short, "Assistant: the version she saw");
  const replaced = withTitle(allTypes, "Assistant: the version she did not see");

  await saveDraft(assistant, token, studentId, seen);
  await page.goto(card);
  await homeworkOnCard(page).filter({ hasText: seen.title }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: seen.title })).toBeVisible();

  // The assistant replaces its untouched draft while the teacher's page is open.
  await saveDraft(assistant, token, studentId, replaced);

  await page.getByLabel("Срок").fill(due());
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Черновик изменился" })).toBeVisible();
  await expect(page.getByText("Опубликована", { exact: true })).toHaveCount(0);

  // Nothing was published.
  const student = await studentPage(browser, link);
  await expect(student.getByText("Домашних заданий пока нет")).toBeVisible();

  // After a reload the teacher sees the new version and publishes it.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: replaced.title })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: replaced.tasks[0]!.prompt }).first()).toBeVisible();
  await page.getByLabel("Срок").fill(due());
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  await student.reload();
  await expect(student.getByText(/Домашка к/)).toBeVisible();
  await student.context().close();
});

test("saving an edit on a page older than the assistant's replacement is refused and keeps the assistant's version", async ({
  page,
  assistant,
}) => {
  const { card, studentId } = await createStudent(page, "Устаревшая правка");
  const token = await createToken(page);
  const seen = withTitle(short, "Assistant: before the edit");
  const replaced = withTitle(allTypes, "Assistant: replaced before the edit");

  await saveDraft(assistant, token, studentId, seen);
  await page.goto(card);
  await homeworkOnCard(page).filter({ hasText: seen.title }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: seen.title })).toBeVisible();

  await saveDraft(assistant, token, studentId, replaced);

  await page
    .getByRole("listitem")
    .filter({ hasText: short.tasks[0]!.prompt })
    .getByRole("button", { name: "Изменить задание", exact: true })
    .click();
  await page.getByLabel("Текст задания").fill("Edited on a stale page.");
  await page.getByRole("button", { name: "Сохранить задание", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Черновик изменился" })).toBeVisible();

  // The assistant's version is intact, and the teacher's stale edit is not in it.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: replaced.title })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: replaced.tasks[0]!.prompt }).first()).toBeVisible();
  await expect(page.getByText("Edited on a stale page.")).toHaveCount(0);
});

test("editing and then publishing on the same page works: her own saves do not make the page stale", async ({
  page,
  assistant,
}) => {
  const { card, studentId } = await createStudent(page, "Своя правка");
  const token = await createToken(page);
  const draft = withTitle(short, "Assistant: edited, then published");

  await saveDraft(assistant, token, studentId, draft);
  await page.goto(card);
  await homeworkOnCard(page).filter({ hasText: draft.title }).getByRole("link").first().click();

  await page
    .getByRole("listitem")
    .filter({ hasText: short.tasks[0]!.prompt })
    .getByRole("button", { name: "Изменить задание", exact: true })
    .click();
  await page.getByLabel("Текст задания").fill("Edited, then published.");
  await page.getByRole("button", { name: "Сохранить задание", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Edited, then published." })).toBeVisible();

  await page.getByLabel("Срок").fill(due());
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Edited, then published." })).toBeVisible();
});
