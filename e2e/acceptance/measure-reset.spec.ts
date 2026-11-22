// Acceptance for #279: a change of the personal measure's name or unit
// starts it from zero (product owner, 2026-11-22). The form says the
// numbers of the measure before will be erased; once saved, the card shows
// no numbers until a lesson is marked with one, and a lesson marked before
// the change no longer has its number. Changing only the family's goal
// keeps the numbers. That a published report keeps its frozen numbers is
// pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts); the student's time zone
// is Moscow. The helpers are copied from e2e/acceptance/family-goal.spec.ts,
// which is not touched. The goal and the numbers are synthetic.
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

async function setGoal(page: Page, card: string, values: { goal?: string; name?: string; unit?: string }) {
  await page.goto(card);
  const goal = page.getByRole("region", { name: "Цель и показатель" });
  await goal.getByRole("button", { name: "Настроить", exact: true }).click();
  if (values.goal !== undefined) await goal.getByLabel("Цель семьи").fill(values.goal);
  if (values.name !== undefined) await goal.getByLabel("Показатель").fill(values.name);
  if (values.unit !== undefined) await goal.getByLabel("Единица").fill(values.unit);
  return goal;
}

test("a renamed measure starts from zero; a change of the goal alone keeps the numbers", async ({ page }) => {
  const name = "Переименованная";
  const card = await createStudent(page, name);
  const first = await addPastLesson(page, name, 3);
  const second = await addPastLesson(page, name, 2);
  const third = await addPastLesson(page, name, 1);

  let goal = await setGoal(page, card, { goal: "Больше говорить", name: "на английском", unit: "мин" });
  await goal.getByRole("button", { name: "Сохранить", exact: true }).click();
  await mark(page, first, name, "Проведён", { label: "на английском, мин", value: "5" });
  await mark(page, second, name, "Проведён", { label: "на английском, мин", value: "12" });
  await page.goto(card);
  await expect(goal).toContainText("на английском: 5 → 12 мин");

  // Only the goal changed: the numbers stay, and the form warns of nothing.
  goal = await setGoal(page, card, { goal: "Говорить свободнее" });
  await expect(goal).not.toContainText("сотрутся");
  await goal.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.goto(card);
  await expect(goal).toContainText("на английском: 5 → 12 мин");

  // Another measure: the form warns, and after saving the card has no numbers.
  goal = await setGoal(page, card, { name: "книги", unit: "шт." });
  await expect(goal).toContainText("Числа прежнего показателя сотрутся");
  await goal.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.goto(card);
  await expect(goal).toContainText("Пока нет значений");
  await expect(goal).not.toContainText("5 → 12");

  // A lesson marked before the change no longer has its number.
  const { dialog } = await openLesson(page, second, name);
  await expect(dialog.getByLabel("книги, шт.", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).click();

  // A lesson marked with the new measure: only its number.
  await mark(page, third, name, "Проведён", { label: "книги, шт.", value: "2" });
  await page.goto(card);
  await expect(goal).toContainText("книги: 2 шт.");
});
