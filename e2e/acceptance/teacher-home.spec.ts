// Acceptance for #257: the teacher's general screen, «Главная», where she
// lands after signing in. «Ближайшие уроки» lists the lessons ahead; «Требует
// внимания» names a student whose skill fell by 10 points or more since the
// result before (a smaller fall is not news); «Ученики» has a row per
// student with their numbers. A homework not submitted and prepaid lessons
// running out are pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts). The students and results
// are synthetic.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

const DAY = 86_400_000;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** A new student with two results for reading on the card, October and November. */
async function studentWithReading(page: Page, firstName: string, october: number, november: number) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const progress = page.getByRole("region", { name: "Прогресс" });
  for (const [date, percent] of [["2026-10-15", october], ["2026-11-15", november]] as const) {
    await progress.getByRole("button", { name: "Внести результаты", exact: true }).click();
    const form = progress.getByRole("group", { name: "Результаты" });
    await form.getByLabel("Дата").fill(date);
    await form.getByLabel("Чтение", { exact: true }).fill(String(percent));
    await form.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(form).toHaveCount(0);
  }
}

test("«Главная» lists the lessons ahead, a student whose skill fell, and every student with their numbers", async ({ page }) => {
  await studentWithReading(page, "Провальная", 70, 50);
  await studentWithReading(page, "Ровная", 60, 55);
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: "Провальная" });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + DAY)));
  await page.getByLabel("Время", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();

  await page.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Главная", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Главная" })).toBeVisible();

  const upcoming = page.getByRole("region", { name: "Ближайшие уроки" });
  await expect(upcoming.getByRole("listitem").filter({ hasText: "Провальная" })).toContainText("10:00");

  // A fall of 20 needs attention; a fall of 5 does not.
  const attention = page.getByRole("region", { name: "Требует внимания" });
  await expect(attention.getByRole("listitem").filter({ hasText: "Провальная" })).toContainText("Чтение: просадка −20");
  await expect(attention.getByRole("listitem").filter({ hasText: "Ровная" })).toHaveCount(0);

  const students = page.getByRole("table", { name: "Ученики" });
  const row = (name: string) => students.getByRole("row").filter({ has: page.getByRole("rowheader", { name }) });
  await expect(row("Провальная")).toContainText("Чтение просадка −20");
  await expect(row("Ровная")).toContainText("Чтение просадка −5");
  // A student's name opens their card.
  await row("Ровная").getByRole("link", { name: "Ровная" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ровная" })).toBeVisible();
});
