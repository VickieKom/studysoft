// Acceptance for #281: «Из словаря» in a student's homework draft. The
// teacher picks the student's words with a confirmed translation and the
// task types «Сопоставление» and «Выбрать перевод»; the tasks join the
// draft with their answers set by the platform, and the automatic check
// marks the student's right answers right. A word without a translation is
// not offered; with fewer than four words «Выбрать перевод» is unavailable.
// Which words are ticked at first (the last lesson's and the weak ones),
// that the tasks remember their words and that the student never receives
// that link are pinned by integration tests.
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

function control(page: Page | Locator, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** An answer option, whether it is a radio or a toggle button. */
function option(page: Page, name: string): Locator {
  return page.getByRole("radio", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
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

/** A new student with `words` in the vocabulary and an imported homework draft open; returns the student's link. */
async function draftWithWords(page: Page, firstName: string, words: [string, string][]): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());
  for (const [word, translation] of words) await addWord(page, word, translation);

  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();
  return link;
}

test("words picked from the vocabulary become a matching task and a choice of translation per word; the check marks them right", async ({ page, browser }) => {
  const link = await draftWithWords(page, "Словарный", [...Object.entries(WORDS), ["owl", ""]]);

  await control(page, "Из словаря").click();
  const picker = page.getByRole("group", { name: "Из словаря" });
  // Only words with a translation are offered.
  for (const [word, translation] of Object.entries(WORDS)) {
    await picker.getByRole("checkbox", { name: `${word} — ${translation}` }).check();
  }
  await expect(picker.getByText("owl")).toHaveCount(0);
  await picker.getByRole("checkbox", { name: "Сопоставление", exact: true }).check();
  await picker.getByRole("checkbox", { name: "Выбрать перевод", exact: true }).check();
  await picker.getByRole("button", { name: "Добавить", exact: true }).click();

  // One matching task on the four words, and a choice of translation for each of them.
  const tasks = page.getByRole("listitem");
  await expect(tasks.filter({ hasText: "Соедини слово и перевод" })).toHaveCount(1);
  for (const word of Object.keys(WORDS)) await expect(tasks.filter({ hasText: `Как переводится «${word}»?` })).toHaveCount(1);
  await page.reload();
  await expect(tasks.filter({ hasText: "Соедини слово и перевод" })).toHaveCount(1);

  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  // The student answers the vocabulary tasks rightly and leaves the imported ones.
  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  // The two imported tasks, the matching one and four choices.
  const total = homework.tasks.length + 1 + Object.keys(WORDS).length;
  // The homework may open on a start screen first.
  await expect(student.getByText(new RegExp(`1\\s*/\\s*${total}`)).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  for (let number = 1; number <= total; number++) {
    await expect(student.getByText(new RegExp(`${number}\\s*/\\s*${total}`))).toBeVisible();
    if (await student.getByText("Соедини слово и перевод").isVisible()) {
      for (const [word, translation] of Object.entries(WORDS)) {
        await option(student, word).click();
        await option(student, translation).click();
      }
    }
    const asked = student.getByText(/^Как переводится «(.+)»\?$/);
    if (await asked.isVisible()) await option(student, WORDS[(await asked.innerText()).match(/«(.+)»/)![1]!]!).click();
    if (number < total) await student.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText("Готово! Домашка сдана, учитель посмотрит")).toBeVisible();
  await student.context().close();

  // The matching task and the four choices are right: the teacher's to see (#227).
  await page.goto("/teacher/homework-review");
  await page.getByLabel("Ученик").selectOption({ label: "Словарный" });
  await expect(page.getByRole("listitem").filter({ hasText: "Словарный" })).toContainText("5 верно");
});

test("with fewer than four words a choice of translation is unavailable and says why", async ({ page }) => {
  await draftWithWords(page, "Малословный", [
    ["teapot", WORDS.teapot!],
    ["pebble", WORDS.pebble!],
    ["ladder", WORDS.ladder!],
  ]);
  await control(page, "Из словаря").click();
  const picker = page.getByRole("group", { name: "Из словаря" });
  await expect(picker.getByRole("checkbox", { name: "Выбрать перевод", exact: true })).toBeDisabled();
  await expect(picker).toContainText("Нужно хотя бы 4 слова с переводом");
  // Matching needs two words and stays available.
  await picker.getByRole("checkbox", { name: "teapot — чайник" }).check();
  await picker.getByRole("checkbox", { name: "pebble — камешек" }).check();
  await picker.getByRole("checkbox", { name: "Сопоставление", exact: true }).check();
  await picker.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Соедини слово и перевод" })).toHaveCount(1);
});
