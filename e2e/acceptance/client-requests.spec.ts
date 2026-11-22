// Acceptance for #337: «Привлечение клиентов», a section next to «Ученики»
// that keeps the requests of families who may become students. «Новая
// заявка» takes the child's first name and the source (required), the age,
// the school year and the parent's contact (optional), and the date, today
// by default. The requests show by stage: «Заявка», «Вводный записан»,
// «Вводный проведён», «Оффер отправлен», «Отказ»; the teacher moves one to
// any stage, forward or back, and «Отказ» asks for a reason and an optional
// comment; moving it out of «Отказ» clears them. «Стал учеником» comes with
// #340. «Удалить заявку» erases the request's name and contact; that an
// anonymous count of its stage, source and reason stays for the metrics is
// pinned by an integration test (product owner, 2026-11-23).
//
// The teacher starts signed in (sessions.setup.ts); her time zone is set to
// Moscow. The second teacher has her own session. Names and contacts are
// synthetic.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The requests made by one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

const STAGES = ["Заявка", "Вводный записан", "Вводный проведён", "Оффер отправлен", "Отказ"];

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Today in Moscow, as a date field holds it. */
function todayInMoscow(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** «Привлечение клиентов» from the teacher's menu. */
async function openSection(page: Page) {
  await page.goto("/teacher/students");
  await control(page, "Привлечение клиентов").click();
  await expect(page.getByRole("heading", { level: 1, name: "Привлечение клиентов" })).toBeVisible();
}

function stage(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

function request(page: Page, firstName: string): Locator {
  return page.getByRole("listitem").filter({ hasText: firstName });
}

/** Moves a request to a stage other than «Отказ». */
async function moveTo(page: Page, firstName: string, to: string) {
  await request(page, firstName).getByLabel("Этап").selectOption({ label: to });
  await expect(stage(page, to).getByRole("listitem").filter({ hasText: firstName })).toHaveCount(1);
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("the teacher adds a request from Avito: it shows under «Заявка», dated today", async ({ page }) => {
  await openSection(page);
  for (const name of STAGES) await expect(stage(page, name)).toBeVisible();
  await expect(stage(page, "Стал учеником")).toHaveCount(0);

  await control(page, "Новая заявка").click();
  await expect(page.getByLabel("Дата")).toHaveValue(todayInMoscow());
  // The first name and the source are required.
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.getByLabel("Имя ребёнка").fill("Заявкина");
  await page.getByLabel("Возраст").fill("9");
  await page.getByLabel("Класс").fill("3");
  await page.getByLabel("Контакт родителя").fill("+7 900 000-00-01");
  await page.getByLabel("Источник").selectOption({ label: "Авито" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();

  const added = stage(page, "Заявка").getByRole("listitem").filter({ hasText: "Заявкина" });
  await expect(added).toHaveCount(1);
  await expect(added).toContainText("Авито");
  await expect(added).toContainText("9");

  // A request with the name and the source only.
  await control(page, "Новая заявка").click();
  await page.getByLabel("Имя ребёнка").fill("Безконтактный");
  await page.getByLabel("Источник").selectOption({ label: "Профи.ру" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(stage(page, "Заявка").getByRole("listitem").filter({ hasText: "Безконтактный" })).toHaveCount(1);
});

test("a request moves to any stage and back; «Отказ» asks for a reason, kept with an optional comment", async ({ page }) => {
  await openSection(page);
  await moveTo(page, "Заявкина", "Оффер отправлен");
  await moveTo(page, "Заявкина", "Вводный записан");

  await request(page, "Заявкина").getByLabel("Этап").selectOption({ label: "Отказ" });
  const decline = page.getByRole("dialog", { name: "Отказ" });
  await expect(decline.getByLabel("Причина")).toBeVisible();
  for (const reason of ["Дорого", "Не подошло время", "Выбрали другого", "Не ответили", "Другое"]) {
    await expect(decline.getByLabel("Причина").locator("option", { hasText: reason })).toHaveCount(1);
  }
  await decline.getByLabel("Причина").selectOption({ label: "Дорого" });
  await decline.getByLabel("Комментарий").fill("Хотят дешевле, вернутся весной");
  await decline.getByRole("button", { name: "Сохранить", exact: true }).click();

  const declined = stage(page, "Отказ").getByRole("listitem").filter({ hasText: "Заявкина" });
  await expect(declined).toHaveCount(1);
  await expect(declined).toContainText("Дорого");
  await expect(declined).toContainText("Хотят дешевле, вернутся весной");
  await page.reload();
  await expect(stage(page, "Отказ").getByRole("listitem").filter({ hasText: "Заявкина" })).toContainText("Дорого");

  // Back out of «Отказ»: the reason and the comment are gone.
  await moveTo(page, "Заявкина", "Заявка");
  const back = stage(page, "Заявка").getByRole("listitem").filter({ hasText: "Заявкина" });
  await expect(back).not.toContainText("Дорого");
  await expect(back).not.toContainText("Хотят дешевле");
});

test("another teacher sees none of the requests", async ({ browser }) => {
  const other = await (await browser.newContext({ storageState: SECOND_TEACHER_SESSION })).newPage();
  await openSection(other);
  await expect(other.getByText("Заявкина")).toHaveCount(0);
  await expect(other.getByText("Безконтактный")).toHaveCount(0);
  await other.context().close();
});

test("«Удалить заявку» erases the request's name and contact", async ({ page }) => {
  await openSection(page);
  await request(page, "Заявкина").getByRole("button", { name: "Удалить заявку", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Удалить заявку?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByText("Заявкина")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Заявкина")).toHaveCount(0);
  await expect(page.getByText("+7 900 000-00-01")).toHaveCount(0);
  await expect(stage(page, "Заявка").getByRole("listitem").filter({ hasText: "Безконтактный" })).toHaveCount(1);
});
