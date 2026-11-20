// Acceptance for #240: what sticks, for the teacher. After the student's
// training, each word on the card's «Словарь» is marked «учится» or «часто
// ошибается» (more mistakes than right answers so far), «закрепилось» once
// learnt (#238), nothing before its first training; and a line «Закреплено
// N из M, последняя тренировка — сегодня». The assistant's student context
// listing the words often missed is an integration test.
//
// The teacher starts signed in (sessions.setup.ts); the student opens the
// link in a fresh browser without her cookies. The words are synthetic.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

const WORDS: Record<string, string> = { teapot: "чайник", pebble: "камешек", ladder: "лестница", mitten: "варежка" };
// The child gets this one wrong.
const MISSED = "ladder";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function addWord(page: Page, word: string, translation = "") {
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await vocabulary.getByRole("button", { name: "Добавить слово", exact: true }).click();
  const form = vocabulary.getByRole("group", { name: "Новое слово" });
  await form.getByLabel("Слово").fill(word);
  await form.getByLabel("Перевод").fill(translation);
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(vocabulary.getByRole("listitem").filter({ hasText: word })).toHaveCount(1);
}

/**
 * Answers the exercise on screen — «Как переводится «word»?» (choose the
 * translation) or «Какое слово значит «translation»?» (choose the word) —
 * rightly, unless the word is `wrongFor`. Returns the word.
 */
async function answer(training: Locator, wrongFor: string | null): Promise<string> {
  const question = training.getByRole("heading", { level: 2 });
  await expect(question).toHaveText(/^(Как переводится|Какое слово значит) «.+»\?$/);
  const text = await question.innerText();
  const shown = text.match(/«(.+)»/)![1]!;
  const byWord = text.startsWith("Как переводится");
  const word = byWord ? shown : Object.keys(WORDS).find((w) => WORDS[w] === shown)!;
  expect(Object.keys(WORDS)).toContain(word);
  const right = byWord ? WORDS[word]! : word;
  const options = training.getByRole("group", { name: "Варианты" }).getByRole("button");
  await expect(options).toHaveCount(4);
  if (word === wrongFor) {
    await options.filter({ hasNotText: right }).first().click();
    await expect(training.getByRole("status")).toHaveText(`Неверно. Правильно: ${right}`);
  } else {
    await options.filter({ hasText: right }).click();
    await expect(training.getByRole("status")).toHaveText("Верно!");
  }
  return word;
}

test("after a training with a mistake the card marks the words and counts what is learnt", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Закрепляющий");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Закрепляющий" })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  for (const [word, translation] of Object.entries(WORDS)) await addWord(page, word, translation);

  // Before any training: no marks, nothing learnt.
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await expect(vocabulary).toContainText("Закреплено 0 из 4, тренировок ещё не было");
  for (const mark of ["учится", "часто ошибается", "закрепилось"]) await expect(vocabulary).not.toContainText(mark);

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Тренировка слов", exact: true }).click();
  const training = student.getByRole("region", { name: "Тренировка" });
  await training.getByRole("button", { name: "Начать", exact: true }).click();
  for (let i = 0; i < 4; i++) {
    await answer(training, MISSED);
    await training.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  await expect(training).toContainText("На сегодня всё");
  await student.context().close();

  await page.goto(card);
  await expect(vocabulary.getByRole("listitem").filter({ hasText: MISSED })).toContainText("часто ошибается");
  for (const word of Object.keys(WORDS).filter((w) => w !== MISSED)) {
    await expect(vocabulary.getByRole("listitem").filter({ hasText: word })).toContainText("учится");
  }
  await expect(vocabulary).toContainText("Закреплено 0 из 4, последняя тренировка — сегодня");
});
