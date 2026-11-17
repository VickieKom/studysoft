// Acceptance for #101: a payment entered by mistake can be corrected or
// removed from the card, and the balance follows. «Изменить» changes the
// amount, the date and the comment — the fields of «Добавить оплату»;
// «Удалить» asks «Удалить оплату?» first. No visible history of changes
// (product owner, 2026-11-17).
//
// The teacher starts signed in (sessions.setup.ts). Helpers and the money
// format follow e2e/acceptance/payments.spec.ts (#83); that file is not
// touched. Money is shown the Russian way, «6 000 ₽», with a non-breaking space.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url();
}

/** The «Оплаты» block of the open card. */
const payments = (page: Page) => page.getByRole("region", { name: "Оплаты" });

/** The payments listed in the block. */
const listed = (page: Page): Locator => payments(page).getByRole("list", { name: "Оплаты ученика" }).getByRole("listitem");

/** «6 000 ₽» or «Осталось 4 урока», whatever the kind of space. */
const text = (value: string) => new RegExp(value.replace(/[.$]/g, "\\$&").replace(/ /g, "\\s"));

async function setPrepaid(page: Page, price: string) {
  const block = payments(page);
  await block.getByLabel("Формат оплаты").selectOption({ label: "Предоплата" });
  await block.getByLabel("Цена урока").fill(price);
  await block.getByLabel("Валюта").selectOption({ label: "₽" });
  await block.getByRole("button", { name: "Сохранить условия", exact: true }).click();
  await expect(block.getByText("Условия сохранены")).toBeVisible();
}

async function addPayment(page: Page, amount: string, comment = "") {
  const block = payments(page);
  await control(page, "Добавить оплату").click();
  await block.getByLabel("Сумма").fill(amount);
  if (comment) await block.getByLabel("Комментарий").fill(comment);
  await block.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
  await expect(control(page, "Добавить оплату")).toBeVisible();
}

test("a mistaken amount is corrected from the card, with its date and comment, and the balance follows", async ({ page }) => {
  await createStudent(page, "Опечатка");
  await setPrepaid(page, "1500");
  await addPayment(page, "60000", "за месяц");
  await expect(payments(page)).toContainText(text("Осталось 40 уроков"));

  const mistaken = listed(page).filter({ hasText: text("60 000 ₽") });
  await expect(mistaken).toHaveCount(1);
  await mistaken.getByRole("button", { name: "Изменить", exact: true }).click();
  const block = payments(page);
  await expect(block.getByLabel("Сумма")).toHaveValue("60000");
  await expect(block.getByLabel("Комментарий")).toHaveValue("за месяц");
  await block.getByLabel("Сумма").fill("6000");
  await block.getByLabel("Комментарий").fill("за 4 урока");
  await block.getByRole("button", { name: "Сохранить оплату", exact: true }).click();

  await expect(payments(page)).toContainText(text("Осталось 4 урока · 6 000 ₽"));
  await expect(listed(page)).toHaveCount(1);
  await expect(listed(page).first()).toContainText(text("6 000 ₽"));
  await expect(listed(page).first()).toContainText("за 4 урока");
  await expect(listed(page).first()).not.toContainText("60 000");

  // A refused amount leaves the payment as it was.
  await listed(page).first().getByRole("button", { name: "Изменить", exact: true }).click();
  await block.getByLabel("Сумма").fill("0");
  await block.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
  await expect(block.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(payments(page)).toContainText(text("Осталось 4 урока · 6 000 ₽"));
});

test("a duplicate payment is deleted after «Удалить оплату?», and cancelling changes nothing", async ({ page }) => {
  await createStudent(page, "Дубль");
  await setPrepaid(page, "1500");
  await addPayment(page, "6000");
  await addPayment(page, "6000");
  await expect(payments(page)).toContainText(text("Осталось 8 уроков"));
  await expect(listed(page)).toHaveCount(2);

  await listed(page).first().getByRole("button", { name: "Удалить", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Удалить оплату?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(ask).toBeHidden();
  await page.reload();
  await expect(listed(page)).toHaveCount(2);
  await expect(payments(page)).toContainText(text("Осталось 8 уроков"));

  await listed(page).first().getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("dialog", { name: "Удалить оплату?" }).getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(listed(page)).toHaveCount(1);
  await expect(payments(page)).toContainText(text("Осталось 4 урока · 6 000 ₽"));
  await page.reload();
  await expect(listed(page)).toHaveCount(1);
});
