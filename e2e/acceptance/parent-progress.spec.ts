// Acceptance for #256: the dashboard on the parent's page. Behind their link
// the parent sees the child's skills by month with growth or slip, and the
// homework submitted, the units passed and the words — the same totals as
// «Прогресс» on the card (#255), without anything to change and without the
// details: no answers, recordings or notes (pinned by an integration test).
// Reports are still to come.
//
// The teacher starts signed in (sessions.setup.ts); the parent opens the
// link in a fresh browser without her cookies. The results are synthetic.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function enterResults(progress: Locator, date: string, results: Record<string, number>) {
  await progress.getByRole("button", { name: "Внести результаты", exact: true }).click();
  const form = progress.getByRole("group", { name: "Результаты" });
  await form.getByLabel("Дата").fill(date);
  for (const [skill, percent] of Object.entries(results)) await form.getByLabel(skill, { exact: true }).fill(String(percent));
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(form).toHaveCount(0);
}

test("the parent sees the skills by month and the totals, with nothing to change", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Показательная");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Показательная" })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка родителя").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/p#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  const progress = page.getByRole("region", { name: "Прогресс" });
  await enterResults(progress, "2026-10-15", { Чтение: 50, Говорение: 40 });
  await enterResults(progress, "2026-11-15", { Чтение: 70, Говорение: 35 });

  const parent = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await parent.goto(link);
  await expect.poll(() => parent.url()).not.toContain("#");
  await expect(parent.getByText("Успехи Показательная")).toBeVisible();

  const shown = parent.getByRole("region", { name: "Прогресс" });
  const skills = shown.getByRole("table", { name: "Навыки по месяцам" });
  const row = (skill: string) => skills.getByRole("row").filter({ has: parent.getByRole("rowheader", { name: skill, exact: true }) });
  await expect(skills.getByRole("columnheader", { name: "октябрь 2026" })).toBeVisible();
  await expect(row("Чтение")).toContainText("рост +20");
  await expect(row("Говорение")).toContainText("просадка −5");
  await expect(shown).toContainText("Домашек со сроком ещё не было");
  await expect(shown).toContainText("Слов: 0, закрепилось 0");

  // Nothing to change, and no list of what the teacher entered.
  await expect(parent.getByRole("button", { name: "Внести результаты" })).toHaveCount(0);
  await expect(parent.getByRole("button", { name: "Изменить" })).toHaveCount(0);
  await expect(parent.getByRole("list", { name: "Внесённые результаты" })).toHaveCount(0);
  // Reports come later.
  await expect(parent.getByText("Отчётов пока нет")).toBeVisible();
  await parent.context().close();
});
