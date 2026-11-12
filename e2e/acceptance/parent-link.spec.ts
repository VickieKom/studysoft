// Acceptance for #20: the parent follows the child's progress from a link of
// their own, view only.
//
// The teacher's scenarios start signed in (sessions.setup.ts). The parent and
// the student always get fresh browser contexts.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_REPORTS = "Отчётов пока нет";
const NO_HOMEWORK = "Домашних заданий пока нет";

function control(page: Page, name: string) {
  return page.getByRole("link", { name }).or(page.getByRole("button", { name }));
}

async function createStudent(page: Page, firstName: string, lastName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Фамилия").fill(lastName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
}

/** Clicks a copy control on the open card and returns what landed on the clipboard. */
async function copyLink(page: Page, name: "Ссылка ученика" | "Ссылка родителя"): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, name).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

async function openInFreshBrowser(browser: Browser, link: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  return page;
}

test("the parent link differs from the student link and opens a read-only page", async ({ page, browser }) => {
  await createStudent(page, "Родительская", "Скрытая");
  const studentLink = await copyLink(page, "Ссылка ученика");
  const parentLink = await copyLink(page, "Ссылка родителя");
  expect(parentLink).not.toBe(studentLink);

  const parent = await openInFreshBrowser(browser, parentLink);
  await expect(parent.getByText("Успехи Родительская")).toBeVisible();
  await expect(parent.getByText(NO_REPORTS)).toBeVisible();
  await expect(parent.getByText("Скрытая")).toHaveCount(0);
  await expect.poll(() => parent.url()).not.toContain("#");
  expect(parent.url()).not.toContain(parentLink.split("#")[1]!);

  // View only: nothing on the page can change anything.
  await expect(parent.getByRole("button")).toHaveCount(0);
  await expect(parent.locator("form, input, textarea, select")).toHaveCount(0);
  await expect(parent.getByRole("link")).toHaveCount(0);
  await parent.context().close();
});

test("a parent session does not open the student page, and a student session does not open the parent page", async ({
  page,
  browser,
}) => {
  await createStudent(page, "Раздельная", "Тестова");
  const studentLink = await copyLink(page, "Ссылка ученика");
  const parentLink = await copyLink(page, "Ссылка родителя");

  const parent = await openInFreshBrowser(browser, parentLink);
  await expect(parent.getByText("Успехи Раздельная")).toBeVisible();
  await parent.goto(new URL(studentLink).pathname);
  await expect(parent.getByText(NO_HOMEWORK)).toHaveCount(0);
  await expect(parent.getByText("Раздельная")).toHaveCount(0);
  await parent.context().close();

  const student = await openInFreshBrowser(browser, studentLink);
  await expect(student.getByText(NO_HOMEWORK)).toBeVisible();
  await student.goto(new URL(parentLink).pathname);
  await expect(student.getByText(NO_REPORTS)).toHaveCount(0);
  await expect(student.getByText("Успехи Раздельная")).toHaveCount(0);
  await student.context().close();
});
