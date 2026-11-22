// Acceptance for #290: a material of the library has several topics, typed
// into «Тема» separated by commas. The «Тема» filter offers each of them and
// finds the material by any; the material's page shows them all; an edit
// changes them. A topic repeated in another letter case is kept once. The
// limits (10 topics of 100 characters), old materials keeping their one
// topic, and the assistant's drafts are pinned by integration tests.
//
// The teacher starts signed in (sessions.setup.ts). The game is synthetic
// HTML written here.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const game = (name: string) =>
  Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title></head><body><h1>${name}</h1></body></html>`);

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

function materials(page: Page) {
  return page.getByRole("list", { name: "Материалы" }).getByRole("listitem");
}

async function filterByTopic(page: Page, topic: string) {
  await page.goto("/teacher/library");
  await control(page, "Игры").click();
  await page.getByLabel("Тема").selectOption({ label: topic });
}

test("a game with two topics is found by each, shows both, and an edit changes them", async ({ page }) => {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: game("Lunch talk") });
  await page.getByLabel("Название").fill("Lunch talk");
  // «food» twice, in another case: kept once.
  await page.getByLabel("Тема").fill("Present Simple, food, Food");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();

  for (const topic of ["Present Simple", "food"]) {
    await filterByTopic(page, topic);
    await expect(materials(page).filter({ hasText: "Lunch talk" })).toHaveCount(1);
  }
  await expect(page.getByLabel("Тема").getByRole("option", { name: "Food", exact: true })).toHaveCount(0);

  await materials(page).filter({ hasText: "Lunch talk" }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lunch talk" })).toBeVisible();
  await expect(page.getByText("Present Simple", { exact: true })).toBeVisible();
  await expect(page.getByText("food", { exact: true })).toBeVisible();

  await control(page, "Изменить").click();
  await expect(page.getByLabel("Тема")).toHaveValue("Present Simple, food");
  await page.getByLabel("Тема").fill("food");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lunch talk" })).toBeVisible();
  await expect(page.getByText("Present Simple", { exact: true })).toHaveCount(0);

  await filterByTopic(page, "food");
  await expect(materials(page).filter({ hasText: "Lunch talk" })).toHaveCount(1);
  await page.goto("/teacher/library");
  await control(page, "Игры").click();
  await expect(page.getByLabel("Тема").getByRole("option", { name: "Present Simple", exact: true })).toHaveCount(0);
});
