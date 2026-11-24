// Acceptance for #338: the intro lesson booked from a request. «Записать на
// вводный» on a request takes a date and a time; a free intro lesson
// appears on «Расписание» with the request's name, and the request moves to
// «Вводный записан». The intro is prepared and held like any lesson; a game
// from the library can be a stage of its plan. The child of an intro has no
// card and no link, so the game is played on the lesson stage, the teacher
// clicking for the child, and its result is kept with the request (product
// owner, 2026-11-23). Marked «Проведён», the request moves to «Вводный
// проведён»; cancelled or missed, back to «Заявка». On the request, «Итог
// вводного»: the CEFR level and notes. That the intro charges nothing is
// pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts); her time zone is set to
// Moscow. The game is synthetic HTML written here, in the game result format
// (docs/game-result-format.md). Names and notes are synthetic.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The requests and the game of one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;
const GAME = "Intro quiz";

/** A synthetic game in the format: «Finish» posts one answer right in «numbers» and one wrong in «weather». */
const introQuiz = Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${GAME}</title></head>
<body><h1 id="state">${GAME} is ready</h1>
<button id="finish" type="button">Finish</button>
<script>
document.getElementById("finish").addEventListener("click", function () {
  window.parent.postMessage({
    type: "studysoft.game-result",
    version: 1,
    answers: [
      { task: "How many legs has a cat?", answer: "four", correct: true, topic: "numbers" },
      { task: "What falls from clouds?", answer: "stones", correct: false, topic: "weather" }
    ]
  }, "*");
  document.getElementById("state").textContent = "${GAME} is finished";
});
</script>
</body></html>`);

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A day in Moscow, `days` from today, at noon UTC so that its date is the same everywhere. */
function moscowDate(days: number): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(Date.now() + days * DAY));
  return new Date(`${iso}T12:00:00Z`);
}

/** How the week names a day: «вторник, 17 ноября». */
const dayLabel = (date: Date) => date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Opens «Расписание» on the week that shows this date. */
async function openWeekWith(page: Page, date: Date): Promise<Locator> {
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
  const step = date < moscowDate(0) ? "Предыдущая неделя" : "Следующая неделя";
  const day = page.getByRole("region", { name: dayLabel(date) });
  for (let i = 0; i < 6 && !(await day.isVisible()); i++) {
    const shown = await page.getByRole("region").first().getAttribute("aria-label");
    await page.getByRole("button", { name: step, exact: true }).click();
    await expect(page.getByRole("region").first()).not.toHaveAttribute("aria-label", shown ?? "");
  }
  await expect(day).toBeVisible();
  return day;
}

function lessonOf(day: Locator, firstName: string) {
  return day.getByRole("button", { name: new RegExp(firstName) });
}

async function openSection(page: Page) {
  await page.goto("/teacher/students");
  await control(page, "Привлечение клиентов").click();
  await expect(page.getByRole("heading", { level: 1, name: "Привлечение клиентов" })).toBeVisible();
}

function stage(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

/** A new request from Avito, under «Заявка». */
async function newRequest(page: Page, firstName: string) {
  await openSection(page);
  await control(page, "Новая заявка").click();
  await page.getByLabel("Имя ребёнка").fill(firstName);
  await page.getByLabel("Источник").selectOption({ label: "Авито" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(stage(page, "Заявка").getByRole("listitem").filter({ hasText: firstName })).toHaveCount(1);
}

async function openRequest(page: Page, firstName: string) {
  await openSection(page);
  await page.getByRole("listitem").filter({ hasText: firstName }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
}

/** «Записать на вводный» on the request's page. */
async function bookIntro(page: Page, firstName: string, date: Date, time: string) {
  await openRequest(page, firstName);
  await control(page, "Записать на вводный").click();
  await page.getByLabel("Дата").fill(isoDate(date));
  await page.getByLabel("Время", { exact: true }).fill(time);
  await page.getByRole("button", { name: "Записать", exact: true }).click();
  await expect(page.getByText("Вводный записан")).toBeVisible();
}

async function expectStage(page: Page, firstName: string, name: string) {
  await openSection(page);
  await expect(stage(page, name).getByRole("listitem").filter({ hasText: firstName })).toHaveCount(1);
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: introQuiz });
  await page.getByLabel("Название").fill(GAME);
  await page.getByLabel("Тема").fill("intro game");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
  await page.context().close();
});

test("the teacher books an intro from a request: the week shows it, the request is «Вводный записан»", async ({ page }) => {
  await newRequest(page, "Вводная");
  const tomorrow = moscowDate(1);
  await bookIntro(page, "Вводная", tomorrow, "12:00");

  const day = await openWeekWith(page, tomorrow);
  await expect(lessonOf(day, "Вводная")).toHaveCount(1);
  await expect(lessonOf(day, "Вводная")).toContainText("вводный");
  await expectStage(page, "Вводная", "Вводный записан");
});

test("a game of the intro's plan is played on the stage, and the request shows its result", async ({ page }) => {
  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: "Вводная" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: GAME });
  await control(page, "Добавить этап").click();
  await expect(page.getByRole("list", { name: "План урока" }).getByRole("listitem")).toHaveCount(1);
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();

  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const lessonStage = await opened;
  const frame = lessonStage.frameLocator(`iframe[title="${GAME}"]`);
  await expect(frame.getByText(`${GAME} is ready`)).toBeVisible();
  // The child says the answers, the teacher clicks.
  await frame.getByRole("button", { name: "Finish" }).click();
  await expect(frame.getByText(`${GAME} is finished`)).toBeVisible();

  // The stage stays open while the result is saved, as in the lesson.
  await openRequest(page, "Вводная");
  const result = page.getByRole("region", { name: "Игры на вводном" });
  await expect(async () => {
    await page.reload();
    await expect(result).toContainText(GAME, { timeout: 1_000 });
  }).toPass();
  await lessonStage.close();
  await expect(result).toContainText("What falls from clouds?");
  await expect(result).toContainText("«stones»");
  await expect(result).toContainText("How many legs has a cat?");
});

test("marked «Проведён», the request is «Вводный проведён» with the level and the notes of «Итог вводного»", async ({ page }) => {
  await newRequest(page, "Проведённая");
  const yesterday = moscowDate(-1);
  await bookIntro(page, "Проведённая", yesterday, "10:00");

  const day = await openWeekWith(page, yesterday);
  await lessonOf(day, "Проведённая").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Проведён", { exact: true }).check();
  await dialog.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectStage(page, "Проведённая", "Вводный проведён");

  await openRequest(page, "Проведённая");
  const outcome = page.getByRole("region", { name: "Итог вводного" });
  await outcome.getByLabel("Уровень").selectOption({ label: "A1" });
  await outcome.getByLabel("Заметки").fill("Читает по слогам, хорошо понимает на слух");
  await outcome.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(outcome.getByText("Сохранено")).toBeVisible();

  await openSection(page);
  const held = stage(page, "Вводный проведён").getByRole("listitem").filter({ hasText: "Проведённая" });
  await expect(held).toContainText("A1");
  await openRequest(page, "Проведённая");
  await expect(page.getByRole("region", { name: "Итог вводного" }).getByLabel("Заметки")).toHaveValue("Читает по слогам, хорошо понимает на слух");
});

test("a cancelled intro returns the request to «Заявка»", async ({ page }) => {
  await newRequest(page, "Отменённая");
  const later = moscowDate(3);
  await bookIntro(page, "Отменённая", later, "10:00");
  await expectStage(page, "Отменённая", "Вводный записан");

  const day = await openWeekWith(page, later);
  await lessonOf(day, "Отменённая").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Отменить", exact: true }).click();
  await dialog.getByRole("button", { name: "Отменить урок", exact: true }).click();
  await expect(lessonOf(day, "Отменённая")).toContainText("отменён");
  await expectStage(page, "Отменённая", "Заявка");
});
