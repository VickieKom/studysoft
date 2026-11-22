// Acceptance for #283: «Вставить в пример» and «Написать слово» in «Из
// словаря». A word used in its confirmed example as it is comes as that
// sentence with a gap; the others are skipped and the teacher is told how
// many. «Написать слово» shows the translation and takes the English word.
// The automatic check takes the word in any letter case and without extra
// spaces.
//
// The teacher starts signed in (sessions.setup.ts); the student opens the
// link in a fresh browser without her cookies. The words and the homework
// are synthetic (deploy/seed/homework/demo-short.json).
import { expect, type Locator, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

// teapot and mitten are used in their examples as they are; pebble is not (plural), ladder has none.
const WORDS: [string, string, string][] = [
  ["teapot", "чайник", "The teapot is hot."],
  ["pebble", "камешек", "Pebbles are round."],
  ["ladder", "лестница", ""],
  ["mitten", "варежка", "My mitten is red."],
];
const GAPS: Record<string, string> = { "The ___ is hot.": "teapot", "My ___ is red.": "mitten" };

function control(page: Page | Locator, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
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

/** A new student with `words` in the vocabulary and an imported homework draft open; returns the student's link. */
async function draftWithWords(page: Page, firstName: string, words: [string, string, string][]): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  for (const [word, translation, example] of words) await addWord(page, word, translation, example);

  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();
  return link;
}

test("words become sentences with a gap and «Напиши по-английски» tasks; the check takes the word in any case", async ({ page, browser }) => {
  const link = await draftWithWords(page, "Пропускающий", WORDS);

  await control(page, "Из словаря").click();
  const picker = page.getByRole("group", { name: "Из словаря" });
  for (const [word, translation] of WORDS) await picker.getByRole("checkbox", { name: `${word} — ${translation}` }).check();
  await picker.getByRole("checkbox", { name: "Вставить в пример", exact: true }).check();
  // Two of the four have no example that uses the word as it is.
  await expect(picker).toContainText("Без примера со словом: 2 из 4");
  await picker.getByRole("checkbox", { name: "Написать слово", exact: true }).check();
  await picker.getByRole("button", { name: "Добавить", exact: true }).click();

  const tasks = page.getByRole("listitem");
  for (const sentence of Object.keys(GAPS)) await expect(tasks.filter({ hasText: sentence })).toHaveCount(1);
  await expect(tasks.filter({ hasText: "Pebbles are round." })).toHaveCount(0);
  for (const [, translation] of WORDS) await expect(tasks.filter({ hasText: `Напиши по-английски: «${translation}»` })).toHaveCount(1);

  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  // The two imported tasks, two gaps and four words to write.
  const total = homework.tasks.length + Object.keys(GAPS).length + WORDS.length;
  await expect(student.getByText(new RegExp(`1\\s*/\\s*${total}`)).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  for (let number = 1; number <= total; number++) {
    await expect(student.getByText(new RegExp(`${number}\\s*/\\s*${total}`))).toBeVisible();
    if (await student.getByText("Вставь слово в предложение", { exact: true }).isVisible()) {
      // The sentence's words around the gap tell which word it is.
      const shown = await student.getByRole("main").innerText();
      const word = shown.includes("is hot") ? GAPS["The ___ is hot."]! : GAPS["My ___ is red."]!;
      await student.getByRole("textbox").fill(`  ${word.toUpperCase()} `);
    }
    const asked = student.getByText(/^Напиши по-английски: «(.+)»$/);
    if (await asked.isVisible()) {
      const translation = (await asked.innerText()).match(/«(.+)»/)![1]!;
      await student.getByRole("textbox").fill(WORDS.find(([, t]) => t === translation)![0]);
    }
    if (number < total) await student.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  // The two imported tasks are left unanswered on purpose: she submits anyway.
  await student.getByRole("button", { name: "Всё равно сдать", exact: true }).click();
  await expect(student.getByText("Готово! Домашка сдана, учитель посмотрит")).toBeVisible();
  await student.context().close();

  // Both gaps and the four written words are right: the teacher's to see (#227).
  await page.goto("/teacher/homework-review");
  await page.getByLabel("Ученик").selectOption({ label: "Пропускающий" });
  await expect(page.getByRole("listitem").filter({ hasText: "Пропускающий" })).toContainText("6 верно");
});
