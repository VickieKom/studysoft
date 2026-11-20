// Acceptance for #241: sections behind the student's link (product owner,
// 2026-11-20). The menu «Разделы» has «Материалы урока» — the games and
// videos the teacher opened in a lesson — and «Домашка»; the link opens
// «Домашка», as before. With nothing open, «Материалы урока» says so. A game
// opened in a lesson marking the menu item, and leaving the homework page, is
// in library-student-games.spec.ts.
//
// The teacher starts signed in (sessions.setup.ts); the student opens the
// link in a fresh browser without her cookies.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

test("the student's link opens «Домашка», and «Материалы урока» says there is nothing from the lesson yet", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Разделяемый");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Разделяемый" })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");

  // «Домашка» first, with the menu.
  await expect(student.getByText("Домашних заданий пока нет")).toBeVisible();
  const menu = student.getByRole("navigation", { name: "Разделы" });
  await expect(menu.getByRole("link", { name: /^Материалы урока/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Домашка", exact: true })).toHaveAttribute("aria-current", "page");
  // Nothing open in a lesson: no mark.
  await expect(menu.getByLabel("Открыто на уроке")).toHaveCount(0);

  await menu.getByRole("link", { name: /^Материалы урока/ }).click();
  await expect(student.getByRole("heading", { level: 1, name: "Материалы урока" })).toBeVisible();
  await expect(student.getByText("С урока пока ничего нет")).toBeVisible();
  await expect(menu.getByRole("link", { name: /^Материалы урока/ })).toHaveAttribute("aria-current", "page");

  // And back.
  await menu.getByRole("link", { name: "Домашка", exact: true }).click();
  await expect(student.getByText("Домашних заданий пока нет")).toBeVisible();
  await student.context().close();
});
