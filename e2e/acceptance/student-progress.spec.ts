// Acceptance for #255: «Прогресс» on the student card. Until the monthly
// assessment's format is decided (product owner, 2026-11-20), the teacher
// enters the results of an assessment by hand: a date and a percent per
// skill, a skill left out when it was not assessed. «Навыки по месяцам»
// shows each assessed skill by month, the latest result of a month as its
// point, with growth or slip against the point before. Results are corrected
// and deleted. The homework percent, the units passed and the words, and
// the student never getting the results, are integration tests.
//
// The teacher starts signed in (sessions.setup.ts). The results are synthetic.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** Fills the results form: the date, and a percent for each skill given. */
async function fillResults(form: Locator, date: string, results: Record<string, number | "">) {
  await form.getByLabel("Дата").fill(date);
  for (const [skill, percent] of Object.entries(results)) await form.getByLabel(skill, { exact: true }).fill(String(percent));
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
}

test("results entered by hand show each skill by month with growth or slip, and are corrected and deleted", async ({ page }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Растущий");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Растущий" })).toBeVisible();

  const progress = page.getByRole("region", { name: "Прогресс" });
  await expect(progress).toContainText("Результатов по навыкам пока нет");

  // October: reading and listening. November: reading, listening and grammar; writing never assessed.
  await progress.getByRole("button", { name: "Внести результаты", exact: true }).click();
  await fillResults(progress.getByRole("group", { name: "Результаты" }), "2026-10-15", { Чтение: 50, Аудирование: 60 });
  await progress.getByRole("button", { name: "Внести результаты", exact: true }).click();
  await fillResults(progress.getByRole("group", { name: "Результаты" }), "2026-11-15", { Чтение: 70, Аудирование: 55, Грамматика: 80 });

  const skills = progress.getByRole("table", { name: "Навыки по месяцам" });
  const row = (skill: string) => skills.getByRole("row").filter({ has: page.getByRole("rowheader", { name: skill, exact: true }) });
  await expect(skills.getByRole("columnheader", { name: "октябрь 2026" })).toBeVisible();
  await expect(skills.getByRole("columnheader", { name: "ноябрь 2026" })).toBeVisible();
  await expect(row("Чтение")).toContainText("50%");
  await expect(row("Чтение")).toContainText("70%");
  await expect(row("Чтение")).toContainText("рост +20");
  await expect(row("Аудирование")).toContainText("просадка −5");
  await expect(row("Грамматика")).toContainText("80%");
  await expect(row("Грамматика")).not.toContainText(/рост|просадка/);
  await expect(row("Письмо")).toHaveCount(0);
  await page.reload();
  await expect(row("Чтение")).toContainText("рост +20");

  // Corrected: November's reading was 40.
  const entered = progress.getByRole("list", { name: "Внесённые результаты" });
  const november = entered.getByRole("listitem").filter({ hasText: "15 ноября 2026" });
  await november.getByRole("button", { name: "Изменить", exact: true }).click();
  const form = november.getByRole("group", { name: "Результаты" });
  await expect(form.getByLabel("Грамматика", { exact: true })).toHaveValue("80");
  await form.getByLabel("Чтение", { exact: true }).fill("40");
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(row("Чтение")).toContainText("просадка −10");

  // Deleted: October goes, and with it the trend.
  await entered.getByRole("listitem").filter({ hasText: "15 октября 2026" }).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(skills.getByRole("columnheader", { name: "октябрь 2026" })).toHaveCount(0);
  await expect(row("Чтение")).toContainText("40%");
  await expect(row("Чтение")).not.toContainText(/рост|просадка/);
  await page.reload();
  await expect(entered.getByRole("listitem")).toHaveCount(1);
});
