// Acceptance for #161: a workbook's "put the words in order" with several
// sentences stays one task under one instruction, and each sentence is its own
// point. The student orders every sentence on the same screen; two right and
// one wrong count 2 right and 1 wrong; «Проверка домашек» marks the wrong
// sentence, with its right order, and the mistakes by topic count one mistake.
// The teacher's mark is per sentence (product owner, 2026-11-18): marking the
// wrong one right makes it 3 right. Nothing the student's page receives before
// submission holds a right order.
//
// The teacher starts signed in (sessions.setup.ts). The homework is synthetic
// (deploy/seed/homework/demo-order-sentences.json).
import { expect, type Locator, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-order-sentences.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

// A student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const [task] = homework.tasks;
const sentences = task!.sentences.map((s) => s.words);
const firstName = "Порядок слов";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** One sentence of the task: «Предложение 1», «Предложение 2», … */
function sentence(scope: Page | Locator, n: number) {
  return scope.getByRole("group", { name: `Предложение ${n}`, exact: true });
}

/** Places the words of a sentence in the given order by tapping them. */
async function place(scope: Locator, words: string[]) {
  for (const word of words) await scope.getByRole("button", { name: word, exact: true }).first().click();
}

test("three sentences on one screen, each its own point; the review marks the wrong one, and the teacher's mark is per sentence", async ({
  page,
  browser,
}) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework, null, 2));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  const received: string[] = [];
  student.on("response", async (response) => {
    if (response.url().includes("/api/trpc/")) received.push(await response.text().catch(() => ""));
  });
  await student.goto(link);
  await expect(student.getByText(task!.prompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();

  // One instruction, three sentences on the same screen.
  await expect(student.getByRole("heading", { level: 1 })).toHaveText(task!.prompt);
  for (const n of [1, 2, 3]) await expect(sentence(student, n)).toBeVisible();
  await expect(sentence(student, 4)).toHaveCount(0);

  // Nothing received so far holds a right order.
  for (const words of sentences) expect(received.join("\n")).not.toContain(JSON.stringify(words));

  // The first two right, the third wrong.
  await place(sentence(student, 1), sentences[0]!);
  await place(sentence(student, 2), sentences[1]!);
  const [she, is, my, best, friend] = sentences[2]! as [string, string, string, string, string];
  await place(sentence(student, 3), [she, is, best, my, friend]);
  await student.getByRole("button", { name: "Сдать", exact: true }).click();

  // One task, three points: 2 right, 1 wrong.
  await expect(student.getByText(/2\s+верно,\s+1\s+неверно/)).toBeVisible();
  await student.context().close();

  // «Проверка домашек»: the wrong sentence is marked, with its right order.
  await page.goto("/teacher/students");
  await page.getByRole("link", { name: /Проверка домашек/ }).click();
  // The student list has a row with the same name: wait for the review list before picking the row.
  await expect(page.getByRole("heading", { level: 1, name: "Проверка домашек" })).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(firstName);
  await expect(page.getByText("2 верно, 1 неверно")).toBeVisible();
  await expect(sentence(page, 3)).toContainText(`Правильный ответ: ${sentences[2]!.join(" ")}`);
  for (const n of [1, 2]) await expect(sentence(page, n).getByText(/Правильный ответ/)).toHaveCount(0);

  // The mistakes by topic count one mistake for the task.
  const byTopic = page.getByRole("region", { name: "Ошибки по темам" });
  await expect(byTopic).toContainText(`${task!.topic}: 1`);

  // The teacher marks the wrong sentence right: 3 right, no mistakes.
  await sentence(page, 3).getByRole("button", { name: "Верно", exact: true }).click();
  await expect(page.getByText("3 верно, 0 неверно")).toBeVisible();
  await expect(byTopic).toContainText("Ошибок нет");
});
