// Acceptance for #147: the teacher runs a game herself during a lesson, on
// her own page of the game in «Библиотека», and the result goes to the
// student of the lesson going on: their «Ошибки по темам» shows the mistake
// as «Игра на уроке: …», and the student context tells the assistant the game
// was played with the teacher. Without a lesson going on nothing is kept;
// that, another teacher's game and a student without a lesson now are pinned
// by integration tests: other scenarios keep lessons going on for this
// teacher while they run, so "no lesson now" cannot be set up here.
//
// The teacher starts signed in (sessions.setup.ts); her time zone and the
// student's are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago. The game is synthetic HTML written here, in the
// game result format (docs/game-result-format.md). The assistant's calls are
// the HTTP calls the MCP server makes with the token, as in #44.
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

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// One token per teacher, and the student made by the first scenario is used by the next one.
test.describe.configure({ mode: "serial" });

/** A synthetic game in the format: «Finish» posts one answer right in «colours» and one wrong in «animals». */
const lessonQuiz = Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lesson quiz</title></head>
<body><h1 id="state">Lesson quiz is ready</h1>
<button id="finish" type="button">Finish</button>
<script>
document.getElementById("finish").addEventListener("click", function () {
  window.parent.postMessage({
    type: "studysoft.game-result",
    version: 1,
    answers: [
      { task: "Which one is a colour?", answer: "green", correct: true, topic: "colours" },
      { task: "Which one can fly?", answer: "a fish", correct: false, topic: "animals" }
    ]
  }, "*");
  document.getElementById("state").textContent = "Lesson quiz is finished";
});
</script>
</body></html>`);

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

async function uploadGame(page: Page, title: string, file: Buffer) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: file });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("lesson game results");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

async function openGame(page: Page, title: string) {
  await page.goto("/teacher/library");
  await page
    .getByRole("list", { name: "Материалы" })
    .getByRole("listitem")
    .filter({ hasText: title })
    .getByRole("link", { name: "Открыть" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/**
 * Makes sure the game's result goes to the student's lesson: with one lesson
 * going on the page names its student; with several (other scenarios add
 * lessons of their own) the teacher picks hers.
 */
async function resultGoesTo(page: Page, firstName: string) {
  const named = page.getByText(`Итог — в урок с: ${firstName}`);
  const choice = page.getByLabel("Итог — в урок с");
  await expect(named.or(choice)).toBeVisible();
  if (await choice.isVisible()) await choice.selectOption({ label: firstName });
}

/** «Ошибки по темам» on the student card, and one topic of it with its mistakes. */
function topic(page: Page, name: string) {
  return page
    .getByRole("region", { name: "Ошибки по темам" })
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) });
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

let player: { card: string; studentId: string };

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("the teacher plays a game in the format on her page during a lesson; the mistake goes to that student", async ({ page }) => {
  const { card, studentId } = await createStudent(page, "Урочный");
  player = { card, studentId };
  await addLessonNow(page, "Урочный");
  await uploadGame(page, "Lesson quiz", lessonQuiz);

  await openGame(page, "Lesson quiz");
  await resultGoesTo(page, "Урочный");
  const frame = page.frameLocator('iframe[title="Lesson quiz"]');
  await frame.getByRole("button", { name: "Finish" }).click();
  await expect(frame.getByText("Lesson quiz is finished")).toBeVisible();

  await page.goto(card);
  // The result reaches the card once the platform has kept it.
  await expect(async () => {
    await page.reload();
    await expect(topic(page, "animals")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const animals = topic(page, "animals");
  await expect(animals).toContainText("Which one can fly?");
  await expect(animals).toContainText("«a fish»");
  await expect(animals).toContainText("Игра на уроке: Lesson quiz");
  await expect(topic(page, "colours")).toHaveCount(0);
});

test("the student context says the game was played with the teacher", async ({ page, assistant }) => {
  const token = await createToken(page);
  const input = encodeURIComponent(JSON.stringify({ studentId: player.studentId }));
  const response = await assistant.get(`/api/trpc/agent.studentContext?input=${input}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const context = (await response.json()).result.data as {
    recentGames: { title: string; playedWithTeacher: boolean }[];
    mistakesByTopic: { topic: string; count: number }[];
  };

  expect(Object.fromEntries(context.mistakesByTopic.map((m) => [m.topic, m.count]))).toEqual({ animals: 1 });
  expect(context.recentGames.map((g) => [g.title, g.playedWithTeacher])).toEqual([["Lesson quiz", true]]);
});
