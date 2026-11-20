// Acceptance for #206: the lines the teacher prints on the chalkboard are the
// words of the lesson. In «Завершить урок» every printed line of every sheet
// stands with a checkbox, checked; a line «word — translation» goes to the
// vocabulary as the word and its translation; an unchecked line does not go
// at all. Handwriting is not read.
//
// The teacher starts signed in (sessions.setup.ts). The lines and the
// warm-up are synthetic.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const DAY = 86_400_000;
const WARM_UP = "Chalk lines prompt";
const WORD_LINE = "otter — выдра";
const OTHER_LINE = "Ex. 3 p. 12";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** A student with a lesson tomorrow, its plan a warm-up; then «Запустить урок». Returns the card's address and the stage. */
async function launchedLesson(page: Page, firstName: string): Promise<{ card: string; stage: Page }> {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Разминка" });
  await page.getByLabel("Формат разминки").selectOption({ label: "Вопросы" });
  await page.getByLabel("Вопросы").fill("What did we write today?");
  await page.getByLabel("Название").fill(WARM_UP);
  await page.getByLabel("Тема").fill("chalk lines");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();

  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();

  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("16:00");
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
  return { card, stage };
}

/** Prints a line on the stage's board, at a height of its own. */
async function print(stage: Page, line: string, y: number) {
  const board = stage.getByRole("region", { name: "Доска" });
  await board.getByRole("button", { name: "Текст", exact: true }).click();
  await board.getByRole("application", { name: "Лист доски" }).click({ position: { x: 20, y } });
  await stage.keyboard.type(line);
  await stage.keyboard.press("Enter");
  await expect(board.getByText(line, { exact: true })).toBeVisible();
}

test("the board's printed lines stand in «Завершить урок» with checkboxes; a checked «word — translation» goes to the vocabulary", async ({ page }) => {
  const { card, stage } = await launchedLesson(page, "Мелова");
  await print(stage, WORD_LINE, 40);
  // On a second sheet: every sheet's lines are offered.
  await stage.getByRole("region", { name: "Доска" }).getByRole("button", { name: "Новый лист", exact: true }).click();
  await print(stage, OTHER_LINE, 80);

  await control(page, "Завершить урок").click();
  const form = page.getByRole("dialog", { name: "Завершить урок" });
  const lines = form.getByRole("group", { name: "Строки доски" });
  await expect(lines.getByRole("checkbox", { name: WORD_LINE })).toBeChecked();
  await expect(lines.getByRole("checkbox", { name: OTHER_LINE })).toBeChecked();
  await lines.getByRole("checkbox", { name: OTHER_LINE }).uncheck();
  await form.getByRole("button", { name: "Завершить урок", exact: true }).click();
  await expect(page).toHaveURL(card);

  const vocabulary = page.getByRole("region", { name: "Словарь" });
  const otter = vocabulary.getByRole("listitem").filter({ hasText: "otter" });
  await expect(otter).toHaveCount(1);
  await expect(otter).toContainText("выдра");
  await expect(vocabulary).not.toContainText("Ex. 3");
});
