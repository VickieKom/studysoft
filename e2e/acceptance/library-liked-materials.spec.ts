// Acceptance for #334: «нравится N детям» in the library. A game, a warm-up
// or a video a child picked as more fun in a survey's pair (#332), or both
// of a pair with «Оба классные», counts as liked by that child; each child
// counts once per material. The library's list and the material's page show
// «нравится N детям» when N > 0, nothing otherwise. That another teacher's
// children never count, and that a child counts once, are pinned by
// integration tests.
//
// The teacher starts signed in (sessions.setup.ts); her time zone and the
// students' are Moscow. Each child had two lessons held within the hour, one
// game in each, as in #332, and answers the survey sent with a homework. The
// games are synthetic HTML written here; the homework is synthetic
// (deploy/seed/homework/demo-short.json).
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import short from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The games of one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

const NO_SESSION = { cookies: [], origins: [] };
const BOX = "Опрос по урокам";
const ROCKET = { title: "Liked rocket race", topic: "rockets" };
const PUZZLE = { title: "Plain shape puzzle", topic: "shapes" };
const MAZE = { title: "Unpicked colour maze", topic: "colours" };
const FUN = `Что было веселее: ${ROCKET.title} или ${PUZZLE.title}?`;

const game = (title: string) =>
  Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title} is ready</h1></body></html>`);

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** The date and the time in Moscow of a moment `minutes` ago, as the lesson form takes them. */
function moscowAgo(minutes: number): { date: string; time: string; day: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() - minutes * 60_000));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return { date, time: `${part("hour")}:${part("minute")}`, day: new Date(`${date}T12:00:00Z`) };
}

/** How the week names a day: «вторник, 17 ноября». */
const dayLabel = (date: Date) => date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Creates a student in Moscow; returns their card's address and their link. */
async function createStudent(page: Page, firstName: string): Promise<{ card: string; link: string }> {
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
  return { card, link: await page.evaluate(() => navigator.clipboard.readText()) };
}

async function uploadGame(page: Page, title: string, topic: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: game(title) });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill(topic);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

/** A lesson that started `minutes` ago, prepared with one game as its only stage, then marked «Проведён». */
async function heldLessonWith(page: Page, firstName: string, minutes: number, gameTitle: string) {
  const at = moscowAgo(minutes);
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(at.date);
  await page.getByLabel("Время", { exact: true }).fill(at.time);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();

  // The lesson started within the hour, so «Подготовка» still lists it; the newest one is last.
  await page.goto("/teacher/prep");
  await page
    .getByRole("list", { name: "Предстоящие уроки" })
    .getByRole("listitem")
    .filter({ hasText: firstName })
    .last()
    .getByRole("link")
    .first()
    .click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: gameTitle });
  await control(page, "Добавить этап").click();
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();

  await page.goto("/teacher/schedule");
  const day = page.getByRole("region", { name: dayLabel(at.day) });
  if (!(await day.isVisible())) await page.getByRole("button", { name: "Предыдущая неделя", exact: true }).click();
  await day.getByRole("button", { name: new RegExp(`${firstName}.*${at.time}|${at.time}.*${firstName}`) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Проведён", { exact: true }).check();
  await dialog.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** On the card: imports demo-short.json as a draft. */
async function importDraft(page: Page, card: string) {
  await page.goto(card);
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(short));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
}

async function publish(page: Page) {
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
}

async function openFresh(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

/** The survey's questions in the draft. */
function survey(page: Page): Locator {
  return page.getByRole("region", { name: "Опрос про уроки" });
}

function question(scope: Locator, name: string): Locator {
  return scope.getByRole("group", { name, exact: true });
}

/** A child who had a lesson with each game, a survey sent with a homework, and their pick in «Что было веселее». */
async function childPicks(page: Page, browser: Browser, firstName: string, pick: string) {
  const child = await createStudent(page, firstName);
  await heldLessonWith(page, firstName, 50, ROCKET.title);
  await heldLessonWith(page, firstName, 20, PUZZLE.title);
  await importDraft(page, child.card);
  await page.getByRole("checkbox", { name: BOX }).check();
  await expect(page.getByRole("region", { name: BOX }).getByRole("listitem").filter({ hasText: FUN })).toHaveCount(1);
  await publish(page);

  const student = await openFresh(browser, child.link);
  const shown = survey(student);
  await question(shown, FUN).getByRole("button", { name: pick, exact: true }).click();
  await shown.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(survey(student)).toHaveCount(0);
  await student.context().close();
}

function materials(page: Page): Locator {
  return page.getByRole("list", { name: "Материалы" }).getByRole("listitem");
}

async function openInLibrary(page: Page, title: string) {
  await page.goto("/teacher/library");
  await materials(page).filter({ hasText: title }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  for (const g of [ROCKET, PUZZLE, MAZE]) await uploadGame(page, g.title, g.topic);
  await page.context().close();
});

test("two children picked the same game: the library shows «нравится 2 детям» by it, nothing by a game nobody picked", async ({ page, browser }) => {
  await childPicks(page, browser, "Ракетчик", ROCKET.title);
  await childPicks(page, browser, "Космонавт", ROCKET.title);

  await page.goto("/teacher/library");
  await expect(materials(page).filter({ hasText: ROCKET.title })).toContainText("нравится 2 детям");
  await expect(materials(page).filter({ hasText: PUZZLE.title })).not.toContainText("нравится");
  await expect(materials(page).filter({ hasText: MAZE.title })).not.toContainText("нравится");

  await openInLibrary(page, ROCKET.title);
  await expect(page.getByRole("main")).toContainText("нравится 2 детям");
  await openInLibrary(page, MAZE.title);
  await expect(page.getByRole("main")).not.toContainText("нравится");
});

test("«Оба классные» counts both games of the pair", async ({ page, browser }) => {
  await childPicks(page, browser, "Довольный", "Оба классные");

  await page.goto("/teacher/library");
  await expect(materials(page).filter({ hasText: ROCKET.title })).toContainText("нравится 3 детям");
  await expect(materials(page).filter({ hasText: PUZZLE.title })).toContainText("нравится 1 ребёнку");
});
