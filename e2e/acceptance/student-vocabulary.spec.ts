// Acceptance for #236: the student's words behind their link, and the
// teacher's corrections on the card. «Тренировка слов» is the third section
// of the student's menu (#241): «Мои слова», newest first, searched by word or
// translation, each with its translation and example when there are, and
// «Послушать», which speaks the word with the device's English voice. On the
// card the teacher changes a word, its translation and example, deletes one
// and adds one by hand; the student's list follows. Words reached at
// «Завершить урок» are in lesson-finish.spec.ts. Another student never
// getting these words is an integration test.
//
// The teacher starts signed in (sessions.setup.ts); the student opens the
// link in a fresh browser without her cookies. The words are synthetic.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** On the open card: «Добавить слово» with its word, translation and example. */
async function addWord(page: Page, word: string, translation = "", example = "") {
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await vocabulary.getByRole("button", { name: "Добавить слово", exact: true }).click();
  const form = vocabulary.getByRole("group", { name: "Новое слово" });
  await form.getByLabel("Слово").fill(word);
  await form.getByLabel("Перевод").fill(translation);
  await form.getByLabel("Пример").fill(example);
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(vocabulary.getByRole("listitem").filter({ hasText: word })).toHaveCount(1);
}

async function openWords(browser: Browser, link: string): Promise<Page> {
  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Тренировка слов", exact: true }).click();
  await expect(student.getByRole("heading", { level: 1, name: "Тренировка слов" })).toBeVisible();
  return student;
}

test("the student finds their words by search and hears them; the teacher's corrections on the card reach them", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Словесный");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Словесный" })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  await addWord(page, "lantern");
  await addWord(page, "teapot", "чайник", "The teapot is hot.");
  // The same word twice is refused, whatever its case.
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  await vocabulary.getByRole("button", { name: "Добавить слово", exact: true }).click();
  await vocabulary.getByRole("group", { name: "Новое слово" }).getByLabel("Слово").fill("Teapot");
  await vocabulary.getByRole("group", { name: "Новое слово" }).getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(vocabulary.getByRole("alert")).toContainText("уже есть");
  await vocabulary.getByRole("button", { name: "Отмена", exact: true }).click();

  // The student: newest first, the translation and example, «Послушать», and search by word or translation.
  let student = await openWords(browser, link);
  let mine = student.getByRole("list", { name: "Мои слова" });
  await expect(mine.getByRole("listitem")).toHaveCount(2);
  await expect(mine.getByRole("listitem").first()).toContainText("teapot");
  const teapot = mine.getByRole("listitem").filter({ hasText: "teapot" });
  await expect(teapot).toContainText("чайник");
  await expect(teapot).toContainText("The teapot is hot.");
  await expect(teapot.getByRole("button", { name: "Послушать", exact: true })).toBeVisible();
  await student.getByLabel("Поиск").fill("чай");
  await expect(mine.getByRole("listitem")).toHaveCount(1);
  await expect(mine).toContainText("teapot");
  await student.getByLabel("Поиск").fill("lant");
  await expect(mine.getByRole("listitem")).toHaveCount(1);
  await expect(mine).toContainText("lantern");
  await student.getByLabel("Поиск").fill("zebra");
  await expect(student.getByText("Ничего не нашлось")).toBeVisible();
  await student.context().close();

  // The teacher corrects the translation, deletes a word and adds one.
  await page.goto(card);
  const row = vocabulary.getByRole("listitem").filter({ hasText: "teapot" });
  await row.getByRole("button", { name: "Изменить", exact: true }).click();
  await row.getByLabel("Перевод").fill("заварочный чайник");
  await row.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(row).toContainText("заварочный чайник");
  await vocabulary.getByRole("listitem").filter({ hasText: "lantern" }).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(vocabulary.getByRole("listitem").filter({ hasText: "lantern" })).toHaveCount(0);
  await addWord(page, "pebble", "камешек");
  await page.reload();
  await expect(vocabulary.getByRole("listitem").filter({ hasText: "teapot" })).toContainText("заварочный чайник");

  student = await openWords(browser, link);
  mine = student.getByRole("list", { name: "Мои слова" });
  await expect(mine.getByRole("listitem")).toHaveCount(2);
  await expect(mine.getByRole("listitem").filter({ hasText: "teapot" })).toContainText("заварочный чайник");
  await expect(mine.getByRole("listitem").filter({ hasText: "pebble" })).toContainText("камешек");
  await expect(mine).not.toContainText("lantern");
  await student.context().close();
});
