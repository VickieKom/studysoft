// Acceptance for #17: the local stand is up and the teacher signs in.
//
// The teacher accounts are synthetic and come from deploy/seed/teachers.json;
// the first one is the account the teacher uses on the local stand.
import { expect, test } from "@playwright/test";
import teachers from "../../deploy/seed/teachers.json" with { type: "json" };

const teacher = teachers[0];

test("the health check reports the database and the build", async ({ request }) => {
  const response = await request.get("/api/healthz");

  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.database).toBe("ok");
  expect(typeof body.build).toBe("string");
  expect(body.build.length).toBeGreaterThan(0);
});

test("the teacher signs in and sees an empty student list", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Электронная почта").fill(teacher.email);
  await page.getByLabel("Пароль").fill(teacher.password);
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(/\/teacher\/students$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ученики" })).toBeVisible();
  await expect(page.getByText("Пока нет учеников")).toBeVisible();
  await expect(page.getByRole("button", { name: "Новый ученик" })).toBeVisible();
});

test("a wrong password shows an error and does not sign the teacher in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Электронная почта").fill(teacher.email);
  await page.getByLabel("Пароль").fill("not-the-password");
  await page.getByRole("button", { name: "Войти" }).click();

  // Next.js keeps its own empty "alert" region for route announcements, so
  // the error is found by its text among the alerts.
  await expect(page.getByRole("alert").filter({ hasText: "Неверная почта или пароль" })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.goto("/teacher/students");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("without a session the workspace redirects to sign-in", async ({ page }) => {
  await page.goto("/teacher/students");

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
});
