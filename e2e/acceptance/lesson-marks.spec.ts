// Acceptance for #82: the teacher marks a past lesson «Проведён» or
// «Пропущен», the student card keeps the lesson history, an unmarked past
// lesson asks to be marked, and none of it reaches the student, the parent or
// the assistant.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and every
// student's are Moscow here. A past lesson is added with «+ Урок» for
// yesterday. A lesson on the week is a button with the student's name; it
// opens the lesson in a dialog. Units and notes are synthetic.
//
// Helpers and labels follow e2e/acceptance/schedule-week.spec.ts (#80);
// the ones needed here are copied, that file is not touched.
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

/** A calendar date in Moscow, `days` from today. */
function moscowDate(days: number): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(Date.now() + days * DAY));
  return new Date(`${iso}T12:00:00Z`);
}

/** How the week names a day: «вторник, 17 ноября». */
const dayLabel = (date: Date) =>
  date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** A date without the weekday, as the history shows it: «17 ноября». */
const dayMonth = (date: Date) => date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

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

/**
 * Opens «Расписание» and moves to the week that shows this date: back for a
 * date before today, forward otherwise.
 */
async function openWeekWith(page: Page, date: Date): Promise<Locator> {
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  // The week is on screen before looking for the day in it.
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
  const step = date < moscowDate(0) ? "Предыдущая неделя" : "Следующая неделя";
  const day = page.getByRole("region", { name: dayLabel(date) });
  for (let i = 0; i < 6 && !(await day.isVisible()); i++) {
    const shown = await page.getByRole("region").first().getAttribute("aria-label");
    await page.getByRole("button", { name: step, exact: true }).click();
    // The other week has replaced this one before looking again.
    await expect(page.getByRole("region").first()).not.toHaveAttribute("aria-label", shown ?? "");
  }
  await expect(day).toBeVisible();
  return day;
}

function lessonOf(day: Locator, firstName: string) {
  return day.getByRole("button", { name: new RegExp(firstName) });
}

/** «+ Урок» on «Расписание» for yesterday at 10:00: a lesson that has already happened. */
async function addPastLesson(page: Page, firstName: string): Promise<Date> {
  const date = moscowDate(-1);
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(date));
  await page.getByLabel("Время").fill("10:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(lessonOf(await openWeekWith(page, date), firstName)).toHaveCount(1);
  return date;
}

/** Opens the student's lesson on that date: the dialog where it is marked, and the day it is on. */
async function openLesson(page: Page, date: Date, firstName: string): Promise<{ day: Locator; dialog: Locator }> {
  const day = await openWeekWith(page, date);
  await lessonOf(day, firstName).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return { day, dialog };
}

/** Marks a lesson; returns once the week shows the mark instead of «отметьте урок». */
async function mark(
  page: Page,
  date: Date,
  firstName: string,
  status: "Проведён" | "Пропущен",
  fields: { unit?: string; note?: string; charge?: boolean } = {},
) {
  const { day, dialog } = await openLesson(page, date, firstName);
  await dialog.getByLabel(status, { exact: true }).check();
  if (fields.unit !== undefined) await dialog.getByLabel("Юнит").fill(fields.unit);
  if (fields.note !== undefined) await dialog.getByLabel("Заметка").fill(fields.note);
  if (fields.charge !== undefined) await dialog.getByLabel("Списать").setChecked(fields.charge);
  await dialog.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
  // Saved before the scenario moves on: the lesson on the week carries its new status.
  await expect(lessonOf(day, firstName)).toContainText(status.toLowerCase());
  await expect(lessonOf(day, firstName)).not.toContainText("отметьте урок");
}

/** The lesson history on the open card, newest first. */
function history(page: Page) {
  return page.getByRole("region", { name: "История уроков" });
}

test.beforeEach(async ({ page }) => {
  await setTeacherTimeZone(page, "Москва");
});

test("a past lesson marked «Проведён» with a unit and a note appears in the student's history", async ({ page }) => {
  const card = await createStudent(page, "Проведённый");
  const date = await addPastLesson(page, "Проведённый");

  const { dialog } = await openLesson(page, date, "Проведённый");
  await dialog.getByLabel("Проведён", { exact: true }).check();
  // «Списать» is ticked by default for a held lesson.
  await expect(dialog.getByLabel("Списать")).toBeChecked();
  await page.keyboard.press("Escape");

  await mark(page, date, "Проведённый", "Проведён", { unit: "Юнит 4", note: "Синтетическая заметка об уроке" });

  await page.goto(card);
  const row = history(page).getByRole("listitem").first();
  await expect(row).toContainText(dayMonth(date));
  await expect(row).toContainText("проведён");
  await expect(row).toContainText("Юнит 4");
  await expect(row).toContainText("Синтетическая заметка об уроке");
});

test("«Пропущен» is charged by default and the teacher can untick it", async ({ page }) => {
  const card = await createStudent(page, "Пропустивший");
  const date = await addPastLesson(page, "Пропустивший");

  const { dialog } = await openLesson(page, date, "Пропустивший");
  await dialog.getByLabel("Пропущен", { exact: true }).check();
  await expect(dialog.getByLabel("Списать")).toBeChecked();
  await page.keyboard.press("Escape");

  await mark(page, date, "Пропустивший", "Пропущен");
  await page.goto(card);
  let row = history(page).getByRole("listitem").first();
  await expect(row).toContainText("пропущен");
  await expect(row).toContainText("списан");
  await expect(row).not.toContainText("не списан");

  await mark(page, date, "Пропустивший", "Пропущен", { charge: false });
  await page.goto(card);
  row = history(page).getByRole("listitem").first();
  await expect(row).toContainText("пропущен");
  await expect(row).toContainText("не списан");
});

test("a past lesson not yet marked asks for it on the week and on the card", async ({ page }) => {
  const card = await createStudent(page, "Неотмеченный");
  const date = await addPastLesson(page, "Неотмеченный");

  await expect(lessonOf(await openWeekWith(page, date), "Неотмеченный")).toContainText("отметьте урок");
  await page.goto(card);
  await expect(page.getByText("отметьте урок")).toBeVisible();

  await mark(page, date, "Неотмеченный", "Проведён");
  await page.goto(card);
  await expect(page.getByText("отметьте урок")).toHaveCount(0);
});

test("a lesson marked by mistake is changed, and the history shows the new status", async ({ page }) => {
  const card = await createStudent(page, "Исправленный");
  const date = await addPastLesson(page, "Исправленный");

  await mark(page, date, "Исправленный", "Пропущен");
  await mark(page, date, "Исправленный", "Проведён", { unit: "Юнит 5" });

  await page.goto(card);
  const rows = history(page).getByRole("listitem");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("проведён");
  await expect(rows.first()).not.toContainText("пропущен");
  await expect(rows.first()).toContainText("Юнит 5");
});

/** Copies a link from the open card. */
async function copyLink(page: Page, name: "Ссылка ученика" | "Ссылка родителя"): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, name).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Opens a link in a fresh browser without the teacher's cookies; returns every page text and response body it saw. */
async function seenThrough(browser: Browser, link: string, firstName: string): Promise<string> {
  const context = await browser.newContext({ storageState: NO_SESSION });
  const page = await context.newPage();
  const bodies: Promise<string>[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/")) bodies.push(response.text().catch(() => ""));
  });
  await page.goto(link);
  // The link has been exchanged for a session and the page names the student.
  await expect(page.getByText(firstName).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText(firstName).first()).toBeVisible();
  const seen = [await page.locator("body").innerText(), ...(await Promise.all(bodies))].join("\n");
  await context.close();
  return seen;
}

/** An agent procedure over HTTP with the assistant's token, as the MCP server calls it. */
async function agentCall(request: APIRequestContext, token: string, procedure: string, input?: unknown) {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await request.get(`/api/trpc/${procedure}${query}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  return response.text();
}

test("the history reaches neither the student, nor the parent, nor the assistant", async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const card = await createStudent(page, "Закрытая история");
  const studentId = card.split("/").pop()!;
  const date = await addPastLesson(page, "Закрытая история");
  const unit = "Юнит 731";
  const note = "Синтетическая заметка 731";
  await mark(page, date, "Закрытая история", "Проведён", { unit, note });

  await page.goto(card);
  await expect(history(page)).toContainText(note);
  const studentLink = await copyLink(page, "Ссылка ученика");
  const parentLink = await copyLink(page, "Ссылка родителя");

  for (const link of [studentLink, parentLink]) {
    const seen = await seenThrough(browser, link, "Закрытая история");
    expect(seen).not.toContain(note);
    expect(seen).not.toContain(unit);
    expect(seen).not.toContain("История уроков");
  }

  // The assistant: a token from «Ассистент», calls without the teacher's cookies.
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
    expect(answer).not.toContain(note);
    expect(answer).not.toContain(unit);
  }
  await assistant.dispose();
});
