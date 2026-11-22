// Acceptance for #280: «Открыть» on another report while the one on screen
// has unsaved edits says they are not saved; the teacher stays on the
// report with her edits, or opens the other one anyway. With nothing
// changed since the last save, «Открыть» opens the other report at once.
//
// The teacher starts signed in (sessions.setup.ts). The texts are synthetic.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

test("unsaved edits are not dropped by «Открыть» without a word; saved, another report opens at once", async ({ page }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Несохранённая");
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Несохранённая" })).toBeVisible();

  // One report published, a second one drafted with an edit not yet saved.
  const reports = page.getByRole("region", { name: "Отчёты" });
  await reports.getByRole("button", { name: "Новый отчёт", exact: true }).click();
  let draft = reports.getByRole("group", { name: "Черновик отчёта" });
  await draft.getByLabel("Что получается", { exact: true }).fill("Первый отчёт.");
  await draft.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(reports.getByRole("listitem").filter({ hasText: "Опубликован" })).toHaveCount(1);
  await reports.getByRole("button", { name: "Новый отчёт", exact: true }).click();
  draft = reports.getByRole("group", { name: "Черновик отчёта" });
  await draft.getByLabel("Что получается", { exact: true }).fill("Ещё не сохранено.");

  const published = reports.getByRole("listitem").filter({ hasText: "Опубликован" });
  await published.getByRole("button", { name: "Открыть", exact: true }).click();
  const warning = reports.getByRole("alertdialog", { name: "Изменения не сохранены" });
  await expect(warning).toBeVisible();
  // «Остаться»: the draft and its edit are still on screen.
  await warning.getByRole("button", { name: "Остаться", exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(draft.getByLabel("Что получается", { exact: true })).toHaveValue("Ещё не сохранено.");

  // «Открыть без сохранения»: the other report opens, the edit is gone.
  await published.getByRole("button", { name: "Открыть", exact: true }).click();
  await reports.getByRole("alertdialog", { name: "Изменения не сохранены" }).getByRole("button", { name: "Открыть без сохранения", exact: true }).click();
  const opened = reports.getByRole("group", { name: "Опубликованный отчёт" });
  await expect(opened.getByLabel("Что получается", { exact: true })).toHaveValue("Первый отчёт.");

  // Nothing changed since: the draft opens at once.
  await reports.getByRole("listitem").filter({ hasText: "Черновик" }).getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(reports.getByRole("alertdialog")).toHaveCount(0);
  await expect(reports.getByRole("group", { name: "Черновик отчёта" }).getByLabel("Что получается", { exact: true })).toHaveValue("");
});
