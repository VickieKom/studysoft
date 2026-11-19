// Acceptance for #120: the assistant saves games and warm-ups to «Библиотека»
// as drafts. A draft shows above the library under «От ассистента», never in
// the list of materials or its filters, until the teacher clicks «Добавить в
// библиотеку»; she can edit or delete it first. Saved again with its id, the
// assistant's draft is replaced while it is still an untouched draft; once
// the material is in the library the assistant gets a new draft instead.
// Adding to the library and deleting are the teacher's only.
//
// The assistant's calls are the HTTP calls the MCP server makes with the
// token, from a request context without the teacher's cookies (as in #3, #43).
// The game is synthetic HTML written here.
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

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
// One token per teacher: creating one revokes the previous one, so these scenarios must not run side by side.
test.describe.configure({ mode: "serial" });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

type Call = { status: number; body: { result?: { data: { id: string } }; error?: { message: string } } };

/** An agent mutation over HTTP, as the MCP server calls it. */
async function agentMutation(request: APIRequestContext, token: string, procedure: string, input: unknown): Promise<Call> {
  const response = await request.post(`/api/trpc/${procedure}`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: JSON.stringify(input),
  });
  return { status: response.status(), body: await response.json() };
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

const game = (title: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><h1 id="state">${title} is ready</h1></body></html>`;

const tags = (title: string) => ({ title, level: "A2", topic: "assistant drafts", ageGroup: "younger" });

/** Saves a game draft as the assistant; with `id`, asks to replace that draft. Returns the draft's id. */
async function saveGame(assistant: APIRequestContext, token: string, title: string, id?: string): Promise<string> {
  const saved = await agentMutation(assistant, token, "agent.saveGameDraft", { ...tags(title), html: game(title), ...(id ? { id } : {}) });
  expect(saved.status).toBe(200);
  return saved.body.result!.data.id;
}

/** «От ассистента» above the library. */
function drafts(page: Page) {
  return page.getByRole("region", { name: "От ассистента" });
}

function materials(page: Page) {
  return page.getByRole("list", { name: "Материалы" });
}

test("a game the assistant saves is a draft until the teacher adds it to the library", async ({ page, assistant }) => {
  const token = await createToken(page);
  const id = await saveGame(assistant, token, "Draft pond quiz");

  await page.goto("/teacher/library");
  await expect(drafts(page).getByRole("listitem").filter({ hasText: "Draft pond quiz" })).toHaveCount(1);
  await expect(materials(page).getByText("Draft pond quiz")).toHaveCount(0);
  // Not under the type filter either.
  await page.goto("/teacher/library?type=game");
  await expect(materials(page).getByText("Draft pond quiz")).toHaveCount(0);

  // Saved again with its id: the same draft, revised.
  expect(await saveGame(assistant, token, "Draft pond quiz, revised", id)).toBe(id);
  await page.goto("/teacher/library");
  await expect(drafts(page).getByRole("listitem")).toHaveCount(1);
  await expect(drafts(page)).toContainText("Draft pond quiz, revised");

  await drafts(page).getByRole("listitem").filter({ hasText: "Draft pond quiz, revised" }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft pond quiz, revised" })).toBeVisible();
  await expect(page.getByText("Черновик от ассистента")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Draft pond quiz, revised"]').getByText("Draft pond quiz, revised is ready")).toBeVisible();

  // The teacher renames it before adding it.
  await control(page, "Изменить").click();
  await page.getByLabel("Название").fill("Pond quiz from the assistant");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pond quiz from the assistant" })).toBeVisible();
  await control(page, "Добавить в библиотеку").click();
  await expect(page.getByText("Черновик от ассистента")).toHaveCount(0);

  await page.goto("/teacher/library?type=game");
  await expect(materials(page).getByText("Pond quiz from the assistant")).toHaveCount(1);
  await expect(drafts(page)).toHaveCount(0);

  // The game is in the library now: saved again with its id, the assistant gets a new draft and the game stays.
  const next = await saveGame(assistant, token, "Pond quiz, another try", id);
  expect(next).not.toBe(id);
  await page.goto("/teacher/library");
  await expect(drafts(page)).toContainText("Pond quiz, another try");
  await expect(materials(page).getByText("Pond quiz from the assistant")).toHaveCount(1);
});

test("a warm-up the assistant saves is a draft the teacher can delete", async ({ page, assistant }) => {
  const token = await createToken(page);
  const saved = await agentMutation(assistant, token, "agent.saveWarmupDraft", {
    ...tags("Draft talk"),
    format: "questions",
    questions: ["What did you do at the weekend?", "What makes you laugh?"],
  });
  expect(saved.status).toBe(200);

  await page.goto("/teacher/library");
  await drafts(page).getByRole("listitem").filter({ hasText: "Draft talk" }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("list", { name: "Вопросы" }).getByRole("listitem")).toHaveCount(2);
  await control(page, "Удалить").click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
  await expect(drafts(page).getByText("Draft talk")).toHaveCount(0);
  await expect(materials(page).getByText("Draft talk")).toHaveCount(0);
});

test("the assistant can neither add a draft to the library nor delete, and another teacher's token cannot touch it", async ({
  page,
  browser,
  assistant,
}) => {
  const token = await createToken(page);
  const id = await saveGame(assistant, token, "Stays a draft");

  // No agent procedure adds or deletes: the same answer as a procedure that does not exist.
  const none = await agentMutation(assistant, token, "agent.noSuchProcedure", { id });
  for (const procedure of ["agent.addToLibrary", "agent.deleteLibraryDraft"]) {
    expect((await agentMutation(assistant, token, procedure, { id })).status).toBe(none.status);
  }
  // The teacher's procedures with the assistant's token: the same answer for the real draft and a missing one.
  for (const procedure of ["teacher.library.addToLibrary", "teacher.library.remove"]) {
    const real = await agentMutation(assistant, token, procedure, { id });
    const missing = await agentMutation(assistant, token, procedure, { id: randomUUID() });
    expect(real.status).toBe(missing.status);
    expect(real.status).toBeGreaterThanOrEqual(400);
  }

  // Another teacher's assistant asks to replace this draft: it gets a draft of its own, and this one stays.
  const other = await (await browser.newContext({ storageState: SECOND_TEACHER_SESSION })).newPage();
  const otherToken = await createToken(other);
  const theirs = await saveGame(assistant, otherToken, "Not yours", id);
  expect(theirs).not.toBe(id);
  await other.goto("/teacher/library");
  await expect(drafts(other)).toContainText("Not yours");
  await expect(drafts(other).getByText("Stays a draft")).toHaveCount(0);
  await other.context().close();

  await page.goto("/teacher/library");
  await expect(drafts(page)).toContainText("Stays a draft");
  await expect(drafts(page).getByText("Not yours")).toHaveCount(0);
});
