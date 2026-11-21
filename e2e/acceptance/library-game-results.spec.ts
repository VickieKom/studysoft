// Acceptance for #119: a game made in the game result format reports the
// student's answers to the platform, and the student's mistakes from games
// and from homework make one list by topic — «Ошибки по темам» on the student
// card, with where each came from, and the mistakes summary of the student
// context the assistant reads. A message not in the format is not kept, and
// the game works on. A result from a game not opened to this student or
// after the access has ended is pinned by integration tests: a scenario
// cannot post one from a page the student cannot open.
//
// The teacher starts signed in (sessions.setup.ts); her time zone and the
// student's are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago, so the games can be opened to the student. The
// games are synthetic HTML written here; the homework is synthetic
// (deploy/seed/homework/demo-auto-checked.json). The assistant's calls are
// the HTTP calls the MCP server makes with the token, as in #44.
import { type APIRequestContext, type Browser, expect, type Page, test as base } from "@playwright/test";
import autoChecked from "../../deploy/seed/homework/demo-auto-checked.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

// A student's browser and the assistant have no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// One token per teacher, and the student made by the first scenario is used by the next one.
test.describe.configure({ mode: "serial" });

/**
 * A synthetic game: «Finish» posts `message` to the platform's window and
 * says so on its own page.
 */
const game = (name: string, message: unknown) =>
  Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${name}</title></head>
<body><h1 id="state">${name} is ready</h1>
<button id="finish" type="button">Finish</button>
<script>
document.getElementById("finish").addEventListener("click", function () {
  window.parent.postMessage(${JSON.stringify(message)}, "*");
  document.getElementById("state").textContent = "${name} is finished";
});
</script>
</body></html>`);

/** In the format: one answer right in «colours», one wrong in «animals». */
const zooQuiz = game("Zoo quiz", {
  type: "studysoft.game-result",
  version: 1,
  answers: [
    { task: "Which one is a colour?", answer: "red", correct: true, topic: "colours", skill: "vocabulary" },
    { task: "Which one is an animal?", answer: "a table", correct: false, topic: "animals", skill: "vocabulary" },
  ],
});

/** Not in the format: an answer without its text and "correct" that is not true or false. */
const brokenQuiz = game("Broken quiz", {
  type: "studysoft.game-result",
  version: 1,
  answers: [{ task: "A task of a broken game", correct: "no", topic: "broken topic" }],
});

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Creates a student in Moscow and returns the card's address, the student's id and their link. */
async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return { card, studentId: card.split("/").pop()!, link: await page.evaluate(() => navigator.clipboard.readText()) };
}

/** Opens a link in a fresh browser without any session, as the student would, and waits for their page. */
async function openAsStudent(browser: Browser, link: string, firstName: string): Promise<Page> {
  const context = await browser.newContext({ storageState: NO_SESSION });
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByText(firstName)).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

/** «+ Урок» for today, five minutes ago in Moscow: a lesson going on now. */
async function addLessonNow(page: Page, firstName: string) {
  const startedAt = new Date(Date.now() - 5 * 60_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(startedAt);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(`${part("year")}-${part("month")}-${part("day")}`);
  await page.getByLabel("Время", { exact: true }).fill(`${part("hour")}:${part("minute")}`);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  // Saved before the scenario moves on: the form has closed and «+ Урок» is back.
  await expect(control(page, "+ Урок")).toBeVisible();
}

/** Uploads a game and opens it to the student from its page in the library. */
async function uploadAndOpenGame(page: Page, title: string, file: Buffer, firstName: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: file });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("game results");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();

  await page
    .getByRole("list", { name: "Материалы" })
    .getByRole("listitem")
    .filter({ hasText: title })
    .getByRole("link", { name: "Открыть" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await control(page, "Открыть ученику").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(page.getByText(new RegExp(`Открыта ученику: ${firstName}`))).toBeVisible();
}

/** The student opens the game under «Игры» in «Материалы урока» (#241) and presses «Finish» inside it. */
async function play(student: Page, title: string) {
  await student.goto("/s");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: /^Материалы урока/ }).click();
  await student.getByRole("region", { name: "Игры" }).getByRole("link", { name: title }).click();
  await expect(student.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const frame = student.frameLocator(`iframe[title="${title}"]`);
  await frame.getByRole("button", { name: "Finish" }).click();
  await expect(frame.getByText(`${title} is finished`)).toBeVisible();
}

async function publishHomework(page: Page, card: string, title: string) {
  await page.goto(card);
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify({ ...autoChecked, title }));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
}

const option = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const next = (page: Page) => page.getByRole("button", { name: "Дальше", exact: true }).click();

/** The student does the homework with every answer right but the gap: one mistake, in «to be». */
async function doHomeworkWrongInToBe(student: Page) {
  await student.goto("/s");
  await expect(student.getByText(autoChecked.tasks[0]!.prompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  await option(student, "blue").click();
  await next(student);
  await option(student, "cat").click();
  await option(student, "dog").click();
  await next(student);
  await student.getByRole("textbox").fill("is");
  await next(student);
  for (const [left, right] of [["hot", "cold"], ["big", "small"]] as const) {
    await option(student, left).click();
    await option(student, right).click();
  }
  await next(student);
  for (const word of ["We", "play", "after", "school"]) await option(student, word).click();
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText("Домашка сдана")).toBeVisible();
}

/** «Ошибки по темам» on the student card. */
function mistakes(page: Page) {
  return page.getByRole("region", { name: "Ошибки по темам" });
}

/** One topic of «Ошибки по темам»: the item that names the topic, with its mistakes under it. */
function topic(page: Page, name: string) {
  return mistakes(page).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

async function studentContext(request: APIRequestContext, token: string, studentId: string) {
  const input = encodeURIComponent(JSON.stringify({ studentId }));
  const response = await request.get(`/api/trpc/agent.studentContext?input=${input}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { mistakesByTopic: body.result.data.mistakesByTopic as { topic: string; count: number }[], text: JSON.stringify(body) };
}

let player: { card: string; studentId: string; link: string };

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("a game in the format and a homework put their mistakes in one list on the student card", async ({
  page,
  browser,
}) => {
  player = await createStudent(page, "Ошибочный");
  await addLessonNow(page, "Ошибочный");
  await uploadAndOpenGame(page, "Zoo quiz", zooQuiz, "Ошибочный");
  await uploadAndOpenGame(page, "Broken quiz", brokenQuiz, "Ошибочный");
  await publishHomework(page, player.card, "Mistakes: homework");

  const student = await openAsStudent(browser, player.link, "Ошибочный");
  // Not in the format: the game plays on, and nothing of it is kept.
  await play(student, "Broken quiz");
  await play(student, "Zoo quiz");
  await doHomeworkWrongInToBe(student);
  await student.context().close();

  await page.goto(player.card);
  // The result reaches the card once the platform has kept it.
  await expect(async () => {
    await page.reload();
    await expect(topic(page, "animals")).toBeVisible({ timeout: 1_000 });
  }).toPass();

  const animals = topic(page, "animals");
  await expect(animals).toContainText("Which one is an animal?");
  await expect(animals).toContainText("«a table»");
  await expect(animals).toContainText("Игра: Zoo quiz");
  await expect(animals).not.toContainText("Домашка");

  const toBe = topic(page, "to be");
  await expect(toBe).toContainText("«is»");
  await expect(toBe).toContainText("Домашка: Mistakes: homework");
  await expect(toBe).not.toContainText("Игра");

  // Right answers are not mistakes, and the broken game left nothing.
  await expect(topic(page, "colours")).toHaveCount(0);
  await expect(mistakes(page)).not.toContainText("broken topic");
  await expect(mistakes(page)).not.toContainText("A task of a broken game");
});

test("the student context for the assistant has the game's and the homework's mistakes by topic", async ({
  page,
  assistant,
}) => {
  const token = await createToken(page);
  const { mistakesByTopic, text } = await studentContext(assistant, token, player.studentId);

  expect(Object.fromEntries(mistakesByTopic.map((m) => [m.topic, m.count]))).toEqual({ animals: 1, "to be": 1 });
  expect(text).toContain("Which one is an animal?");
  for (const hidden of ["broken topic", "A task of a broken game", "/s#"]) expect(text).not.toContain(hidden);
});
