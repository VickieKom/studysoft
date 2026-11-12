// Acceptance for #36: after the student submits, the teacher reviews the
// homework in «Проверка домашек»: every answer, mistakes by topic, her own
// marks and a comment, and «Открыть заново для ученика».
//
// The teacher's part starts signed in (sessions.setup.ts); the student opens
// the link in a fresh browser without the teacher's cookies. The homework is
// synthetic (deploy/seed/homework/demo-review.json). Scenarios run one at a
// time (workers: 1), so the menu counter is compared before and after.
// A submission leaves the counter once the teacher has opened it and marked
// every open task, and a reopened homework starts blank for the student
// (product owner, 2026-11-12).
import { randomUUID } from "node:crypto";
import { type Browser, expect, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-review.json" with { type: "json" };
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const [sky, gap, animals, day] = homework.tasks as [
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
];

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function publishedHomeworkLink(page: Page, firstName: string): Promise<string> {
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
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
  return link;
}

type Answers = { gap: string; animals: string[] };

/**
 * The student does the homework and submits it: the sky right, the gap and
 * the animals as given, the written task left for the teacher. Returns the
 * student's page, still open.
 */
async function submitAsStudent(page: Page, answers: Answers): Promise<void> {
  await expect(page.getByText(sky.prompt).or(control(page, "Начать"))).toBeVisible();
  if (await control(page, "Начать").isVisible()) await control(page, "Начать").click();
  await page.getByRole("button", { name: "blue", exact: true }).click();
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByText(gap.prompt)).toBeVisible();
  await page.getByLabel("Пропуск 1").fill(answers.gap);
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByText(animals.prompt)).toBeVisible();
  for (const animal of answers.animals) await page.getByRole("button", { name: animal, exact: true }).click();
  await page.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(page.getByText(day.prompt)).toBeVisible();
  await page.getByRole("button", { name: "Сдать", exact: true }).click();
  // The written task is left blank; submitting anyway is allowed (#34). The
  // warning, if the page shows one, comes after the answers are saved, so
  // wait for either it or the result before deciding.
  const result = page.getByText(/\d+\s+верно/);
  const confirm = page.getByRole("button", { name: "Всё равно сдать", exact: true });
  await expect(result.or(confirm)).toBeVisible();
  if (await confirm.isVisible()) await confirm.click();
  await expect(result).toBeVisible();
}

async function openAsStudent(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  return page;
}

/** The number on «Проверка домашек» in the menu; none shown means 0. */
async function waiting(page: Page): Promise<number> {
  await page.goto("/teacher/students");
  const item = page.getByRole("link", { name: /Проверка домашек/ });
  await expect(item).toBeVisible();
  const match = /(\d+)/.exec((await item.textContent()) ?? "");
  return match ? Number(match[1]) : 0;
}

/** Opens «Проверка домашек», filters by the student and opens their current submission. */
async function openSubmission(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await page.getByRole("link", { name: /Проверка домашек/ }).click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  const rows = page.getByRole("listitem").filter({ hasText: firstName });
  await expect(rows).toHaveCount(1);
  await rows.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(firstName);
}

/** One task on the submission page, by its prompt. */
function task(page: Page, prompt: string) {
  return page.getByRole("listitem").filter({ hasText: prompt });
}

test("a submission waits in «Проверка домашек» with its score; every answer is shown, mistakes by topic", async ({
  page,
  browser,
}) => {
  const before = await waiting(page);
  const link = await publishedHomeworkLink(page, "Разбор");
  const student = await openAsStudent(browser, link);
  await submitAsStudent(student, { gap: "are", animals: ["cat"] });
  await student.context().close();

  expect(await waiting(page)).toBe(before + 1);

  await page.getByRole("link", { name: /Проверка домашек/ }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Разбор" });
  await expect(row).toContainText("1 верно, 2 неверно");
  await expect(row).toContainText("ждёт проверки");
  await expect(row).toContainText(/\d{1,2} [а-я]+/);

  await openSubmission(page, "Разбор");
  await expect(task(page, sky.prompt)).toContainText("blue");
  await expect(task(page, gap.prompt)).toContainText("are");
  await expect(task(page, gap.prompt)).toContainText("Правильный ответ: is");
  await expect(task(page, animals.prompt)).toContainText("cat");
  await expect(task(page, animals.prompt)).toContainText("Правильный ответ: cat, dog");
  await expect(task(page, sky.prompt)).not.toContainText("Правильный ответ");
  await expect(task(page, day.prompt)).toContainText("Без ответа");

  const byTopic = page.getByRole("region", { name: "Ошибки по темам" });
  await expect(byTopic).toContainText("to be");
  await expect(byTopic).toContainText("animals");
  await expect(byTopic).not.toContainText("colours");

  // Opened, but the written task is not marked yet: still waiting.
  expect(await waiting(page)).toBe(before + 1);
});

test("the teacher's marks change the score and stay; a comment stays; the counter goes down", async ({
  page,
  browser,
}) => {
  const link = await publishedHomeworkLink(page, "Оценки");
  const student = await openAsStudent(browser, link);
  await submitAsStudent(student, { gap: "are", animals: ["cat"] });
  await student.context().close();
  const before = await waiting(page);

  await openSubmission(page, "Оценки");
  await expect(page.getByText("1 верно, 2 неверно")).toBeVisible();
  // Override an automatic result, and mark the open task.
  await task(page, gap.prompt).getByRole("button", { name: "Верно", exact: true }).click();
  await expect(page.getByText("2 верно, 1 неверно")).toBeVisible();
  await task(page, day.prompt).getByRole("button", { name: "Неверно", exact: true }).click();
  await expect(page.getByText("2 верно, 2 неверно")).toBeVisible();

  await page.getByLabel("Комментарий к домашке").fill("Повтори to be.");
  await page.getByRole("button", { name: "Сохранить комментарий", exact: true }).click();
  await expect(page.getByText("Комментарий сохранён")).toBeVisible();

  await page.reload();
  await expect(page.getByText("2 верно, 2 неверно")).toBeVisible();
  await expect(page.getByLabel("Комментарий к домашке")).toHaveValue("Повтори to be.");
  expect(await waiting(page)).toBe(before - 1);
});

test("«Открыть заново для ученика»: the student does it again, both attempts are kept, the latest counts", async ({
  page,
  browser,
}) => {
  const link = await publishedHomeworkLink(page, "Заново");
  const first = await openAsStudent(browser, link);
  await submitAsStudent(first, { gap: "are", animals: ["cat"] });
  const studentState = await first.context().storageState();
  await first.context().close();

  await openSubmission(page, "Заново");
  await page.getByRole("button", { name: "Открыть заново для ученика", exact: true }).click();
  await expect(page.getByText("Открыта заново")).toBeVisible();

  // The second attempt starts blank: «cat» is not chosen yet, so clicking both
  // animals chooses both.
  const again = await (await browser.newContext({ storageState: studentState })).newPage();
  await again.goto(new URL(link).pathname);
  await submitAsStudent(again, { gap: "is", animals: ["cat", "dog"] });
  await expect(again.getByText(/3\s+верно/)).toBeVisible();
  await again.context().close();

  await openSubmission(page, "Заново");
  await expect(page.getByText("3 верно, 0 неверно").first()).toBeVisible();
  const attempts = page.getByRole("region", { name: "Попытки" }).getByRole("listitem");
  await expect(attempts).toHaveCount(2);
  await expect(attempts.nth(0)).toContainText("3 верно, 0 неверно");
  await expect(attempts.nth(0)).toContainText("текущая");
  await expect(attempts.nth(1)).toContainText("1 верно, 2 неверно");
});

test("another teacher's submission answers like a missing one", async ({ page, browser }) => {
  const link = await publishedHomeworkLink(page, "Чужая сдача");
  const student = await openAsStudent(browser, link);
  await submitAsStudent(student, { gap: "is", animals: ["cat", "dog"] });
  await student.context().close();

  await openSubmission(page, "Чужая сдача");
  const submission = page.url();
  expect(submission, "the submission address carries its identifier").toMatch(UUID);
  const missing = submission.replace(UUID, randomUUID());

  const context = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const other = await context.newPage();
  const foreignResponse = await other.goto(submission);
  const foreignText = await other.locator("body").innerText();
  const missingResponse = await other.goto(missing);
  const missingText = await other.locator("body").innerText();

  expect(foreignResponse?.status()).toBe(missingResponse?.status());
  expect(foreignResponse?.ok()).toBe(false);
  expect(foreignText).toBe(missingText);
  expect(foreignText).not.toContain("Чужая сдача");
  await context.close();
});
