// Acceptance for #332: a survey about the lessons, sent with a homework only
// when the teacher ticks «Опрос по урокам» in its draft (off by default).
// Its questions are gathered from the lessons held since the student's
// previous survey, at most two weeks back, the first one over the last week:
// «Что было веселее: A или B?» for pairs of the lessons' materials, with «Оба
// классные» and «Оба так себе»; «Про что хочется ещё?» between topics; and
// «Насколько понятно: <тема>?» with three faces — «могу объяснить», «почти
// понял», «пока путаюсь»; and «А ещё я хочу…», free text, optional. The
// topics are those of the period's lesson materials and homework tasks, at
// most three (product owner, 2026-11-23). In the draft the teacher removes
// any question and adds her own. On the child's page the survey comes
// first, above the homework, until answered or skipped; it counts for
// nothing. «Фидбэк» on the card shows the answers. A homework taken back
// before the survey is answered takes the survey with it. The period is
// pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts); her time zone and the
// student's are Moscow. Two lessons "this week" are added with «+ Урок»,
// 50 and 20 minutes ago, each prepared with one game and then marked
// «Проведён». The games are synthetic HTML written here; the homework is
// synthetic (deploy/seed/homework/demo-short.json, which has no topics).
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import short from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The student, the lessons and the games of one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

const NO_SESSION = { cookies: [], origins: [] };
const BOX = "Опрос по урокам";
const PLANETS = { title: "Planets race", topic: "planets" };
const PETS = { title: "Pets memory", topic: "pets" };
const FUN = `Что было веселее: ${PLANETS.title} или ${PETS.title}?`;
const MORE = "Про что хочется ещё?";
const CLEAR_PLANETS = "Насколько понятно: planets?";
const CLEAR_PETS = "Насколько понятно: pets?";
const WISH = "А ещё я хочу…";
const OWN = "Какую песню включить на следующем уроке?";

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
function draftQuestions(page: Page): Locator {
  return page.getByRole("region", { name: BOX }).getByRole("listitem");
}

function survey(page: Page): Locator {
  return page.getByRole("region", { name: "Опрос про уроки" });
}

function question(scope: Locator, name: string): Locator {
  return scope.getByRole("group", { name, exact: true });
}

let child: { card: string; link: string };

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await uploadGame(page, PLANETS.title, PLANETS.topic);
  await uploadGame(page, PETS.title, PETS.topic);
  await page.context().close();
});

test("ticked in a draft, «Опрос по урокам» gathers its questions from the week's lessons; the teacher removes one and adds her own", async ({
  page,
}) => {
  child = await createStudent(page, "Опрошенный");
  await heldLessonWith(page, "Опрошенный", 50, PLANETS.title);
  await heldLessonWith(page, "Опрошенный", 20, PETS.title);

  await importDraft(page, child.card);
  const box = page.getByRole("checkbox", { name: BOX });
  await expect(box).not.toBeChecked();
  await box.check();
  const questions = draftQuestions(page);
  await expect(questions.filter({ hasText: FUN })).toHaveCount(1);
  await expect(questions.filter({ hasText: MORE })).toContainText("planets");
  await expect(questions.filter({ hasText: MORE })).toContainText("pets");
  await expect(questions.filter({ hasText: CLEAR_PLANETS })).toHaveCount(1);
  await expect(questions.filter({ hasText: CLEAR_PETS })).toHaveCount(1);
  await expect(questions.filter({ hasText: WISH })).toHaveCount(1);

  await questions.filter({ hasText: CLEAR_PETS }).getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(questions.filter({ hasText: CLEAR_PETS })).toHaveCount(0);
  await page.getByRole("region", { name: BOX }).getByLabel("Свой вопрос").fill(OWN);
  await page.getByRole("region", { name: BOX }).getByRole("button", { name: "Добавить вопрос", exact: true }).click();
  await expect(questions.filter({ hasText: OWN })).toHaveCount(1);
  await publish(page);
});

test("the child gets the survey before the homework, answers it, and then gets to the homework; «Фидбэк» shows the answers", async ({
  page,
  browser,
}) => {
  const student = await openFresh(browser, child.link);
  const shown = survey(student);
  await expect(shown).toBeVisible();
  // The survey comes first: the homework is not there yet.
  await expect(student.getByText(short.tasks[0]!.prompt)).toHaveCount(0);
  await expect(control(student, "Начать")).toHaveCount(0);
  await expect(question(shown, CLEAR_PETS)).toHaveCount(0);

  await expect(question(shown, FUN).getByRole("button")).toHaveText([PLANETS.title, PETS.title, "Оба классные", "Оба так себе"]);
  await question(shown, FUN).getByRole("button", { name: PLANETS.title, exact: true }).click();
  await question(shown, MORE).getByRole("button", { name: "planets", exact: true }).click();
  await expect(question(shown, CLEAR_PLANETS).getByRole("button")).toHaveText(["могу объяснить", "почти понял", "пока путаюсь"]);
  await question(shown, CLEAR_PLANETS).getByRole("button", { name: "почти понял", exact: true }).click();
  await question(shown, OWN).getByRole("textbox").fill("Про космос");
  await question(shown, WISH).getByRole("textbox").fill("Больше игр про космос");
  await expect(shown.getByRole("button", { name: "Пропустить", exact: true })).toBeVisible();
  await shown.getByRole("button", { name: "Готово", exact: true }).click();

  // Then the homework.
  await expect(survey(student)).toHaveCount(0);
  await expect(student.getByText(short.tasks[0]!.prompt).or(control(student, "Начать"))).toBeVisible();
  await student.reload();
  await expect(survey(student)).toHaveCount(0);
  await student.context().close();

  await page.goto(child.card);
  const feedback = page.getByRole("region", { name: "Фидбэк" });
  await expect(feedback).toContainText(FUN);
  await expect(feedback).toContainText(PLANETS.title);
  await expect(feedback).toContainText("почти понял");
  await expect(feedback).toContainText("Про космос");
  await expect(feedback).toContainText("Больше игр про космос");
});

test("a homework taken back before the survey is answered takes the survey with it", async ({ page, browser }) => {
  const taken = await createStudent(page, "Неопрошенный");
  await heldLessonWith(page, "Неопрошенный", 40, PLANETS.title);
  await heldLessonWith(page, "Неопрошенный", 10, PETS.title);
  await importDraft(page, taken.card);
  await page.getByRole("checkbox", { name: BOX }).check();
  await expect(draftQuestions(page).filter({ hasText: FUN })).toHaveCount(1);
  await publish(page);

  const before = await openFresh(browser, taken.link);
  await expect(survey(before)).toBeVisible();
  await before.context().close();

  await page.getByRole("button", { name: "Снять с публикации", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toHaveCount(0);

  const after = await openFresh(browser, taken.link);
  await expect(after.getByText(/Неопрошенный/)).toBeVisible();
  await expect(survey(after)).toHaveCount(0);
  await after.context().close();
});

test("with no lessons in the period, the box says so", async ({ page }) => {
  const idle = await createStudent(page, "Без уроков");
  await importDraft(page, idle.card);
  await page.getByRole("checkbox", { name: BOX }).check();
  await expect(page.getByRole("region", { name: BOX })).toContainText("уроков за период нет");
  await expect(draftQuestions(page)).toHaveCount(0);
});
