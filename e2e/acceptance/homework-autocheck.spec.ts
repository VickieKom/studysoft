// Acceptance for #34: the student does a published homework of auto-checked
// tasks on a phone, one task per screen, and submits once. After «Сдать» the
// child is praised without a score (#227, product owner 2026-11-20: the
// automatic check does not decide for the teacher); the score is the
// teacher's, in «Проверка домашек».
//
// The teacher's part starts signed in (sessions.setup.ts); the student opens
// the link in a fresh, phone-sized browser. The homework is synthetic
// (deploy/seed/homework/demo-auto-checked.json, docs/homework-format.md).
import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-auto-checked.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const PHONE = { width: 390, height: 844 };
const TOTAL = homework.tasks.length;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** An answer option, whether it is a radio, a checkbox or a toggle button. */
function option(page: Page, name: string): Locator {
  return page
    .getByRole("radio", { name, exact: true })
    .or(page.getByRole("checkbox", { name, exact: true }))
    .or(page.getByRole("button", { name, exact: true }));
}

async function isSelected(locator: Locator): Promise<boolean> {
  return locator.evaluate(
    (element) =>
      (element as HTMLInputElement).checked === true ||
      element.getAttribute("aria-checked") === "true" ||
      element.getAttribute("aria-pressed") === "true",
  );
}

/** The teacher creates a student, publishes the homework and returns the student's link. */
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
  const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Срок").fill(due);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
  return link;
}

async function openOnPhone(browser: Browser, link: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(link);
  // The homework may open on a start screen first.
  await expect(page.getByText(homework.tasks[0]!.prompt).or(control(page, "Начать"))).toBeVisible();
  if (await control(page, "Начать").isVisible()) await control(page, "Начать").click();
  return { context, page };
}

async function expectTask(page: Page, number: number) {
  await expect(page.getByText(homework.tasks[number - 1]!.prompt)).toBeVisible();
  await expect(page.getByText(new RegExp(`${number}\\s*/\\s*${TOTAL}`))).toBeVisible();
  // One task per screen: no other task's prompt is on it.
  for (const [index, task] of homework.tasks.entries()) {
    if (index !== number - 1) await expect(page.getByText(task.prompt)).toHaveCount(0);
  }
}

const next = (page: Page) => page.getByRole("button", { name: "Дальше", exact: true }).click();

/** Answers tasks 1–2: the colour right, the animals wrong (one of two). */
async function answerFirstHalf(page: Page) {
  await expectTask(page, 1);
  await option(page, "blue").click();
  await next(page);
  await expectTask(page, 2);
  await option(page, "cat").click();
  await next(page);
}

/** Answers tasks 3–5: the gap right despite case, spaces and a typographic apostrophe; pairs right; order wrong. */
async function answerSecondHalf(page: Page) {
  await expectTask(page, 3);
  await page.getByRole("textbox").fill("  IT’S ");
  await next(page);
  await expectTask(page, 4);
  for (const [left, right] of [["hot", "cold"], ["big", "small"]] as const) {
    await option(page, left).click();
    await option(page, right).click();
  }
  await next(page);
  await expectTask(page, 5);
  for (const word of ["We", "after", "play", "school"]) await option(page, word).click();
}

test("the student does the homework on a phone, one task per screen, with a progress bar", async ({
  page,
  browser,
}) => {
  const link = await publishedHomeworkLink(page, "Телефон");
  const student = await openOnPhone(browser, link);
  await expectTask(student.page, 1);
  await expect(student.page.getByRole("progressbar")).toBeVisible();
  const width = await student.page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(PHONE.width);
  await student.context.close();
});

test("answers survive closing the tab, and «Сдать» shows praise without a score; the teacher sees the score", async ({
  page,
  browser,
}) => {
  const link = await publishedHomeworkLink(page, "Сдача");
  const first = await openOnPhone(browser, link);
  await answerFirstHalf(first.page);
  // "Closing the tab" and opening the link again on the same device.
  const saved = await first.context.storageState();
  const bookmark = new URL(first.page.url()).pathname;
  await first.context.close();

  const context = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true, storageState: saved });
  const page2 = await context.newPage();
  await page2.goto(bookmark);
  if (await control(page2, "Начать").isVisible()) await control(page2, "Начать").click();
  // Back to the first task: the earlier answer is still chosen.
  while (!(await page2.getByText(homework.tasks[0]!.prompt).isVisible())) {
    await page2.getByRole("button", { name: "Назад", exact: true }).click();
  }
  expect(await isSelected(option(page2, "blue"))).toBe(true);
  await next(page2);
  expect(await isSelected(option(page2, "cat"))).toBe(true);
  await next(page2);

  await answerSecondHalf(page2);
  await page2.getByRole("button", { name: "Сдать", exact: true }).click();

  // Praise, no score and nothing of the tasks.
  await expect(page2.getByText("Готово! Домашка сдана, учитель посмотрит")).toBeVisible();
  await expect(page2.getByText(/верно/)).toHaveCount(0);
  for (const task of homework.tasks) await expect(page2.getByText(task.prompt)).toHaveCount(0);

  // Opening the link again shows the same, not the tasks.
  await page2.goto(bookmark);
  await expect(page2.getByText("Домашка сдана")).toBeVisible();
  await expect(page2.getByText(/верно/)).toHaveCount(0);
  await expect(page2.getByText(homework.tasks[0]!.prompt)).toHaveCount(0);
  await expect(page2.getByRole("button", { name: "Сдать", exact: true })).toHaveCount(0);
  await context.close();

  // 3 right (colour, gap, pairs), 2 wrong (animals, order): the teacher's to see.
  await page.goto("/teacher/homework-review");
  await page.getByLabel("Ученик").selectOption({ label: "Сдача" });
  await expect(page.getByRole("listitem").filter({ hasText: "Сдача" })).toContainText("3 верно, 2 неверно");
});
