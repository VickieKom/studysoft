// Acceptance for #199: a game of the plan plays on the stage. On its tab the
// stage plays the game in the isolated frame; the panel switches to it like
// any stage. The teacher plays it in the stage window herself — the child
// says the answer, she clicks — and the result the game reports is kept for
// the lesson's student, as when she plays it on her page in #147: it shows in
// «Ошибки по темам» on the card as «Игра на уроке». The stage knows its
// lesson, so the result is kept whatever the clock says (product owner,
// 2026-11-19): the lesson here is tomorrow.
//
// The teacher starts signed in (sessions.setup.ts). The game is synthetic
// HTML written here, in the game result format (docs/game-result-format.md).
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const DAY = 86_400_000;
const GAME = "Stage quiz";
const HINT = "В Телемосте покажите окно «Экран для ученика» и включите звук";

/** A synthetic game in the format: «Finish» posts one answer right in «numbers» and one wrong in «weather». */
const stageQuiz = Buffer.from(`<!doctype html>
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

/** A student with a lesson tomorrow, prepared: the game is its only stage. Returns the card's address. */
async function lessonWithGame(page: Page, firstName: string): Promise<string> {
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
  return card;
}

/** «Ошибки по темам» on the student card, and one topic of it with its mistakes. */
function topic(page: Page, name: string) {
  return page
    .getByRole("region", { name: "Ошибки по темам" })
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) });
}

test("a game of the plan plays on the stage; its result is kept for the lesson's student", async ({ page }) => {
  await uploadGame(page);
  const card = await lessonWithGame(page, "Игрок сцены");

  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(page.getByText(HINT)).toBeVisible();

  // The game's tab is current; the stage plays it in the isolated frame.
  const tabs = stage.getByRole("tablist", { name: "Этапы урока" }).getByRole("tab");
  await expect(tabs).toHaveText([GAME]);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  const frame = stage.frameLocator(`iframe[title="${GAME}"]`);
  await expect(frame.getByText(`${GAME} is ready`)).toBeVisible();
  // Isolated: the frame runs in an origin of its own, without the platform's cookies.
  await expect(stage.locator(`iframe[title="${GAME}"]`)).toHaveAttribute("sandbox", /allow-scripts/);
  await expect(stage.locator(`iframe[title="${GAME}"]`)).not.toHaveAttribute("sandbox", /allow-same-origin/);

  // The teacher plays it in the stage window.
  await frame.getByRole("button", { name: "Finish" }).click();
  await expect(frame.getByText(`${GAME} is finished`)).toBeVisible();

  // Kept for the lesson's student, as a game played with the teacher.
  await page.goto(card);
  await expect(async () => {
    await page.reload();
    await expect(topic(page, "weather")).toBeVisible({ timeout: 1_000 });
  }).toPass();
  const weather = topic(page, "weather");
  await expect(weather).toContainText("What falls from clouds?");
  await expect(weather).toContainText("«stones»");
  await expect(weather).toContainText(`Игра на уроке: ${GAME}`);
  await expect(topic(page, "numbers")).toHaveCount(0);
});
