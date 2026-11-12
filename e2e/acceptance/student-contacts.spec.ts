// Acceptance for #84: the parent's and the student's contacts on the card,
// all optional, for the teacher only.
//
// The teacher starts signed in (sessions.setup.ts); the student and the parent
// open their links in fresh browsers without the teacher's cookies. Values
// are synthetic.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };
const CONTACT_LABELS = ["Имя родителя", "Почта родителя", "Мессенджер родителя", "Почта ученика", "Мессенджер ученика"];

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

async function copied(page: Page, name: "Ссылка ученика" | "Ссылка родителя"): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, name).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

async function openFresh(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  return page;
}

test("the contacts are saved and shown on the card for the teacher only", async ({ page, browser }) => {
  const card = await createStudent(page, "Контакты");
  const contacts = {
    "Имя родителя": "Мама Тестовая",
    "Почта родителя": "parent@example.test",
    "Мессенджер родителя": "@parent_test",
    "Почта ученика": "student@example.test",
    "Мессенджер ученика": "@student_test",
  };

  await control(page, "Изменить").click();
  for (const [label, value] of Object.entries(contacts)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Контакты" })).toBeVisible();

  await page.goto(card);
  for (const value of Object.values(contacts)) await expect(page.getByText(value, { exact: true })).toBeVisible();

  // Neither the student's page nor the parent's shows any of them.
  for (const name of ["Ссылка ученика", "Ссылка родителя"] as const) {
    const other = await openFresh(browser, await copied(page, name));
    await expect(other.getByRole("heading", { level: 1 })).toBeVisible();
    const text = await other.locator("body").innerText();
    for (const value of Object.values(contacts)) expect(text).not.toContain(value);
    await other.context().close();
  }
});

test("empty contacts leave no empty labels on the card", async ({ page }) => {
  await createStudent(page, "Без контактов");
  for (const label of CONTACT_LABELS) await expect(page.getByText(label, { exact: true })).toHaveCount(0);

  await control(page, "Изменить").click();
  await page.getByLabel("Мессенджер родителя", { exact: true }).fill("@only_parent");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Без контактов" })).toBeVisible();

  await expect(page.getByText("@only_parent", { exact: true })).toBeVisible();
  await expect(page.getByText("Почта ученика", { exact: true })).toHaveCount(0);
});
