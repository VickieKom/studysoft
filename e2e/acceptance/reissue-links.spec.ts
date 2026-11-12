// Acceptance for #21: a link is a key, so the teacher can take it back —
// by reissuing it, and by moving the student to «Завершили».
//
// The teacher's scenarios start signed in (sessions.setup.ts). Students and
// parents always get fresh browser contexts. No action asks for confirmation
// (product owner's decision in #21).
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_HOMEWORK = "Домашних заданий пока нет";
const NO_REPORTS = "Отчётов пока нет";
const LINK_GONE = "Ссылка больше не действует";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url();
}

async function copyLink(page: Page, name: "Ссылка ученика" | "Ссылка родителя"): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, name).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

async function setStatus(page: Page, card: string, firstName: string, status: string) {
  await page.goto(card);
  await control(page, "Изменить").click();
  await page.getByLabel("Статус").selectOption({ label: status });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await expect(page.getByText(status, { exact: true })).toBeVisible();
}

async function openInFreshBrowser(browser: Browser, link: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  return page;
}

async function expectGone(browser: Browser, link: string) {
  const page = await openInFreshBrowser(browser, link);
  await expect(page.getByText(LINK_GONE)).toBeVisible();
  await expect(page.getByText(NO_HOMEWORK)).toHaveCount(0);
  await expect(page.getByText(NO_REPORTS)).toHaveCount(0);
  await page.context().close();
}

test("reissuing the student link ends the old link and the sessions opened from it", async ({ page, browser }) => {
  const card = await createStudent(page, "Перевыпуск");
  const oldLink = await copyLink(page, "Ссылка ученика");
  const parentLink = await copyLink(page, "Ссылка родителя");

  const student = await openInFreshBrowser(browser, oldLink);
  await expect(student.getByText(NO_HOMEWORK)).toBeVisible();

  await page.goto(card);
  await control(page, "Перевыпустить ссылку ученика").click();
  const newLink = await copyLink(page, "Ссылка ученика");
  expect(newLink).not.toBe(oldLink);

  await expectGone(browser, oldLink);

  // The tab the student already had open: after a reload, the same answer.
  await student.reload();
  await expect(student.getByText(LINK_GONE)).toBeVisible();
  await expect(student.getByText(NO_HOMEWORK)).toHaveCount(0);
  await student.context().close();

  const fresh = await openInFreshBrowser(browser, newLink);
  await expect(fresh.getByText(NO_HOMEWORK)).toBeVisible();
  await fresh.context().close();

  // Reissuing the student link leaves the parent link alone.
  const parent = await openInFreshBrowser(browser, parentLink);
  await expect(parent.getByText(NO_REPORTS)).toBeVisible();
  await parent.context().close();
});

test("the parent link is reissued separately", async ({ page, browser }) => {
  const card = await createStudent(page, "Родитель-перевыпуск");
  const studentLink = await copyLink(page, "Ссылка ученика");
  const oldParentLink = await copyLink(page, "Ссылка родителя");

  await page.goto(card);
  await control(page, "Перевыпустить ссылку родителя").click();
  const newParentLink = await copyLink(page, "Ссылка родителя");
  expect(newParentLink).not.toBe(oldParentLink);
  expect(await copyLink(page, "Ссылка ученика")).toBe(studentLink);

  await expectGone(browser, oldParentLink);
  const parent = await openInFreshBrowser(browser, newParentLink);
  await expect(parent.getByText(NO_REPORTS)).toBeVisible();
  await parent.context().close();
});

test("«Завершили» closes both links; coming back gives new links and the old ones stay closed", async ({
  page,
  browser,
}) => {
  const card = await createStudent(page, "Закрытие");
  const oldStudentLink = await copyLink(page, "Ссылка ученика");
  const oldParentLink = await copyLink(page, "Ссылка родителя");

  await setStatus(page, card, "Закрытие", "Завершили");
  await expectGone(browser, oldStudentLink);
  await expectGone(browser, oldParentLink);

  await setStatus(page, card, "Закрытие", "Занимается");
  const newStudentLink = await copyLink(page, "Ссылка ученика");
  const newParentLink = await copyLink(page, "Ссылка родителя");
  expect(newStudentLink).not.toBe(oldStudentLink);
  expect(newParentLink).not.toBe(oldParentLink);

  const student = await openInFreshBrowser(browser, newStudentLink);
  await expect(student.getByText(NO_HOMEWORK)).toBeVisible();
  await student.context().close();
  const parent = await openInFreshBrowser(browser, newParentLink);
  await expect(parent.getByText(NO_REPORTS)).toBeVisible();
  await parent.context().close();

  await expectGone(browser, oldStudentLink);
  await expectGone(browser, oldParentLink);
});

test("«На паузе» does not affect access", async ({ page, browser }) => {
  const card = await createStudent(page, "Пауза");
  const link = await copyLink(page, "Ссылка ученика");

  await setStatus(page, card, "Пауза", "На паузе");
  const student = await openInFreshBrowser(browser, link);
  await expect(student.getByText(NO_HOMEWORK)).toBeVisible();
  await student.context().close();
});
