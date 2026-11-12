// Acceptance for #19: the teacher copies a student's permanent link from the
// card, and the student opens it without signing in.
//
// The teacher's scenarios start signed in (sessions.setup.ts). The student
// always gets a fresh browser context: no teacher session, no cookies.
import { randomBytes } from "node:crypto";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_HOMEWORK = "Домашних заданий пока нет";
const LINK_GONE = "Ссылка больше не действует";

function control(page: Page, name: string) {
  return page.getByRole("link", { name }).or(page.getByRole("button", { name }));
}

/** Creates a student through the form and returns the address of the card. */
async function createStudent(page: Page, firstName: string, lastName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Фамилия").fill(lastName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url();
}

/** Clicks "Ссылка ученика" on the open card and returns what landed on the clipboard. */
async function copyStudentLink(page: Page): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Opens a link in a fresh browser, as the student would, and returns the page. */
async function openAsStudent(browser: Browser, link: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  return page;
}

test("the student opens the copied link without signing in, and the token leaves the address", async ({
  page,
  browser,
}) => {
  await createStudent(page, "Ссылкина", "Фамильная");
  const link = await copyStudentLink(page);

  const student = await openAsStudent(browser, link);
  await expect(student.getByText("Ссылкина")).toBeVisible();
  await expect(student.getByText(NO_HOMEWORK)).toBeVisible();
  await expect(student.getByText("Фамильная")).toHaveCount(0);
  // The token is exchanged for a session and removed from the address bar.
  await expect.poll(() => student.url()).not.toContain("#");
  expect(student.url()).not.toContain(link.split("#")[1]!);
  await student.context().close();
});

test("copying the link again gives the same link, and it still opens", async ({ page, browser }) => {
  const card = await createStudent(page, "Повторная", "Ссылка");
  const first = await copyStudentLink(page);

  await page.goto("/teacher/students");
  await page.goto(card);
  const second = await copyStudentLink(page);
  expect(second).toBe(first);

  const student = await openAsStudent(browser, second);
  await expect(student.getByText("Повторная")).toBeVisible();
  await student.context().close();
});

test("after the browser is closed and reopened, the bookmark opens the page without the token", async ({
  page,
  browser,
}) => {
  await createStudent(page, "Закладка", "Тестова");
  const link = await copyStudentLink(page);

  const student = await openAsStudent(browser, link);
  await expect(student.getByText("Закладка")).toBeVisible();
  await expect.poll(() => student.url()).not.toContain("#");
  const bookmark = student.url();
  // "Closing the browser": keep only what a browser keeps on disk.
  const saved = await student.context().storageState();
  await student.context().close();

  const reopened = await browser.newContext({ storageState: saved });
  const again = await reopened.newPage();
  await again.goto(bookmark);
  await expect(again.getByText("Закладка")).toBeVisible();
  await expect(again.getByText(NO_HOMEWORK)).toBeVisible();
  await reopened.close();
});

test("a link with a random token shows that the link no longer works", async ({ browser }) => {
  const token = randomBytes(32).toString("base64url");
  const student = await openAsStudent(browser, `/s#${token}`);

  await expect(student.getByText(LINK_GONE)).toBeVisible();
  await expect(student.getByText(NO_HOMEWORK)).toHaveCount(0);
  await student.context().close();
});

test("the student page shows nothing of the workspace and no other student", async ({ page, browser }) => {
  await createStudent(page, "Соседка", "Другая");
  await createStudent(page, "Своя", "Скрытая");
  const link = await copyStudentLink(page);

  const student = await openAsStudent(browser, link);
  await expect(student.getByText("Своя")).toBeVisible();
  const text = await student.locator("body").innerText();
  for (const hidden of ["Соседка", "Другая", "Скрытая", "Ученики", "Новый ученик", "Изменить"]) {
    expect(text).not.toContain(hidden);
  }
  await student.context().close();
});
