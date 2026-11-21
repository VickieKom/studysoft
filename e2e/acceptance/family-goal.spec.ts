// Acceptance for #266: the family's goal and a personal measure. On the
// student card the teacher sets the goal and a measure of her own — a name
// and a unit; marking a lesson «Проведён» then asks for an optional number,
// and the card shows the measure over the last 30 days as first → last. A
// student without a measure gets no number when a lesson is marked. That
// no student, parent or agent procedure returns any of it is pinned by an
// integration test.
//
// The teacher starts signed in (sessions.setup.ts); the student's time zone
// is Moscow. Past lessons are added with «+ Урок» as in
// e2e/acceptance/lesson-marks.spec.ts (#82), whose helpers needed here are
// copied, that file is not touched. The goal and the numbers are synthetic.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

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

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

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

/** «+ Урок» on «Расписание» `daysAgo` days back at 10:00: a lesson that has already happened. */
async function addPastLesson(page: Page, firstName: string, daysAgo: number): Promise<Date> {
  const date = moscowDate(-daysAgo);
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(date));
  await page.getByLabel("Время", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  // Saved before the scenario moves on: the form has closed and «+ Урок» is back.
  await expect(control(page, "+ Урок")).toBeVisible();
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
  measure?: { label: string; value: string },
) {
  const { day, dialog } = await openLesson(page, date, firstName);
  await dialog.getByLabel(status, { exact: true }).check();
  if (measure) await dialog.getByLabel(measure.label, { exact: true }).fill(measure.value);
  await dialog.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
  // Saved before the scenario moves on: the dialog has closed (a lesson marked
  // again may carry the same status already), and the week carries the new one.
  await expect(dialog).toBeHidden();
  await expect(lessonOf(day, firstName)).toContainText(status.toLowerCase());
  await expect(lessonOf(day, firstName)).not.toContainText("отметьте урок");
}

const MEASURE = "на английском, мин";

test("the card keeps the family's goal and a personal measure, counted when a lesson is marked", async ({ page }) => {
  const card = await createStudent(page, "Целеустремлённая");
  const older = await addPastLesson(page, "Целеустремлённая", 2);
  const newer = await addPastLesson(page, "Целеустремлённая", 1);

  // Without a measure, marking a lesson asks for no number.
  const { dialog } = await openLesson(page, older, "Целеустремлённая");
  await expect(dialog.getByRole("spinbutton")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();

  // The goal and the measure on the card.
  await page.goto(card);
  const goal = page.getByRole("region", { name: "Цель и показатель" });
  await expect(goal).toContainText("Цель не задана");
  await goal.getByRole("button", { name: "Изменить", exact: true }).click();
  await goal.getByLabel("Цель семьи").fill("Больше говорить по-английски");
  await goal.getByLabel("Показатель").fill("на английском");
  await goal.getByLabel("Единица").fill("мин");
  await goal.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(goal).toContainText("Больше говорить по-английски");
  await expect(goal).toContainText("Пока нет значений");

  // Two lessons marked with their numbers, the older one first.
  await mark(page, older, "Целеустремлённая", "Проведён", { label: MEASURE, value: "5" });
  await mark(page, newer, "Целеустремлённая", "Проведён", { label: MEASURE, value: "12" });

  await page.goto(card);
  await expect(goal).toContainText("на английском: 5 → 12 мин");
});
