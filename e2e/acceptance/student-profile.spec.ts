// Acceptance for #41: the teacher fills in the profile fields the assistant
// will read — age, school year, interests, what works, gaps, textbook and the
// current unit — as plain text on the student card.
//
// Every scenario starts signed in (sessions.setup.ts). Values are synthetic.
import { expect, test, type Page } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const PROFILE_LABELS = ["Возраст", "Класс", "Интересы", "Что заходит", "Пробелы", "Учебник", "Текущий юнит"];

function control(page: Page, name: string) {
  return page.getByRole("link", { name }).or(page.getByRole("button", { name }));
}

/** Creates a student through the form and returns the address of the card. */
async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url();
}

async function saveEdit(page: Page, firstName: string) {
  await page.getByRole("button", { name: "Сохранить" }).click();
  // Saving may be a client request; a navigation right away could cut it off.
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
}

test("the profile fields are saved and shown on the card", async ({ page }) => {
  const card = await createStudent(page, "Профиль");
  const profile = {
    Возраст: "13",
    Класс: "7",
    Интересы: "рисует комиксы, кошки",
    "Что заходит": "игры на скорость, карточки",
    Пробелы: "Present Simple в вопросах",
    Учебник: "Учебник 2",
    "Текущий юнит": "Unit 3",
  };

  await control(page, "Изменить").click();
  for (const [label, value] of Object.entries(profile)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await saveEdit(page, "Профиль");

  await page.goto(card);
  for (const value of Object.values(profile)) {
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  }
});

test("empty profile fields are saved and leave no empty labels on the card", async ({ page }) => {
  await createStudent(page, "Без профиля");

  for (const label of PROFILE_LABELS) {
    await expect(page.getByText(label, { exact: true })).toHaveCount(0);
  }

  await control(page, "Изменить").click();
  await page.getByLabel("Интересы", { exact: true }).fill("футбол");
  await saveEdit(page, "Без профиля");

  await expect(page.getByText("футбол", { exact: true })).toBeVisible();
  await expect(page.getByText("Возраст", { exact: true })).toHaveCount(0);
});

test("profile values are saved exactly as typed", async ({ page }) => {
  const card = await createStudent(page, "Как есть");
  // No format checks: an age in words, markup-like text and line breaks all
  // come back unchanged.
  const age = "почти 13";
  const gaps = "артикли <a>/<the>\nвремена: Past & Present";

  await control(page, "Изменить").click();
  await page.getByLabel("Возраст", { exact: true }).fill(age);
  await page.getByLabel("Пробелы", { exact: true }).fill(gaps);
  await saveEdit(page, "Как есть");

  await page.goto(card);
  await expect(page.getByText(age, { exact: true })).toBeVisible();
  await expect(page.getByText("артикли <a>/<the>")).toBeVisible();
  await expect(page.getByText("времена: Past & Present")).toBeVisible();
  await control(page, "Изменить").click();
  await expect(page.getByLabel("Пробелы", { exact: true })).toHaveValue(gaps);
});
