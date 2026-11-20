// Acceptance for #153: the lesson mode's «Домашка» stage — the student's
// submitted homework reviewed on the stage. The child sees the score and
// their answers, mistakes highlighted, open answers with the teacher's marks;
// a task's right answer stays hidden until the teacher presses «Показать
// ответ» for it on the panel. The stage opens on «Все задания»; «Только
// ошибки» is switched on the panel.
//
// A homework waits for review when it is the student's latest submitted one
// and was submitted after their previous held lesson; it is proposed already
// in the preparation, first in the plan (product owner, 2026-11-19). A
// homework submitted before the previous held lesson proposes no stage: a
// scenario cannot hold a lesson after a submission without waiting for the
// clock, so that case is the implementation's integration test.
//
// The teacher starts signed in (sessions.setup.ts); the student opens the
// link in a fresh browser without the teacher's cookies. The homework is
// synthetic (deploy/seed/homework/demo-review.json).
import { type Browser, expect, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-review.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

const NO_SESSION = { cookies: [], origins: [] };
const DAY = 86_400_000;
const HINT = "В Телемосте покажите окно «Экран для ученика» и включите звук";
const WRITTEN = "I went to the park with my sister.";
const [sky, gap, animals, day] = homework.tasks as [
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
];

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** A new student; returns their link. Leaves the page on the card. */
async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** On the open card: imports the review homework and publishes it. */
async function publishHomework(page: Page) {
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByLabel("Срок").fill(isoDate(new Date(Date.now() + 3 * DAY)));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
}

/**
 * The student submits by the link with one mistake: the sky and the animals
 * right, «are» in the gap, and a few words for the written task.
 */
async function submitWithOneMistake(browser: Browser, link: string) {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect(page.getByText(sky.prompt).or(control(page, "Начать"))).toBeVisible();
  if (await control(page, "Начать").isVisible()) await control(page, "Начать").click();
  await page.getByRole("button", { name: "blue", exact: true }).click();
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByText(gap.prompt)).toBeVisible();
  await page.getByLabel("Пропуск 1").fill("are");
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByText(animals.prompt)).toBeVisible();
  await page.getByRole("button", { name: "cat", exact: true }).click();
  await page.getByRole("button", { name: "dog", exact: true }).click();
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByText(day.prompt)).toBeVisible();
  await page.getByLabel("Ваш ответ").fill(WRITTEN);
  await page.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(page.getByText("Домашка сдана")).toBeVisible();
  await page.context().close();
}

/** In «Проверка домашек» the teacher marks the written task right: one mistake is left, in the gap. */
async function markWrittenRight(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await page.getByRole("link", { name: /Проверка домашек/ }).click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  const rows = page.getByRole("listitem").filter({ hasText: firstName });
  await expect(rows).toHaveCount(1);
  await rows.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(firstName);
  const written = page.getByRole("listitem").filter({ hasText: day.prompt });
  await written.getByRole("button", { name: "Верно", exact: true }).click();
  await expect(page.getByText("3 верно, 1 неверно")).toBeVisible();
}

/** «+ Урок» for tomorrow at 11:00. */
async function addLessonTomorrow(page: Page, firstName: string) {
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("11:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
}

/** Opens the preparation of the student's upcoming lesson; returns the plan's stages. */
async function openPreparation(page: Page, firstName: string) {
  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(firstName);
  return page.getByRole("list", { name: "План урока" }).getByRole("listitem");
}

/** «Запустить урок»: the panel in this tab, the stage in a new window. Returns the stage. */
async function launch(page: Page): Promise<Page> {
  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();
  await expect(page.getByText(HINT)).toBeVisible();
  return stage;
}

/** One task of the homework on the stage, by its prompt. */
function stageTask(stage: Page, prompt: string) {
  return stage.getByRole("region", { name: "Домашка", exact: true }).getByRole("listitem").filter({ hasText: prompt });
}

/** The homework controls on the panel. */
function homeworkControls(page: Page) {
  return page.getByRole("region", { name: "Домашка на сцене" });
}

test("a submitted homework is the first stage; the stage shows the score and the answers without the keys until «Показать ответ»", async ({
  page,
  browser,
}) => {
  const link = await createStudent(page, "Ярослав");
  await publishHomework(page);
  await submitWithOneMistake(browser, link);
  await markWrittenRight(page, "Ярослав");
  await addLessonTomorrow(page, "Ярослав");

  // Proposed already in the preparation, first in the plan.
  const stages = await openPreparation(page, "Ярослав");
  await expect(stages.first()).toContainText("Домашка");
  await expect(stages.first()).toContainText(homework.title);

  const stage = await launch(page);
  const tabs = stage.getByRole("tablist", { name: "Этапы урока" }).getByRole("tab");
  await expect(tabs.first()).toContainText("Домашка");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");

  // The score and every task: «Все задания» first.
  const review = stage.getByRole("region", { name: "Домашка", exact: true });
  await expect(review).toContainText("3 верно, 1 неверно");
  for (const task of [sky, gap, animals, day]) await expect(stageTask(stage, task.prompt)).toBeVisible();
  await expect(stageTask(stage, gap.prompt)).toContainText("are");
  await expect(stageTask(stage, day.prompt)).toContainText(WRITTEN);
  await expect(stageTask(stage, day.prompt)).toContainText("Верно");

  // No key on the stage before the teacher shows it, and nothing of the panel.
  const shown = await stage.locator("body").innerText();
  for (const forbidden of ["Правильный ответ", "Показать ответ", "Только ошибки", "План урока", "Заметка", HINT]) {
    expect(shown).not.toContain(forbidden);
  }

  // «Только ошибки» on the panel leaves only the wrong task on the stage.
  await homeworkControls(page).getByRole("button", { name: "Только ошибки", exact: true }).click();
  await expect(stageTask(stage, sky.prompt)).toHaveCount(0);
  await expect(stageTask(stage, animals.prompt)).toHaveCount(0);
  await expect(stageTask(stage, day.prompt)).toHaveCount(0);
  await expect(stageTask(stage, gap.prompt)).toBeVisible();

  // «Показать ответ» for that task shows its key on the stage.
  await homeworkControls(page).getByRole("listitem").filter({ hasText: gap.prompt }).getByRole("button", { name: "Показать ответ", exact: true }).click();
  await expect(stageTask(stage, gap.prompt)).toContainText("Правильный ответ: is");

  // «Все задания» brings the others back; their keys are still hidden.
  await homeworkControls(page).getByRole("button", { name: "Все задания", exact: true }).click();
  await expect(stageTask(stage, sky.prompt)).toBeVisible();
  await expect(stageTask(stage, animals.prompt)).not.toContainText("Правильный ответ");
});

test("a student without a submitted homework gets no «Домашка» stage", async ({ page }) => {
  await createStudent(page, "Арсений");
  await publishHomework(page);
  await addLessonTomorrow(page, "Арсений");

  // Published but not submitted: nothing to review.
  const stages = await openPreparation(page, "Арсений");
  await expect(page.getByText("Учебник ученика не выбран")).toBeVisible();
  await expect(stages.filter({ hasText: "Домашка" })).toHaveCount(0);
});
