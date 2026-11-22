// Acceptance for #285: a game template that names the word of each answer,
// in version 2 of the game result format, brings a word the student got
// wrong back into the word training: on the card the word is marked «часто
// ошибается»; a word answered right is not; a word not in this student's
// vocabulary is ignored. The game is played on the teacher's page during a
// lesson with the student. The dates of the training, version 1 still
// accepted and the other places a game is played are pinned by integration
// tests.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// student's are Moscow. The game is synthetic HTML written here: given the
// words, it posts one round's result at once.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const game = Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mistake round</title></head>
<body><h1>Mistake round</h1><p id="state">Waiting for words</p>
<script>
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "studysoft.words") return;
  const answers = [
    { task: "teapot?", answer: "кружка", correct: false, word: "teapot", skill: "vocabulary" },
    { task: "pebble?", answer: "камешек", correct: true, word: "pebble", skill: "vocabulary" },
    { task: "ghost?", answer: "нет", correct: false, word: "ghost", skill: "vocabulary" },
  ];
  window.parent.postMessage({ type: "studysoft.game-result", version: 2, answers }, "*");
  document.getElementById("state").textContent = "Round sent";
});
</script>
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

async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
}

async function addWord(page: Page, word: string, translation: string, example = "") {
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await vocabulary.getByRole("button", { name: "Добавить слово", exact: true }).click();
  const form = vocabulary.getByRole("group", { name: "Новое слово" });
  await form.getByLabel("Слово").fill(word);
  await form.getByLabel("Перевод").fill(translation);
  await form.getByLabel("Пример").fill(example);
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(vocabulary.getByRole("listitem").filter({ hasText: word })).toHaveCount(1);
}

/** «+ Урок» for today, five minutes ago in Moscow: a lesson going on now. */
async function addLessonNow(page: Page, firstName: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() - 5 * 60_000));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(`${part("year")}-${part("month")}-${part("day")}`);
  await page.getByLabel("Время", { exact: true }).fill(`${part("hour")}:${part("minute")}`);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
}

test("a word missed in a game template is marked «часто ошибается»; a right one and a word not in the vocabulary are not", async ({ page }) => {
  await setTeacherTimeZone(page, "Москва");
  await createStudent(page, "Играющая");
  const card = page.url();
  await addWord(page, "teapot", "чайник");
  await addWord(page, "pebble", "камешек");
  await addLessonNow(page, "Играющая");

  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: game });
  await page.getByLabel("Название").fill("Mistake round");
  await page.getByRole("checkbox", { name: "Со словами словаря", exact: true }).check();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();

  await page.getByRole("list", { name: "Материалы" }).getByRole("listitem").filter({ hasText: "Mistake round" }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByText(/Итог — в урок с/)).toBeVisible();
  // The lesson with «Играющая» may share the page with other lessons going on: the result goes to hers.
  const choice = page.getByLabel("Итог — в урок с");
  if (await choice.isVisible()) await choice.selectOption({ label: "Играющая" });
  await expect(page.frameLocator('iframe[title="Mistake round"]').getByText("Round sent")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await expect(async () => {
    await page.goto(card);
    const vocabulary = page.getByRole("region", { name: "Словарь" });
    await expect(vocabulary.getByRole("listitem").filter({ hasText: "teapot" })).toContainText("часто ошибается", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await expect(vocabulary.getByRole("listitem").filter({ hasText: "pebble" })).not.toContainText("часто ошибается");
  await expect(vocabulary.getByRole("listitem").filter({ hasText: "ghost" })).toHaveCount(0);
});
