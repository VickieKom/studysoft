// Acceptance for #83: the lesson price, the payment format, payments and the
// balance on the student card. The balance counts itself from payments and
// charged lessons (held, missed or late-cancelled with «Списать»).
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and every
// student's are Moscow here. Past lessons are added with «+ Урок» and marked
// as in lesson-marks.spec.ts (#82); the helpers needed here are copied. Money
// is shown the Russian way, «6 000 ₽», with a non-breaking space. A balance
// is shown for prepaid students; a postpaid one shows only a debt; a free one
// shows neither (product owner, 2026-11-13).
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The teacher's time zone and the assistant's token are shared with other scenario files.
test.describe.configure({ mode: "serial" });

const NO_SESSION = { cookies: [], origins: [] };
const DAY = 86_400_000;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

function moscowDate(days: number): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(Date.now() + days * DAY));
  return new Date(`${iso}T12:00:00Z`);
}

const dayLabel = (date: Date) =>
  date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
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

async function openWeekWith(page: Page, date: Date): Promise<Locator> {
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
  const step = date < moscowDate(0) ? "Предыдущая неделя" : "Следующая неделя";
  const day = page.getByRole("region", { name: dayLabel(date) });
  for (let i = 0; i < 6 && !(await day.isVisible()); i++) {
    const shown = await page.getByRole("region").first().getAttribute("aria-label");
    await page.getByRole("button", { name: step, exact: true }).click();
    await expect(page.getByRole("region").first()).not.toHaveAttribute("aria-label", shown ?? "");
  }
  await expect(day).toBeVisible();
  return day;
}

const lessonOf = (day: Locator, firstName: string) => day.getByRole("button", { name: new RegExp(firstName) });

/** «+ Урок» for a past date at this time; returns once it is on the week. */
async function addPastLesson(page: Page, firstName: string, days: number, time = "10:00"): Promise<Date> {
  const date = moscowDate(days);
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(date));
  await page.getByLabel("Время").fill(time);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
  await expect(lessonOf(await openWeekWith(page, date), firstName).first()).toBeVisible();
  return date;
}

/** Marks the student's lesson on that date «Проведён», charged or not. */
async function markHeld(page: Page, date: Date, firstName: string, charged = true) {
  const day = await openWeekWith(page, date);
  await lessonOf(day, firstName).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Проведён", { exact: true }).check();
  const charge = dialog.getByLabel("Списать");
  if (await charge.count()) await charge.setChecked(charged);
  await dialog.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
  await expect(lessonOf(day, firstName).first()).toContainText("проведён");
}

/** The «Оплаты» block of the open card. */
const payments = (page: Page) => page.getByRole("region", { name: "Оплаты" });

/** Sets the payment format and the price on the open card, from a date (today by default). */
async function setTerms(page: Page, format: string, price?: string, currency?: string, from?: Date) {
  const block = payments(page);
  await block.getByLabel("Формат оплаты").selectOption({ label: format });
  if (price !== undefined) await block.getByLabel("Цена урока").fill(price);
  if (currency !== undefined) await block.getByLabel("Валюта").selectOption({ label: currency });
  if (from !== undefined) await block.getByLabel("С даты").fill(isoDate(from));
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

/**
 * «Осталось 4 урока · 6 000 ₽», whatever the kind of space: Russian numbers
 * and the currency sign take non-breaking ones.
 */
const balance = (text: string) => new RegExp(text.replace(/[.$]/g, "\\$&").replace(/ /g, "\\s"));

test.beforeEach(async ({ page }) => {
  await setTeacherTimeZone(page, "Москва");
});

test("prepaid: a payment gives lessons ahead, a held lesson takes one, «Списать» off gives it back", async ({ page }) => {
  const card = await createStudent(page, "Предоплата");
  await setTerms(page, "Предоплата", "1500", "₽");
  await addPayment(page, "6000", "Перевод");
  await expect(payments(page)).toContainText(balance("Осталось 4 урока · 6 000 ₽"));
  await expect(payments(page)).toContainText("Перевод");

  const date = await addPastLesson(page, "Предоплата", -1);
  await markHeld(page, date, "Предоплата");
  await page.goto(card);
  await expect(payments(page)).toContainText(balance("Осталось 3 урока · 4 500 ₽"));

  await markHeld(page, date, "Предоплата", false);
  await page.goto(card);
  await expect(payments(page)).toContainText(balance("Осталось 4 урока · 6 000 ₽"));
});

test("with one prepaid lesson left the card warns", async ({ page }) => {
  const card = await createStudent(page, "Последний урок");
  await setTerms(page, "Предоплата", "1000", "₽");
  await addPayment(page, "2000");
  await expect(payments(page)).not.toContainText("Оплаченные уроки заканчиваются");

  await markHeld(page, await addPastLesson(page, "Последний урок", -1), "Последний урок");
  await page.goto(card);
  await expect(payments(page)).toContainText(balance("Осталось 1 урок · 1 000 ₽"));
  await expect(payments(page)).toContainText("Оплаченные уроки заканчиваются");
});

test("a new price applies from its date; earlier lessons keep their price", async ({ page }) => {
  const card = await createStudent(page, "Новая цена");
  // The old price has been in force for a week; the new one starts today.
  await setTerms(page, "Предоплата", "1500", "₽", moscowDate(-7));
  await addPayment(page, "6000");
  const yesterday = await addPastLesson(page, "Новая цена", -1);
  await markHeld(page, yesterday, "Новая цена");

  await page.goto(card);
  await setTerms(page, "Предоплата", "2000", "₽", moscowDate(0));
  // Today just after midnight in Moscow: already started whenever this runs.
  const today = await addPastLesson(page, "Новая цена", 0, "00:01");
  await markHeld(page, today, "Новая цена");

  await page.goto(card);
  // 6 000 − 1 500 − 2 000 = 2 500 ₽: one whole lesson at the new price.
  await expect(payments(page)).toContainText(balance("Осталось 1 урок · 2 500 ₽"));
});

test("postpaid: held lessons without a payment are a debt, in dollars here", async ({ page }) => {
  const card = await createStudent(page, "Постоплата");
  await setTerms(page, "Постоплата", "30", "$");
  for (const days of [-2, -1]) await markHeld(page, await addPastLesson(page, "Постоплата", days), "Постоплата");
  await page.goto(card);
  await expect(payments(page)).toContainText(balance("Долг 2 урока · 60 $"));

  // Paid in full: no debt, and no balance either — a balance is for prepaid
  // students only (product owner, 2026-11-13).
  await addPayment(page, "60");
  await expect(payments(page)).not.toContainText("Долг");
  await expect(payments(page)).not.toContainText("Осталось");
});

test("a free student has no balance or payments, and a held lesson charges nothing", async ({ page }) => {
  const card = await createStudent(page, "Бесплатный");
  await setTerms(page, "Бесплатно");
  await expect(control(page, "Добавить оплату")).toHaveCount(0);
  await expect(payments(page)).not.toContainText("Осталось");
  await expect(payments(page)).not.toContainText("Долг");

  await markHeld(page, await addPastLesson(page, "Бесплатный", -1), "Бесплатный");
  await page.goto(card);
  await expect(payments(page)).not.toContainText("Долг");
  await expect(payments(page).getByLabel("Формат оплаты").locator("option:checked")).toHaveText("Бесплатно");
});

async function copyLink(page: Page, name: "Ссылка ученика" | "Ссылка родителя"): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, name).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Every page text and response body a fresh browser saw through a link. */
async function seenThrough(browser: Browser, link: string, firstName: string): Promise<string> {
  const context = await browser.newContext({ storageState: NO_SESSION });
  const page = await context.newPage();
  const bodies: Promise<string>[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/")) bodies.push(response.text().catch(() => ""));
  });
  await page.goto(link);
  await expect(page.getByText(firstName).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(firstName).first()).toBeVisible();
  const seen = [await page.locator("body").innerText(), ...(await Promise.all(bodies))].join("\n");
  await context.close();
  return seen;
}

async function agentCall(request: APIRequestContext, token: string, procedure: string, input?: unknown) {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await request.get(`/api/trpc/${procedure}${query}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  return response.text();
}

test("payments, prices and the balance reach neither the student, nor the parent, nor the assistant", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const card = await createStudent(page, "Закрытые оплаты");
  const studentId = card.split("/").pop()!;
  await setTerms(page, "Предоплата", "1731", "₽");
  await addPayment(page, "7731", "Синтетический комментарий 731");
  await expect(payments(page)).toContainText("Синтетический комментарий 731");

  for (const link of [await copyLink(page, "Ссылка ученика"), await copyLink(page, "Ссылка родителя")]) {
    const seen = await seenThrough(browser, link, "Закрытые оплаты");
    for (const hidden of ["1731", "1 731", "7731", "7 731", "Синтетический комментарий 731", "Оплаты"]) {
      expect(seen).not.toContain(hidden);
    }
  }

  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const tokenField = page.getByLabel("Токен ассистента");
  await expect(tokenField).not.toHaveValue("");
  const token = await tokenField.inputValue();
  const assistant = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
  for (const answer of [
    await agentCall(assistant, token, "agent.listStudents"),
    await agentCall(assistant, token, "agent.studentContext", { studentId }),
  ]) {
    for (const hidden of ["1731", "7731", "Синтетический комментарий 731"]) expect(answer).not.toContain(hidden);
  }
  await assistant.dispose();
});
