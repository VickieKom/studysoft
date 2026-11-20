// Acceptance for #205: «Доска крупно» on the panel spreads the chalkboard
// over the whole stage and back. On, the board takes the stage's width and
// the lesson's material is not visible; off, the board is back in its column
// beside it. The board's content and its sheet do not change either way; the
// choice is part of the lesson state, so the stage follows the panel.
//
// The teacher starts signed in (sessions.setup.ts). The word and the
// warm-up are synthetic.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const DAY = 86_400_000;
const QUESTION = "Which word is on the slate?";
const WARM_UP = "Big slate prompt";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** A student with a lesson tomorrow, its plan a warm-up of one question; then «Запустить урок». Returns the stage. */
async function launchedLesson(page: Page, firstName: string): Promise<Page> {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Разминка" });
  await page.getByLabel("Формат разминки").selectOption({ label: "Вопросы" });
  await page.getByLabel("Вопросы").fill(QUESTION);
  await page.getByLabel("Название").fill(WARM_UP);
  await page.getByLabel("Тема").fill("slate");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();

  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();

  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("14:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();

  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: WARM_UP });
  await control(page, "Добавить этап").click();
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();

  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();
  return stage;
}

function board(stage: Page) {
  return stage.getByRole("region", { name: "Доска" });
}

/** The board's width as a share of the stage window's. */
async function boardShare(stage: Page): Promise<number> {
  const box = await board(stage).boundingBox();
  return box!.width / stage.viewportSize()!.width;
}

test("«Доска крупно» spreads the board over the stage and back; its sheet and word stay", async ({ page }) => {
  const stage = await launchedLesson(page, "Крупнов");
  await board(stage).getByRole("button", { name: "Текст", exact: true }).click();
  await board(stage).getByRole("application", { name: "Лист доски" }).click({ position: { x: 40, y: 60 } });
  await stage.keyboard.type("lantern");
  await stage.keyboard.press("Enter");
  await expect(board(stage).getByText("lantern", { exact: true })).toBeVisible();

  // In its column the board is narrow, beside the warm-up.
  await expect(stage.getByText(QUESTION)).toBeVisible();
  expect(await boardShare(stage)).toBeLessThan(0.5);

  // On: the whole stage, the warm-up out of sight, the word on the same sheet.
  await control(page, "Доска крупно").click();
  await expect.poll(() => boardShare(stage)).toBeGreaterThan(0.85);
  await expect(stage.getByText(QUESTION)).toBeHidden();
  await expect(board(stage).getByText("lantern", { exact: true })).toBeVisible();
  await expect(board(stage)).toContainText("лист 1 из 1");

  // Off: back in its column beside the warm-up.
  await control(page, "Доска крупно").click();
  await expect.poll(() => boardShare(stage)).toBeLessThan(0.5);
  await expect(stage.getByText(QUESTION)).toBeVisible();
  await expect(board(stage).getByText("lantern", { exact: true })).toBeVisible();
});
