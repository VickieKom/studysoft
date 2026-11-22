// Acceptance for #326: the assistant drafts a library video's tasks from its
// transcript, and the teacher confirms them. A video gets an optional
// «Расшифровка» field, which the teacher fills in when the assistant cannot
// get the transcript itself. The assistant reads the video's link and
// transcript and saves a draft of its tasks in the homework format, checked
// like an import; saved again, it replaces its draft while the teacher has
// not touched it. On the video's page «Задания к видео» shows the draft «от
// ассистента» by task, as the child will see it; the teacher removes a task
// with «Убрать» and presses «Подтвердить». Confirmed tasks are the ones a
// student gets (#327). No agent procedure confirms. A draft that fails the
// format, and another teacher's video, are pinned by integration tests.
//
// The assistant's calls are the HTTP calls the MCP server makes with the
// token, from a request context without the teacher's cookies (as in #3, #43,
// #120). The link, the transcript and the tasks are synthetic, written here.
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
// One token per teacher: creating one revokes the previous one, so these scenarios must not run side by side.
test.describe.configure({ mode: "serial" });

const TITLE = "Robot walk on video";
const LINK = "https://video.example.test/watch?v=robot-walk";
const TRANSCRIPT = "The demo robot wakes up at seven. It walks to the blue box. It does not like rain, so it stays at home.";

const TRUE_FALSE = ["True", "False"];
const task = (prompt: string, answer: 0 | 1) => ({ type: "single_choice", prompt, options: TRUE_FALSE, answer });
const tasks = (title: string, prompts: [string, 0 | 1][]) => ({ version: 1, title, tasks: prompts.map(([prompt, answer]) => task(prompt, answer)) });

const FIRST = tasks("Robot walk, first try", [
  ["The robot wakes up at nine.", 1],
  ["The robot walks to the blue box.", 0],
  ["The robot likes rain.", 1],
]);
const SECOND = tasks("Robot walk", [
  ["The robot wakes up at seven.", 0],
  ["The box is red.", 1],
  ["The robot stays at home in the rain.", 0],
]);

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

/** «Задания к видео» on the video's page. */
function videoTasks(page: Page) {
  return page.getByRole("region", { name: "Задания к видео" });
}

let videoId: string;
let videoPage: string;

test("the teacher saves a video link with its transcript in «Расшифровка»", async ({ page }) => {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Видео" });
  await page.getByLabel("Источник видео").selectOption({ label: "Ссылка" });
  await page.getByLabel("Название").fill(TITLE);
  await page.getByLabel("Тема").fill("video tasks");
  await page.getByLabel("Ссылка на видео").fill(LINK);
  await page.getByLabel("Расшифровка").fill(TRANSCRIPT);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("list", { name: "Материалы" }).getByRole("listitem").filter({ hasText: TITLE }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  videoPage = page.url();
  videoId = videoPage.match(/[0-9a-f-]{36}/)![0];
  // No tasks yet.
  await expect(videoTasks(page)).toContainText("Заданий пока нет");

  // «Изменить» keeps the transcript.
  await control(page, "Изменить").click();
  await expect(page.getByLabel("Расшифровка")).toHaveValue(TRANSCRIPT);
});

test("the assistant reads the link and the transcript and saves a draft; saved again, the draft is replaced", async ({ page, assistant }) => {
  const token = await createToken(page);
  const read = await agentQuery(assistant, token, "agent.libraryVideo", { id: videoId });
  expect(read.status).toBe(200);
  expect(read.body.result!.data).toMatchObject({ id: videoId, title: TITLE, link: LINK, transcript: TRANSCRIPT });

  const first = await agentMutation(assistant, token, "agent.saveVideoTasksDraft", { videoId, tasks: FIRST });
  expect(first.status).toBe(200);
  await page.goto(videoPage);
  await expect(videoTasks(page)).toContainText("от ассистента");
  await expect(videoTasks(page)).toContainText("The robot wakes up at nine.");

  // The teacher has done nothing to it yet: the next save replaces it.
  const second = await agentMutation(assistant, token, "agent.saveVideoTasksDraft", { videoId, tasks: SECOND });
  expect(second.status).toBe(200);
  await page.goto(videoPage);
  const shown = videoTasks(page).getByRole("listitem");
  await expect(shown).toHaveCount(3);
  await expect(videoTasks(page)).not.toContainText("The robot wakes up at nine.");
  await expect(shown.nth(0)).toContainText("The robot wakes up at seven.");
  // As the child will see it: the options, no key.
  await expect(shown.nth(0)).toContainText("True");
  await expect(shown.nth(0)).toContainText("False");
  await expect(videoTasks(page).getByText("Верный ответ")).toHaveCount(0);
});

test("the teacher removes a task and confirms: two confirmed tasks", async ({ page }) => {
  await page.goto(videoPage);
  await videoTasks(page).getByRole("listitem").filter({ hasText: "The box is red." }).getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(videoTasks(page).getByRole("listitem")).toHaveCount(2);
  await videoTasks(page).getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(videoTasks(page)).toContainText("Подтверждено");
  await expect(videoTasks(page)).not.toContainText("от ассистента");

  await page.reload();
  const confirmed = videoTasks(page).getByRole("listitem");
  await expect(confirmed).toHaveCount(2);
  await expect(confirmed.nth(0)).toContainText("The robot wakes up at seven.");
  await expect(confirmed.nth(1)).toContainText("The robot stays at home in the rain.");
});

test("no agent procedure confirms the tasks", async ({ page, assistant }) => {
  const token = await createToken(page);
  const none = await agentMutation(assistant, token, "agent.noSuchProcedure", { videoId });
  expect((await agentMutation(assistant, token, "agent.confirmVideoTasks", { videoId })).status).toBe(none.status);
  // The teacher's procedure with the assistant's token is refused.
  expect((await agentMutation(assistant, token, "teacher.library.confirmVideoTasks", { videoId })).status).toBeGreaterThanOrEqual(400);
});
