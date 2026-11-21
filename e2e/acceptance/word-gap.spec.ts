// Acceptance for #239: «Вставь слово в предложение» in «Тренировка слов». A
// word with a confirmed example, used in it as it is, comes as its example
// with the word as a gap and four words to choose from: the right word
// passes, a wrong one shows the sentence whole. In «Ещё разок» such a word
// always comes this way; in today's training it comes at the third right
// answer in a row, after choosing its translation and then its word — that,
// and that a word without an example never gets it, are pinned by unit and
// integration tests.
//
// The teacher starts signed in (sessions.setup.ts); the student opens the
// link in a fresh browser without her cookies. The words are synthetic.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

const WORDS: Record<string, string> = { teapot: "чайник", pebble: "камешек", ladder: "лестница", mitten: "варежка" };
const EXAMPLE = "The teapot is hot.";
const GAPPED = "The ___ is hot.";

function control(page: Page, name: string) {
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

/**
 * Answers the exercise on screen rightly: «Как переводится «word»?»,
 * «Какое слово значит «translation»?» or «Вставь слово в предложение» —
 * the gap wrongly when `wrongGap`. Returns whether it was the gap.
 */
async function answer(training: Locator, wrongGap = false): Promise<boolean> {
  const question = training.getByRole("heading", { level: 2 });
  await expect(question).toHaveText(/^(Как переводится «.+»\?|Какое слово значит «.+»\?|Вставь слово в предложение)$/);
  const text = await question.innerText();
  const options = training.getByRole("group", { name: "Варианты" }).getByRole("button");
  await expect(options).toHaveCount(4);
  if (text === "Вставь слово в предложение") {
    // The example with the word as a gap; the word itself is not shown before the answer.
    await expect(training).toContainText(GAPPED);
    await expect(training).not.toContainText(EXAMPLE);
    if (wrongGap) {
      await options.filter({ hasNotText: "teapot" }).first().click();
      await expect(training.getByRole("status")).toHaveText(`Неверно. Правильно: ${EXAMPLE}`);
    } else {
      await options.filter({ hasText: "teapot" }).click();
      await expect(training.getByRole("status")).toHaveText("Верно!");
    }
    return true;
  }
  const shown = text.match(/«(.+)»/)![1]!;
  const right = text.startsWith("Как переводится") ? WORDS[shown]! : Object.keys(WORDS).find((w) => WORDS[w] === shown)!;
  await options.filter({ hasText: right }).click();
  await expect(training.getByRole("status")).toHaveText("Верно!");
  return false;
}

/** Goes through a training to its end; returns how many gaps came. */
async function trainThrough(training: Locator, wrongGap = false): Promise<number> {
  let gaps = 0;
  for (let i = 0; i < Object.keys(WORDS).length; i++) {
    if (await answer(training, wrongGap)) gaps++;
    await training.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  await expect(training).toContainText("На сегодня всё");
  return gaps;
}

test("a word with an example comes as its sentence with a gap; the right word passes, a wrong one shows the sentence whole", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Вставляющий");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Вставляющий" })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  await addWord(page, "teapot", WORDS.teapot!, EXAMPLE);
  for (const word of ["pebble", "ladder", "mitten"]) await addWord(page, word, WORDS[word]!);

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Тренировка слов", exact: true }).click();
  const training = student.getByRole("region", { name: "Тренировка" });
  await expect(training).toContainText("Слов на сегодня: 4");
  await training.getByRole("button", { name: "Начать", exact: true }).click();

  // Today's words are new: each starts with choosing its translation, the word with an example too.
  for (let i = 0; i < 4; i++) {
    await expect(training.getByRole("heading", { level: 2 })).toHaveText(/^Как переводится/);
    await answer(training);
    await training.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  await expect(training).toContainText("На сегодня всё");

  // «Ещё разок»: the word with an example comes as a gap, and only it. A wrong word shows the sentence whole.
  await training.getByRole("button", { name: "Ещё разок", exact: true }).click();
  expect(await trainThrough(training, true)).toBe(1);
  // Again: the right word passes.
  await training.getByRole("button", { name: "Ещё разок", exact: true }).click();
  expect(await trainThrough(training)).toBe(1);
  await student.context().close();
});
