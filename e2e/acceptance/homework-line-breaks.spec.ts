// Acceptance for #130: a line break in a task's prompt or in a gap text is
// shown as a new line — in the teacher's preview, on the student's page and
// in «Проверка домашек». One sentence per line is how a workbook exercise is
// laid out, and how the teacher checks it (product owner, 2026-11-17).
//
// The homework is synthetic, written here. Rendered line breaks are read
// through innerText, which follows what the page shows: a collapsed line
// break reads as a space.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

const homework = {
  version: 1,
  title: "Lines",
  tasks: [
    {
      type: "gap",
      prompt: "Read the lines.\nFill in each gap.",
      text: "Alpha ___ one.\nBeta ___ two.\nGamma ___ three.",
      answers: [["is"], ["is"], ["is"]],
    },
  ],
};

/** The prompt's two lines, each on its own. */
const PROMPT_LINES = /Read the lines\.[ \t]*\n\s*Fill in each gap\./;
/** The gap text's three lines, each on its own; the gaps themselves are fields or `___`. */
const TEXT_LINES = /one\.[ \t]*\n\s*Beta[\s\S]*two\.[ \t]*\n\s*Gamma/;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function innerText(locator: Locator): Promise<string> {
  return locator.evaluate((element: HTMLElement) => element.innerText);
}

async function createStudentWithLink(page: Page, firstName: string): Promise<{ card: string; link: string }> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return { card, link: await page.evaluate(() => navigator.clipboard.readText()) };
}

async function openAsStudent(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect(page.getByText("Fill in each gap.").or(control(page, "Начать"))).toBeVisible();
  if (await control(page, "Начать").isVisible()) await control(page, "Начать").click();
  return page;
}

test("line breaks in a prompt and a gap text stay new lines in the preview, for the student and in the review", async ({
  page,
  browser,
}) => {
  const { card, link } = await createStudentWithLink(page, "Строки");

  await page.goto(card);
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();

  // The teacher's preview.
  const preview = page.getByRole("listitem").filter({ hasText: "Fill in each gap." });
  await expect(preview).toHaveCount(1);
  expect(await innerText(preview)).toMatch(PROMPT_LINES);
  expect(await innerText(preview)).toMatch(TEXT_LINES);

  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  // The student's page: the same lines, each gap still a field of its own.
  const student = await openAsStudent(browser, link);
  for (let i = 1; i <= 3; i++) await expect(student.getByLabel(`Пропуск ${i}`)).toBeVisible();
  const main = student.getByRole("main");
  expect(await innerText(main)).toMatch(PROMPT_LINES);
  expect(await innerText(main)).toMatch(TEXT_LINES);
  for (let i = 1; i <= 3; i++) await student.getByLabel(`Пропуск ${i}`).fill("is");
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText("Домашка сдана")).toBeVisible();
  await student.context().close();

  // «Проверка домашек»: the prompt keeps its lines.
  await page.goto("/teacher/students");
  await page.getByRole("link", { name: /Проверка домашек/ }).click();
  await page.getByLabel("Ученик").selectOption({ label: "Строки" });
  const rows = page.getByRole("listitem").filter({ hasText: "Строки" });
  await expect(rows).toHaveCount(1);
  await rows.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Строки");
  const reviewed = page.getByRole("listitem").filter({ hasText: "Fill in each gap." });
  await expect(reviewed).toHaveCount(1);
  expect(await innerText(reviewed)).toMatch(PROMPT_LINES);
});
