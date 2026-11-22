// Acceptance for #267: a parent's report drafted on the card. «Новый отчёт»
// opens a draft for the period — the first one covers the last 30 days —
// with the numbers filled in: a skill's latest result in the period with its
// growth or slip against the one before, a skill without a result in the
// period left out. Four blocks are offered; the teacher fills some, removes
// one, adds her own; empty ones stay out. «Скопировать текст» gives the
// report as plain text with the parent's link; «Показать оплаты» adds the
// balance line to it. A draft is kept: «Новый отчёт» opens it again. The
// measure, words, homework, units and attendance in the numbers, and the
// next report's period, are pinned by integration tests.
//
// The teacher starts signed in (sessions.setup.ts). The student, the results
// and the texts are synthetic.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const DAY = 86_400_000;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A calendar date in Moscow, `days` from today, as YYYY-MM-DD. */
const moscow = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(Date.now() + days * DAY));

/** «Осталось 2 урока · 3 000 ₽», whatever the kind of space. */
const balance = (text: string) => new RegExp(text.replace(/[.$]/g, "\\$&").replace(/ /g, "\\s"));

async function copied(page: Page, name: string): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, name).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toBe("");
  return page.evaluate(() => navigator.clipboard.readText());
}

async function results(page: Page, date: string, percents: Record<string, number>) {
  const progress = page.getByRole("region", { name: "Прогресс" });
  await progress.getByRole("button", { name: "Внести результаты", exact: true }).click();
  const form = progress.getByRole("group", { name: "Результаты" });
  await form.getByLabel("Дата").fill(date);
  for (const [skill, percent] of Object.entries(percents)) await form.getByLabel(skill, { exact: true }).fill(String(percent));
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(form).toHaveCount(0);
}

test("a report draft gets the period's numbers and the teacher's blocks, and copies as text with the parent's link", async ({ page }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Отчётная");
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Отчётная" })).toBeVisible();
  const card = page.url();
  const parentLink = await copied(page, "Ссылка родителя");
  expect(parentLink).toMatch(/\/p#.+/);

  // Before the period: reading 60 and grammar 40. In it: reading 70 and listening 50.
  await results(page, moscow(-40), { Чтение: 60, Грамматика: 40 });
  await results(page, moscow(-10), { Чтение: 70, Аудирование: 50 });
  const payments = page.getByRole("region", { name: "Оплаты" });
  await payments.getByLabel("Формат оплаты").selectOption({ label: "Предоплата" });
  await payments.getByLabel("Цена урока").fill("1500");
  await payments.getByRole("button", { name: "Сохранить условия", exact: true }).click();
  await expect(payments.getByText("Условия сохранены")).toBeVisible();
  await control(page, "Добавить оплату").click();
  await payments.getByLabel("Сумма").fill("3000");
  await payments.getByRole("button", { name: "Сохранить оплату", exact: true }).click();
  await expect(payments).toContainText(balance("Осталось 2 урока · 3 000 ₽"));

  const reports = page.getByRole("region", { name: "Отчёты" });
  await expect(reports).toContainText("Отчётов пока нет");
  await reports.getByRole("button", { name: "Новый отчёт", exact: true }).click();
  const draft = reports.getByRole("group", { name: "Черновик отчёта" });
  const numbers = draft.getByRole("list", { name: "Цифры" });
  await expect(numbers).toContainText("Чтение 70% · рост +10");
  await expect(numbers).toContainText("Аудирование 50%");
  await expect(numbers).not.toContainText("Грамматика");

  // Four blocks offered: two filled, one removed, one of her own added.
  for (const title of ["Что получается", "Над чем работаем", "План", "Чем помочь дома"]) await expect(draft.getByLabel(title, { exact: true })).toBeVisible();
  await draft.getByLabel("Что получается", { exact: true }).fill("Рассказывает новости тремя фразами.");
  await draft.getByLabel("Над чем работаем", { exact: true }).fill("Прошедшее время в речи.");
  await draft.getByRole("button", { name: "Убрать раздел «План»", exact: true }).click();
  await expect(draft.getByLabel("План", { exact: true })).toHaveCount(0);
  await draft.getByRole("button", { name: "Добавить раздел", exact: true }).click();
  await draft.getByLabel("Название раздела", { exact: true }).fill("Олимпиада");
  await draft.getByLabel("Олимпиада", { exact: true }).fill("Готовимся к школьному туру.");
  await draft.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
  await expect(draft.getByRole("status")).toHaveText("Черновик сохранён");

  // The text: the numbers, the filled blocks, the parent's link; no empty block, no balance.
  let text = await copied(page, "Скопировать текст");
  for (const part of ["Чтение 70% · рост +10", "Что получается", "Рассказывает новости тремя фразами.", "Над чем работаем", "Олимпиада", "Готовимся к школьному туру.", parentLink]) {
    expect(text).toContain(part);
  }
  for (const absent of ["План", "Чем помочь дома", "Грамматика", "Осталось"]) expect(text).not.toContain(absent);

  // «Показать оплаты» adds the balance line to the text.
  await draft.getByLabel("Показать оплаты", { exact: true }).check();
  text = await copied(page, "Скопировать текст");
  expect(text).toMatch(balance("Осталось 2 урока · 3 000 ₽"));
  await draft.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
  await expect(draft.getByRole("status")).toHaveText("Черновик сохранён");

  // The draft is kept: the card lists it, and «Новый отчёт» opens it again.
  await page.goto(card);
  await expect(reports.getByRole("listitem")).toHaveCount(1);
  await expect(reports.getByRole("listitem").first()).toContainText("Черновик");
  await reports.getByRole("button", { name: "Новый отчёт", exact: true }).click();
  await expect(draft.getByLabel("Что получается", { exact: true })).toHaveValue("Рассказывает новости тремя фразами.");
  await expect(draft.getByLabel("Олимпиада", { exact: true })).toHaveValue("Готовимся к школьному туру.");
  await expect(draft.getByLabel("Показать оплаты", { exact: true })).toBeChecked();
});
