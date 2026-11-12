// Acceptance for #18: the teacher creates, lists and edits students and moves
// them through statuses.
//
// Every scenario starts signed in (sessions.setup.ts). Student names are
// synthetic and unique within a run; the database is reset before each run.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const STUDENTS_URL = /\/teacher\/students(\?.*)?$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// A button now; it may become a link to the form.
function newStudentControl(page: Page) {
  return page.getByRole("link", { name: "Новый ученик" }).or(page.getByRole("button", { name: "Новый ученик" }));
}

function editControl(page: Page) {
  return page.getByRole("link", { name: "Изменить" }).or(page.getByRole("button", { name: "Изменить" }));
}

// An entry of the student list, whether the list is a list or a table.
function listEntry(page: Page, ...texts: string[]) {
  let entry = page.getByRole("listitem").or(page.getByRole("row"));
  for (const text of texts) entry = entry.filter({ hasText: text });
  return entry;
}

// The option shown in a select, by its visible text.
function selectedOption(page: Page, label: string) {
  return page.getByLabel(label).locator("option:checked");
}

type NewStudent = { firstName: string; lastName?: string; level: string; timeZone: string };

async function openStudents(page: Page) {
  await page.goto("/teacher/students");
  await expect(page.getByRole("heading", { level: 1, name: "Ученики" })).toBeVisible();
}

/** Creates a student through the form and returns the address of the card. */
async function createStudent(page: Page, student: NewStudent): Promise<string> {
  await openStudents(page);
  await newStudentControl(page).click();
  await page.getByLabel("Имя").fill(student.firstName);
  if (student.lastName !== undefined) await page.getByLabel("Фамилия").fill(student.lastName);
  await page.getByLabel("Уровень").selectOption({ label: student.level });
  await page.getByLabel("Часовой пояс").selectOption({ label: student.timeZone });
  await page.getByRole("button", { name: "Сохранить" }).click();

  await expect(page.getByRole("heading", { level: 1, name: student.firstName })).toBeVisible();
  return page.url();
}

/** Chooses a status in the list filter, whether it is a select or a set of controls. */
async function filterByStatus(page: Page, status: string) {
  const select = page.getByRole("combobox", { name: "Статус" });
  if ((await select.count()) > 0) {
    await select.selectOption({ label: status });
    return;
  }
  await page
    .getByRole("link", { name: status, exact: true })
    .or(page.getByRole("button", { name: status, exact: true }))
    .or(page.getByRole("tab", { name: status, exact: true }))
    .click();
}

test("a new student gets the status «Обсуждение» and appears in the list", async ({ page }) => {
  await openStudents(page);
  await newStudentControl(page).click();
  await expect(selectedOption(page, "Часовой пояс")).toHaveText("Москва");

  await page.getByLabel("Имя").fill("Первая");
  await page.getByLabel("Уровень").selectOption({ label: "A2" });
  await page.getByRole("button", { name: "Сохранить" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Первая" })).toBeVisible();
  await expect(page.getByText("Обсуждение", { exact: true })).toBeVisible();
  await expect(page.getByText("A2", { exact: true })).toBeVisible();
  await expect(page.getByText("Москва", { exact: true })).toBeVisible();

  await openStudents(page);
  await expect(listEntry(page, "Первая")).toBeVisible();
});

test("the last name is shown on the card and in the list", async ({ page }) => {
  await createStudent(page, { firstName: "Вторая", lastName: "Тестовая", level: "B1", timeZone: "Новосибирск" });

  await expect(page.getByText("Тестовая").first()).toBeVisible();
  await expect(page.getByText("Новосибирск", { exact: true })).toBeVisible();

  await openStudents(page);
  await expect(listEntry(page, "Вторая", "Тестовая")).toBeVisible();
});

test("the edit form saves every field, and «Отмена» changes nothing", async ({ page }) => {
  const card = await createStudent(page, { firstName: "Третья", level: "A1", timeZone: "Москва" });

  await editControl(page).click();
  await page.getByLabel("Имя").fill("Третья изменённая");
  await page.getByLabel("Фамилия").fill("Тестовая-Новая");
  await page.getByLabel("Уровень").selectOption({ label: "C1" });
  await page.getByLabel("Часовой пояс").selectOption({ label: "Казахстан" });
  await page.getByLabel("Статус").selectOption({ label: "Занимается" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  // Saving may be a client request; a navigation right away could cut it off.
  await expect(page.getByRole("heading", { level: 1, name: "Третья изменённая" })).toBeVisible();

  await page.goto(card);
  await expect(page.getByRole("heading", { level: 1, name: "Третья изменённая" })).toBeVisible();
  await expect(page.getByText("Тестовая-Новая").first()).toBeVisible();
  await expect(page.getByText("C1", { exact: true })).toBeVisible();
  await expect(page.getByText("Казахстан", { exact: true })).toBeVisible();
  await expect(page.getByText("Занимается", { exact: true })).toBeVisible();

  await editControl(page).click();
  await page.getByLabel("Имя").fill("Не сохранять");
  await page.getByLabel("Уровень").selectOption({ label: "A1" });
  await page.getByRole("button", { name: "Отмена" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Третья изменённая" })).toBeVisible();
  await page.goto(card);
  await expect(page.getByRole("heading", { level: 1, name: "Третья изменённая" })).toBeVisible();
  await expect(page.getByText("C1", { exact: true })).toBeVisible();
  await expect(page.getByText("Не сохранять")).toHaveCount(0);
});

test("a student with the status «Завершили» is hidden from the default list", async ({ page }) => {
  await createStudent(page, { firstName: "Шестая", level: "B2", timeZone: "Москва" });
  await createStudent(page, { firstName: "Четвёртая", level: "B2", timeZone: "Москва" });
  await editControl(page).click();
  await page.getByLabel("Статус").selectOption({ label: "Завершили" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Завершили", { exact: true })).toBeVisible();

  await openStudents(page);
  await expect(listEntry(page, "Шестая")).toBeVisible();
  await expect(listEntry(page, "Четвёртая")).toHaveCount(0);

  await filterByStatus(page, "Завершили");
  await expect(listEntry(page, "Четвёртая")).toBeVisible();
});

test("another teacher's student card answers like a missing one", async ({ page, browser }) => {
  const card = await createStudent(page, { firstName: "Пятая", lastName: "Чужая", level: "A1", timeZone: "Москва" });
  // The card address carries the student's identifier; a fresh one names a
  // student that does not exist.
  expect(card, "the card address carries the student's identifier").toMatch(UUID);
  const missing = card.replace(UUID, randomUUID());

  const context = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const other = await context.newPage();

  const foreignResponse = await other.goto(card);
  const foreignText = await other.locator("body").innerText();
  const missingResponse = await other.goto(missing);
  const missingText = await other.locator("body").innerText();

  expect(foreignResponse?.status()).toBe(missingResponse?.status());
  expect(foreignResponse?.ok()).toBe(false);
  expect(foreignText).toBe(missingText);
  expect(foreignText).not.toContain("Пятая");
  expect(foreignText).not.toContain("Чужая");
  await context.close();
});

test("a form without a first name is not saved and points at the field", async ({ page }) => {
  await openStudents(page);
  const entriesBefore = await listEntry(page).count();
  await newStudentControl(page).click();
  const form = page.url();
  await page.getByLabel("Уровень").selectOption({ label: "A1" });
  await page.getByRole("button", { name: "Сохранить" }).click();

  // Either the browser's own check or the form's message marks the field.
  const firstName = page.getByLabel("Имя");
  await expect
    .poll(() =>
      firstName.evaluate(
        (field) => field.getAttribute("aria-invalid") === "true" || !(field as HTMLInputElement).validity.valid,
      ),
    )
    .toBe(true);
  expect(page.url()).toBe(form);

  await openStudents(page);
  await expect(page).toHaveURL(STUDENTS_URL);
  await expect(listEntry(page)).toHaveCount(entriesBefore);
});

test("names are saved exactly as typed", async ({ page }) => {
  // No format checks: punctuation, Latin letters, digits, markup-like text and
  // a long value all come back unchanged.
  const firstName = "Ёлка-Мари д’Арк «№1» <b>&amp;</b> Zz9";
  const lastName = "Тестова".repeat(30);

  await createStudent(page, { firstName, lastName, level: "B1", timeZone: "Москва" });
  await expect(page.getByText(lastName).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await expect(page.getByText(lastName).first()).toBeVisible();
});
