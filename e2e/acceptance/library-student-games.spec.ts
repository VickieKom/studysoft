// Acceptance for #118: while a lesson with a student is going on, the teacher
// opens a game from «Библиотека» to that student; the student finds it under
// «Игры» behind their permanent link and plays it in the same isolated frame.
// Another student gets the same 404 for it as for a missing game, and a game
// deleted from the library is gone from the student's page at once. The end
// of the access — one hour after the lesson's end — is pinned by an
// integration test: a scenario cannot wait for it.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// students' are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago. The game is synthetic HTML written here.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The game and the students made by one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

// A student's browser has no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const game = (name: string) =>
  Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${name}</title></head>
<body><h1 id="state">Not started</h1>
<script>document.getElementById("state").textContent = "${name} is ready";</script>
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

/** Creates a student in Moscow and returns the address of the card. */
async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url();
}

/** Clicks «Ссылка ученика» on the open card and returns what landed on the clipboard. */
async function copyStudentLink(page: Page): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
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

async function uploadGame(page: Page, title: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: game(title) });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("students' games");
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

/** The «Игры» section of the student's page. */
function studentGames(student: Page) {
  return student.getByRole("region", { name: "Игры" });
}

let playerLink: string;
let gameFile: string;

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("during a lesson the teacher opens a game to the student, who finds it under «Игры» and plays it", async ({
  page,
  browser,
}) => {
  await createStudent(page, "Игрок");
  playerLink = await copyStudentLink(page);
  // A student without a lesson now is not offered.
  await createStudent(page, "Безурочный");
  await addLessonNow(page, "Игрок");
  await uploadGame(page, "Space quiz");

  // Before anything is opened, the student has no games.
  const before = await openAsStudent(browser, playerLink, "Игрок");
  await expect(studentGames(before)).toHaveCount(0);
  await before.context().close();

  await openGame(page, "Space quiz");
  await control(page, "Открыть ученику").click();
  const choice = page.getByLabel("Ученик");
  await expect(choice.getByRole("option", { name: "Игрок" })).toHaveCount(1);
  await expect(choice.getByRole("option", { name: "Безурочный" })).toHaveCount(0);
  await choice.selectOption({ label: "Игрок" });
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(page.getByText(/Открыта ученику: Игрок/)).toBeVisible();

  const student = await openAsStudent(browser, playerLink, "Игрок");
  await studentGames(student).getByRole("link", { name: "Space quiz" }).click();
  await expect(student.getByRole("heading", { level: 1, name: "Space quiz" })).toBeVisible();
  const frame = student.frameLocator('iframe[title="Space quiz"]');
  await expect(frame.getByText("Space quiz is ready")).toBeVisible();
  gameFile = new URL((await student.locator('iframe[title="Space quiz"]').getAttribute("src"))!, student.url()).toString();
  expect((await student.request.get(gameFile)).status()).toBe(200);
  await student.context().close();
});

test("another student gets the same 404 for the opened game's page and file as for a missing game", async ({
  page,
  browser,
}) => {
  await createStudent(page, "Соседний");
  const otherLink = await copyStudentLink(page);
  const other = await openAsStudent(browser, otherLink, "Соседний");
  await expect(studentGames(other)).toHaveCount(0);

  // The opened game's page, as the first student reaches it.
  const player = await openAsStudent(browser, playerLink, "Игрок");
  await studentGames(player).getByRole("link", { name: "Space quiz" }).click();
  await expect(player.getByRole("heading", { level: 1, name: "Space quiz" })).toBeVisible();
  const gamePage = player.url();
  await player.context().close();

  const missing = "00000000-0000-4000-8000-000000000000";
  expect((await other.goto(gamePage))?.status()).toBe(404);
  expect((await other.goto(gamePage.replace(/[0-9a-f-]{36}$/, missing)))?.status()).toBe(404);
  const foreignFile = await other.request.get(gameFile);
  const missingFile = await other.request.get(gameFile.replace(/[0-9a-f-]{36}/, missing));
  expect({ status: foreignFile.status(), body: await foreignFile.text() }).toEqual({
    status: missingFile.status(),
    body: await missingFile.text(),
  });
  expect(foreignFile.status()).toBe(404);
  await other.context().close();
});

test("a game deleted from the library is gone from the student's page at once", async ({ page, browser }) => {
  await openGame(page, "Space quiz");
  await control(page, "Удалить").click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека" })).toBeVisible();

  const student = await openAsStudent(browser, playerLink, "Игрок");
  await expect(studentGames(student)).toHaveCount(0);
  expect((await student.request.get(gameFile)).status()).toBe(404);
  await student.context().close();
});
