// Acceptance for #292: a game is marked in the library form for one or more
// of the teacher's students, and stays in the library for everyone.
// «Библиотека» filters by «Ученик»; the material's page names the students;
// an edit changes them. An archived or deleted student, another teacher's
// student, the assistant's drafts and the student context are pinned by
// integration tests.
//
// The teacher starts signed in (sessions.setup.ts). The students and the
// games are synthetic, made here.
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

async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
}

async function filterByStudent(page: Page, firstName: string) {
  await page.goto("/teacher/library");
  await control(page, "Игры").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
}

test("a game made for two students is found by each, names them, and an edit changes them", async ({ page }) => {
  for (const name of ["Даша-игры", "Маша-игры", "Саша-игры"]) await createStudent(page, name);

  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: game("Gap practice") });
  await page.getByLabel("Название").fill("Gap practice");
  const forStudents = page.getByRole("group", { name: "Для учеников" });
  await forStudents.getByRole("checkbox", { name: "Даша-игры", exact: true }).check();
  await forStudents.getByRole("checkbox", { name: "Маша-игры", exact: true }).check();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();

  // Still in the library for everyone, and found by each of its students, not by a third.
  await page.goto("/teacher/library");
  await control(page, "Игры").click();
  await expect(materials(page).filter({ hasText: "Gap practice" })).toHaveCount(1);
  for (const name of ["Даша-игры", "Маша-игры"]) {
    await filterByStudent(page, name);
    await expect(materials(page).filter({ hasText: "Gap practice" })).toHaveCount(1);
  }
  await filterByStudent(page, "Саша-игры");
  await expect(materials(page).filter({ hasText: "Gap practice" })).toHaveCount(0);

  await filterByStudent(page, "Даша-игры");
  await materials(page).filter({ hasText: "Gap practice" }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByText("Для учеников: Даша-игры, Маша-игры")).toBeVisible();

  await control(page, "Изменить").click();
  await page.getByRole("group", { name: "Для учеников" }).getByRole("checkbox", { name: "Даша-игры", exact: true }).uncheck();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Gap practice" })).toBeVisible();
  await expect(page.getByText("Для учеников: Маша-игры")).toBeVisible();
  await filterByStudent(page, "Даша-игры");
  await expect(materials(page).filter({ hasText: "Gap practice" })).toHaveCount(0);
});
