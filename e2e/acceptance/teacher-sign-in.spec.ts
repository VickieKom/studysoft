// Acceptance for #17: the local stand is up and the teacher signs in.
//
// The teacher accounts are synthetic and come from deploy/seed/teachers.json;
// the first one is the account the teacher uses on the local stand.
import { expect, test } from "@playwright/test";
import teachers from "../../deploy/seed/teachers.json" with { type: "json" };

const teacher = teachers[0];

// A redirect may carry a return address in the query string; the path is
// what the scenario pins.
const SIGN_IN_URL = /\/sign-in(\?.*)?$/;
const STUDENTS_URL = /\/teacher\/students(\?.*)?$/;
const WRONG_CREDENTIALS = "Неверная почта или пароль";

test("the health check reports the database and the build", async ({ request }) => {
  const response = await request.get("/api/healthz");

  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.database).toBe("ok");
  // A commit SHA, not a constant. Whether it is the expected commit is the
  // staging smoke check's job (#4).
  expect(body.build).toMatch(/^[0-9a-f]{7,40}$/);
});

test("the teacher signs in and sees an empty student list", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Электронная почта").fill(teacher.email);
  await page.getByLabel("Пароль").fill(teacher.password);
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page).toHaveURL(STUDENTS_URL);
  await expect(page.getByRole("heading", { level: 1, name: "Ученики" })).toBeVisible();
  await expect(page.getByText("Пока нет учеников")).toBeVisible();
  // A button now; it may become a link to the form in #18.
  await expect(
    page.getByRole("link", { name: "Новый ученик" }).or(page.getByRole("button", { name: "Новый ученик" })),
  ).toBeVisible();
});

test("a wrong password shows an error and does not sign the teacher in", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Электронная почта").fill(teacher.email);
  await page.getByLabel("Пароль").fill("not-the-password");
  await page.getByRole("button", { name: "Войти" }).click();

  // Next.js keeps its own empty "alert" region for route announcements, so
  // the error is found by its text among the alerts.
  await expect(page.getByRole("alert").filter({ hasText: WRONG_CREDENTIALS })).toBeVisible();
  await expect(page).toHaveURL(SIGN_IN_URL);

  await page.goto("/teacher/students");
  await expect(page).toHaveURL(SIGN_IN_URL);
});

test("without a session the workspace redirects to sign-in", async ({ page }) => {
  await page.goto("/teacher/students");

  await expect(page).toHaveURL(SIGN_IN_URL);
  await expect(page.getByRole("button", { name: "Войти" })).toBeVisible();
});

test("an unknown email gets the same error as a wrong password", async ({ page }) => {
  // The form must not reveal which addresses have an account.
  await page.goto("/sign-in");
  await page.getByLabel("Электронная почта").fill("nobody@example.test");
  await page.getByLabel("Пароль").fill("not-the-password");
  await page.getByRole("button", { name: "Войти" }).click();

  await expect(page.getByRole("alert").filter({ hasText: WRONG_CREDENTIALS })).toBeVisible();
  await expect(page).toHaveURL(SIGN_IN_URL);
});
