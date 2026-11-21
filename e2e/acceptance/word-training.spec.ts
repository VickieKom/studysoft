// Acceptance for #238: the daily training in «Тренировка слов». Today's words
// — only those with a translation — come one exercise each, checked on the
// server; after an answer the child sees at once whether it was right and
// the right answer. A new word starts with the easiest exercise, choosing its
// translation out of four. After today's words: «На сегодня всё», and
// «Ещё разок» to go on with random words, which moves no intervals. The
// schedule (1, 2, 4, 8, 16 days; a mistake brings the word back tomorrow;
// the student's time zone) is pinned by unit and integration tests.
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

test("today's words are trained with checking; a mistake shows the right answer; then «На сегодня всё» and «Ещё разок»", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Тренируемый");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Тренируемый" })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  for (const [word, translation] of Object.entries(WORDS)) await addWord(page, word, translation);
  // A word without a translation is in the list, never in a training.
  await addWord(page, "lantern");

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Тренировка слов", exact: true }).click();
  const training = student.getByRole("region", { name: "Тренировка" });
  await expect(training).toContainText("Слов на сегодня: 4");
  await training.getByRole("button", { name: "Начать", exact: true }).click();

  // Each of today's four words once, one of them wrong; never the word without a translation.
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    // A new word starts with choosing its translation.
    await expect(training.getByRole("heading", { level: 2 })).toHaveText(/^Как переводится/);
    seen.push(await answer(training, MISSED));
    await expect(training).not.toContainText("lantern");
    await training.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  expect(seen.sort()).toEqual(Object.keys(WORDS).sort());
  await expect(training).toContainText("На сегодня всё");

  // Nothing is due again today, the missed word included: it comes back tomorrow.
  await student.reload();
  await expect(training).toContainText("На сегодня всё");
  await expect(training.getByRole("button", { name: "Начать", exact: true })).toHaveCount(0);

  // «Ещё разок»: more of the same words; it moves nothing, so today is still done.
  await training.getByRole("button", { name: "Ещё разок", exact: true }).click();
  await answer(training, null);
  await student.reload();
  await expect(training).toContainText("На сегодня всё");
  await student.context().close();
});
