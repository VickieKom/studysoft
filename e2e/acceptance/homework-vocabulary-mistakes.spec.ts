// Acceptance for #284: a word the student gets wrong in a homework task
// built «Из словаря» comes back in the word training and is marked «часто
// ошибается» on the card; a word answered right is not marked. That the
// word is due tomorrow in the student's time zone, that a right answer
// moves nothing, and what an edit of the task keeps are pinned by
// integration tests.
//
// The teacher starts signed in (sessions.setup.ts); the student opens the
// link in a fresh browser without her cookies. The words and the homework
// are synthetic (deploy/seed/homework/demo-short.json).
import { expect, type Locator, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

const WORDS: Record<string, string> = { teapot: "чайник", pebble: "камешек", ladder: "лестница", mitten: "варежка" };
const MISSED = "teapot";

function control(page: Page | Locator, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function addWord(page: Page, word: string, translation: string) {
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await vocabulary.getByRole("button", { name: "Добавить слово", exact: true }).click();
  const form = vocabulary.getByRole("group", { name: "Новое слово" });
  await form.getByLabel("Слово").fill(word);
  await form.getByLabel("Перевод").fill(translation);
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(vocabulary.getByRole("listitem").filter({ hasText: word })).toHaveCount(1);
}

test("a word missed in homework from the vocabulary is marked «часто ошибается»; a word answered right is not", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Ошибающийся");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ошибающийся" })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  for (const [word, translation] of Object.entries(WORDS)) await addWord(page, word, translation);

  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();
  await control(page, "Из словаря").click();
  const picker = page.getByRole("group", { name: "Из словаря" });
  for (const word of [MISSED, "pebble"]) await picker.getByRole("checkbox", { name: `${word} — ${WORDS[word]}` }).check();
  await picker.getByRole("checkbox", { name: "Выбрать перевод", exact: true }).check();
  await picker.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: `Как переводится «${MISSED}»?` })).toHaveCount(1);
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  // The student misses «teapot» and gets «pebble» right.
  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  const total = homework.tasks.length + 2;
  await expect(student.getByText(new RegExp(`1\\s*/\\s*${total}`)).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  for (let number = 1; number <= total; number++) {
    await expect(student.getByText(new RegExp(`${number}\\s*/\\s*${total}`))).toBeVisible();
    const asked = student.getByText(/^Как переводится «(.+)»\?$/);
    if (await asked.isVisible()) {
      const word = (await asked.innerText()).match(/«(.+)»/)![1]!;
      // The options are the student's translations: for the missed word, the first other one shown.
      const options = (word === MISSED ? Object.values(WORDS).filter((t) => t !== WORDS[word]) : [WORDS[word]!]).map((t) =>
        student.getByRole("button", { name: t, exact: true }),
      );
      for (const choice of options) {
        if (await choice.isVisible()) {
          await choice.click();
          break;
        }
      }
    }
    if (number < total) await student.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await student.getByRole("button", { name: "Всё равно сдать", exact: true }).click();
  await expect(student.getByText("Готово! Домашка сдана, учитель посмотрит")).toBeVisible();
  await student.context().close();

  await page.goto(card);
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await expect(vocabulary.getByRole("listitem").filter({ hasText: MISSED })).toContainText("часто ошибается");
  await expect(vocabulary.getByRole("listitem").filter({ hasText: "pebble" })).not.toContainText("часто ошибается");
});
