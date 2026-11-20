// Acceptance for #155: the chalkboard on the lesson stage. The stage's right
// column is a school chalkboard on which the teacher writes in the stage
// window itself: printed text in the chalk font (the main tool), chalk by
// hand, a sponge, four chalk colours, «Очистить» with «Вернуть», «Новый лист»
// and ‹ лист N из M ›. The panel has none of it (chalkboard brief,
// 2026-11-19). The sheets are part of the lesson state: a stage closed and
// opened again shows the same sheet. Each lesson starts with a clean board
// of one sheet; that is the implementation's integration test.
//
// The teacher starts signed in (sessions.setup.ts). The words are synthetic.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const DAY = 86_400_000;
const HINT = "В Телемосте покажите окно «Экран для ученика» и включите звук";
const TOOLS = ["Текст", "Мел", "Губка", "Очистить", "Новый лист"];
const WARM_UP = "Board warm-up";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** A warm-up of one question, so the lesson has a stage to show beside the board. */
async function warmUp(page: Page) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Разминка" });
  await page.getByLabel("Формат разминки").selectOption({ label: "Вопросы" });
  await page.getByLabel("Вопросы").fill("What is on the board?");
  await page.getByLabel("Название").fill(WARM_UP);
  await page.getByLabel("Тема").fill("board");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

/** A student with a lesson tomorrow, prepared with the warm-up; leaves the page on its preparation. */
async function lessonTomorrow(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();

  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("13:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();

  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: WARM_UP });
  await control(page, "Добавить этап").click();
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();
}

/** «Запустить урок» or «Открыть сцену»: the stage in a new window. */
async function openStage(page: Page, button: "Запустить урок" | "Открыть сцену"): Promise<Page> {
  const opened = page.context().waitForEvent("page");
  await control(page, button).click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();
  return stage;
}

/** The board on the stage. */
function board(stage: Page) {
  return stage.getByRole("region", { name: "Доска" });
}

/** Prints a word on the board with «Текст»: pick the tool, click the sheet, type, Enter. */
async function print(stage: Page, word: string) {
  await board(stage).getByRole("button", { name: "Текст", exact: true }).click();
  await board(stage).getByRole("application", { name: "Лист доски" }).click({ position: { x: 40, y: 60 } });
  await stage.keyboard.type(word);
  await stage.keyboard.press("Enter");
  await expect(board(stage).getByText(word, { exact: true })).toBeVisible();
}

test("the teacher prints on the stage's chalkboard; the sheet survives a reopened stage, a new sheet keeps the old one, «Очистить» is undone", async ({
  page,
}) => {
  await warmUp(page);
  await lessonTomorrow(page, "Доскин");
  let stage = await openStage(page, "Запустить урок");
  await expect(page.getByText(HINT)).toBeVisible();

  // The board and its tools are on the stage; the panel has none of them.
  for (const tool of TOOLS) await expect(board(stage).getByRole("button", { name: tool, exact: true })).toBeVisible();
  await expect(board(stage).getByRole("button", { name: /мел$/ })).toHaveCount(4);
  await expect(board(stage)).toContainText("лист 1 из 1");
  await expect(page.getByRole("region", { name: "Доска" })).toHaveCount(0);
  for (const tool of TOOLS) await expect(page.getByRole("button", { name: tool, exact: true })).toHaveCount(0);

  // A printed word, in the chalk font.
  await print(stage, "kitten");
  const word = board(stage).getByText("kitten", { exact: true });
  expect(await word.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(/Pangolin/);

  // Closed and opened again from the panel: the same sheet with the word.
  await stage.close();
  stage = await openStage(page, "Открыть сцену");
  await expect(board(stage).getByText("kitten", { exact: true })).toBeVisible();
  await expect(board(stage)).toContainText("лист 1 из 1");

  // A new sheet is empty; ‹ goes back to the first one with the word.
  await board(stage).getByRole("button", { name: "Новый лист", exact: true }).click();
  await expect(board(stage)).toContainText("лист 2 из 2");
  await expect(board(stage).getByText("kitten", { exact: true })).toHaveCount(0);
  await board(stage).getByRole("button", { name: "Предыдущий лист", exact: true }).click();
  await expect(board(stage)).toContainText("лист 1 из 2");
  await expect(board(stage).getByText("kitten", { exact: true })).toBeVisible();

  // «Очистить» empties the sheet without a question; «Вернуть» brings the word back.
  await board(stage).getByRole("button", { name: "Очистить", exact: true }).click();
  await expect(board(stage).getByText("kitten", { exact: true })).toHaveCount(0);
  await board(stage).getByRole("button", { name: "Вернуть", exact: true }).click();
  await expect(board(stage).getByText("kitten", { exact: true })).toBeVisible();
});
