// Acceptance for #369: a game result posted on the stage is not lost when
// the teacher closes the stage window at once. While its save is still on its
// way, closing the window asks first («Покинуть страницу?» of the browser);
// once saved, the window closes without asking.
//
// The teacher starts signed in (sessions.setup.ts). The game is synthetic
// HTML written here, in the game result format (docs/game-result-format.md).
import { expect, type Page, type Route, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const DAY = 86_400_000;
const GAME = "Unsaved stage quiz";

/** A synthetic game in the format: «Finish» posts one right answer. */
const stageQuiz = Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${GAME}</title></head>
<body><h1 id="state">${GAME} is ready</h1>
<button id="finish" type="button">Finish</button>
<script>
document.getElementById("finish").addEventListener("click", function () {
  window.parent.postMessage({
    type: "studysoft.game-result",
    version: 1,
    answers: [{ task: "How many legs has a dog?", answer: "four", correct: true, topic: "numbers" }]
  }, "*");
  document.getElementById("state").textContent = "${GAME} is finished";
});
</script>
</body></html>`);

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function uploadGame(page: Page) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: stageQuiz });
  await page.getByLabel("Название").fill(GAME);
  await page.getByLabel("Тема").fill("stage game");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

/** A student with a lesson tomorrow, prepared: the game is its only stage. */
async function lessonWithGame(page: Page, firstName: string): Promise<void> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();

  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("12:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();

  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: GAME });
  await control(page, "Добавить этап").click();
  const stages = page.getByRole("list", { name: "План урока" }).getByRole("listitem");
  await expect(stages).toHaveCount(1);
  await expect(stages.first()).toContainText(GAME);
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();
}

test("closing the stage window while a game result is being saved asks first; saved, it closes", async ({ page }) => {
  await uploadGame(page);
  await lessonWithGame(page, "Игрок без потерь");

  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  const frame = stage.frameLocator(`iframe[title="${GAME}"]`);
  await expect(frame.getByText(`${GAME} is ready`)).toBeVisible();

  // The save is held on its way.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await stage.route((url) => url.pathname.includes("saveGameResult"), async (route: Route) => {
    await held;
    await route.continue();
  });
  await frame.getByRole("button", { name: "Finish" }).click();
  await expect(frame.getByText(`${GAME} is finished`)).toBeVisible();

  // Closing now asks; the teacher stays.
  const asked = stage.waitForEvent("dialog");
  await stage.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  expect(stage.isClosed()).toBe(false);

  // Saved, it closes without asking.
  const saved = stage.waitForResponse((response) => response.url().includes("saveGameResult"));
  release();
  await saved;
  stage.on("dialog", () => {
    throw new Error("asked after the result was saved");
  });
  await stage.close({ runBeforeUnload: true });
  await expect.poll(() => stage.isClosed()).toBe(true);
});
