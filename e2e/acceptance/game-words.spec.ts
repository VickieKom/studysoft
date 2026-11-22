// Acceptance for #282: a library game marked «Со словами словаря» gets the
// words of a student when it opens — the word, its confirmed translation and
// its confirmed example, never a word without a translation. In «Библиотека»
// without a lesson the teacher picks whose words; a game she opens to a
// student in a lesson gets that student's words on their page behind the
// link. A game without the mark gets none; the mark is set on upload or
// later. The stage of the lesson mode and the words format the assistant
// reads are pinned by integration and format tests.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// students' are Moscow. The game is synthetic HTML written here: it shows
// the words the platform sends it, as docs/game-words-format.md describes.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The game and the students made by one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

const NO_SESSION = { cookies: [], origins: [] };

const game = (name: string) =>
  Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${name}</title></head>
<body><h1>${name}</h1><p id="state">No words yet</p><ul id="words"></ul>
<script>
window.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "studysoft.words") return;
  const list = document.getElementById("words");
  list.replaceChildren(...event.data.words.map((w) => {
    const item = document.createElement("li");
    item.textContent = w.word + " — " + w.translation + (w.example ? " (" + w.example + ")" : "");
    return item;
  }));
  document.getElementById("state").textContent = "Words: " + event.data.words.length;
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

async function copyStudentLink(page: Page): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

async function openAsStudent(browser: Browser, link: string, firstName: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect(page.getByText(firstName)).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
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

async function uploadGame(page: Page, title: string, withWords: boolean) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: game(title) });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("words");
  if (withWords) await page.getByRole("checkbox", { name: "Со словами словаря", exact: true }).check();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

async function openGame(page: Page, title: string) {
  await page.goto("/teacher/library");
  await page.getByRole("list", { name: "Материалы" }).getByRole("listitem").filter({ hasText: title }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

let wordsLink: string;

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("without a lesson the teacher picks a student, and the marked game shows that student's words with a translation", async ({ page }) => {
  await createStudent(page, "Словесный");
  wordsLink = await copyStudentLink(page);
  await addWord(page, "teapot", "чайник", "The teapot is hot.");
  await addWord(page, "owl", "");
  await createStudent(page, "Другословный");
  await addWord(page, "pebble", "камешек");
  await uploadGame(page, "Word cards", true);

  await openGame(page, "Word cards");
  const frame = page.frameLocator('iframe[title="Word cards"]');
  await expect(frame.getByText("No words yet")).toBeVisible();
  await page.getByLabel("Слова ученика").selectOption({ label: "Словесный" });
  await expect(frame.getByText("teapot — чайник (The teapot is hot.)")).toBeVisible();
  await expect(frame.getByText("Words: 1")).toBeVisible();
  await expect(frame.getByText(/owl/)).toHaveCount(0);

  await page.getByLabel("Слова ученика").selectOption({ label: "Другословный" });
  await expect(frame.getByText("pebble — камешек")).toBeVisible();
  await expect(frame.getByText(/teapot/)).toHaveCount(0);
});

test("opened to a student in a lesson, the game shows that student's words on their page", async ({ page, browser }) => {
  await addLessonNow(page, "Словесный");
  await openGame(page, "Word cards");
  // In a lesson the game's words and its result are the lesson's student's.
  await expect(page.getByText("Итог — в урок с: Словесный")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Word cards"]').getByText("teapot — чайник (The teapot is hot.)")).toBeVisible();
  await control(page, "Открыть ученику").click();
  await page.getByLabel("Ученик").selectOption({ label: "Словесный" });
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(page.getByText(/Открыта ученику: Словесный/)).toBeVisible();

  const student = await openAsStudent(browser, wordsLink, "Словесный");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: /^Материалы урока/ }).click();
  await student.getByRole("region", { name: "Игры" }).getByRole("link", { name: "Word cards" }).click();
  const frame = student.frameLocator('iframe[title="Word cards"]');
  await expect(frame.getByText("teapot — чайник (The teapot is hot.)")).toBeVisible();
  await expect(frame.getByText("Words: 1")).toBeVisible();
  await expect(frame.getByText(/pebble/)).toHaveCount(0);
  await student.context().close();
});

test("a game without the mark gets no words until the teacher marks it", async ({ page }) => {
  await uploadGame(page, "Plain cards", false);
  await openGame(page, "Plain cards");
  const frame = page.frameLocator('iframe[title="Plain cards"]');
  await expect(frame.getByText("No words yet")).toBeVisible();
  await expect(page.getByLabel("Слова ученика")).toHaveCount(0);

  await control(page, "Изменить").click();
  await page.getByRole("checkbox", { name: "Со словами словаря", exact: true }).check();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Plain cards" })).toBeVisible();
  // The lesson with «Словесный» is still going on: the game gets their words.
  await expect(frame.getByText("teapot — чайник (The teapot is hot.)")).toBeVisible();
});
