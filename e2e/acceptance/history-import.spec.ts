// Acceptance for #38: the teacher uploads the results history from her old
// tool as a CSV in the platform's history import format. Each student, date
// and homework becomes one past submission, shown on the student card and in
// «Проверка домашек», never waiting for review. A second upload adds nothing;
// rows that cannot be imported are listed in a summary.
//
// The CSV is synthetic (deploy/seed/history/demo-history.csv): three rows of
// «Тестовый Т.» for «Demo 1» on 2026-11-03, a row for a student who does not
// exist (line 5) and a row with a date that does not exist (line 6). The
// student is matched by first name and the initial of the last name.
import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// Both scenarios upload the same file for the same student; the second
// uploads it twice, so it holds whether or not the first has run.
test.describe.configure({ mode: "serial" });

const CSV = readFileSync("deploy/seed/history/demo-history.csv");

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function ensureStudent(page: Page): Promise<string> {
  await page.goto("/teacher/students");
  const existing = page.getByRole("link", { name: /Тестовый Тестов/ });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await control(page, "Новый ученик").click();
    await page.getByLabel("Имя").fill("Тестовый");
    await page.getByLabel("Фамилия").fill("Тестов");
    await page.getByRole("button", { name: "Сохранить" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Тестовый" })).toBeVisible();
  return page.url();
}

async function upload(page: Page) {
  await page.goto("/teacher/students");
  await page
    .getByLabel("CSV с историей домашек")
    .setInputFiles({ name: "history.csv", mimeType: "text/csv", buffer: CSV });
  await page.getByRole("button", { name: "Загрузить историю", exact: true }).click();
  const summary = page.getByRole("status").filter({ hasText: "Загружено сдач" });
  await expect(summary).toBeVisible();
  return summary;
}

/** The number on «Проверка домашек» in the menu; none shown means 0. */
async function waitingCount(page: Page): Promise<number> {
  await page.goto("/teacher/students");
  const item = page.getByRole("link", { name: /Проверка домашек/ });
  const match = /(\d+)/.exec((await item.textContent()) ?? "");
  return match ? Number(match[1]) : 0;
}

test("the uploaded history becomes one past submission on the card and in «Проверка домашек», and bad rows are reported", async ({
  page,
}) => {
  const card = await ensureStudent(page);
  const waiting = await waitingCount(page);

  const summary = await upload(page);
  await expect(summary).toContainText("Загружено сдач: 1");
  await expect(summary).toContainText("Строка 5");
  await expect(summary).toContainText("Неизвестный Н.");
  await expect(summary).toContainText("Строка 6");
  await expect(summary).toContainText("дата");

  await page.goto(card);
  const past = page.getByRole("region", { name: "Прошлые сдачи" }).getByRole("listitem");
  await expect(past).toHaveCount(1);
  await expect(past.first()).toContainText("Demo 1");
  await expect(past.first()).toContainText("3 ноября");
  await expect(past.first()).toContainText("1 верно, 1 неверно");

  await past.first().getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Demo 1");
  const tasks = page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ hasText: /Pick the colour of the sky|I ___ a student|Write two sentences/ });
  await expect(tasks).toHaveCount(3);
  await expect(tasks.nth(0)).toContainText("Pick the colour of the sky");
  await expect(tasks.nth(0)).toContainText("Верно");
  await expect(tasks.nth(1)).toContainText("Неверно");
  await expect(tasks.nth(1)).toContainText("am");
  await expect(tasks.nth(2)).toContainText("I wake up at seven. I go to school.");
  await expect(tasks.nth(2)).toContainText("Не проверено");
  // A past submission is only for reading: nothing to mark or reopen.
  await expect(page.getByRole("button", { name: "Открыть заново для ученика" })).toHaveCount(0);

  await page.goto("/teacher/students");
  await page.getByRole("link", { name: /Проверка домашек/ }).click();
  await page.getByLabel("Ученик").selectOption({ label: "Тестовый Тестов" });
  const rows = page.getByRole("listitem").filter({ hasText: "Demo 1" });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("1 верно, 1 неверно");
  await expect(rows.first()).toContainText("импорт");
  await expect(rows.first()).not.toContainText("ждёт проверки");
  expect(await waitingCount(page)).toBe(waiting);
});

test("uploading the same file again adds nothing", async ({ page }) => {
  const card = await ensureStudent(page);
  await upload(page);
  const summary = await upload(page);
  await expect(summary).toContainText("Загружено сдач: 0");
  await expect(summary).toContainText("Уже были: 1");

  await page.goto(card);
  await expect(page.getByRole("region", { name: "Прошлые сдачи" }).getByRole("listitem")).toHaveCount(1);
});
