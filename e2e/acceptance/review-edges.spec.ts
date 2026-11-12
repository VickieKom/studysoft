// Acceptance for #65: edges found in the reviews of #58 and #60, as the
// teacher sees them. A deadline before today is refused with a message, and
// «Ассистент» says that notes reach the assistant as written. Concurrent
// publishing and token creation cannot be timed from a page; integration
// tests cover them.
//
// The teacher starts signed in (sessions.setup.ts). Homework is synthetic.
import { expect, type Page, test } from "@playwright/test";
import short from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

test("a deadline before today is refused with a message, and the homework stays a draft", async ({ page }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Срок");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Срок" })).toBeVisible();
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(short));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();

  // Two days back is in the past in every time zone.
  const past = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Срок").fill(past);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Срок" }).filter({ hasText: "раньше" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();
  await expect(page.getByText("Опубликована", { exact: true })).toHaveCount(0);
});

test("«Ассистент» says that the assistant sees the notes as written", async ({ page }) => {
  await page.goto("/teacher/assistant");
  await expect(page.getByRole("heading", { level: 1, name: "Ассистент" })).toBeVisible();
  await expect(
    page.getByText("Ассистент видит последние заметки об ученике целиком, такими, как вы их написали."),
  ).toBeVisible();
});
