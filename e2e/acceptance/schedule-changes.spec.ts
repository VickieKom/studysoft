// Acceptance for #81: moving and cancelling lessons, changing a slot from a
// date, overlaps and the meeting link.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and every
// student's are Moscow here, so a time on the week is the same for both and
// the scenarios read one. Lessons come from a weekly slot two days ahead (the
// first one is never "today") or from «+ Урок». A lesson on the week is a
// button with the student's name; it opens the lesson in a dialog.
//
// Helpers and labels follow e2e/acceptance/schedule-week.spec.ts (#80);
// the ones needed here are copied, that file is not touched.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The teacher's time zone is shared by every scenario here and in schedule-week.spec.ts.
test.describe.configure({ mode: "serial" });

const WEEKDAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
const DAY = 86_400_000;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A calendar date in Moscow, `days` from today. */
function moscowDate(days: number): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(Date.now() + days * DAY));
  return new Date(`${iso}T12:00:00Z`);
}

const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);

/** How the week names a day: «вторник, 17 ноября». */
const dayLabel = (date: Date) =>
  date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** A date without the weekday: «17 ноября». */
const dayMonth = (date: Date) => date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const weekday = (date: Date) => WEEKDAYS[date.getUTCDay()]!;

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

/** Adds a weekly slot on the open card: weekday, time in the student's zone. */
async function addSlot(page: Page, day: string, time: string) {
  await control(page, "Добавить слот").click();
  await page.getByLabel("День недели").selectOption({ label: day });
  await page.getByLabel("Время").fill(time);
  await page.getByRole("button", { name: "Сохранить слот", exact: true }).click();
  // Saved before the scenario moves on: the card lists the slot.
  await expect(page.getByText(new RegExp(`${day}, ${time}`))).toBeVisible();
}

/** «+ Урок» on «Расписание»: a one-off lesson for a student, saved before moving on. */
async function addLesson(page: Page, firstName: string, date: Date, time: string) {
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(date));
  await page.getByLabel("Время").fill(time);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(lessonOf(await openWeekWith(page, date), firstName)).toHaveCount(1);
}

/** Opens «Расписание» and moves forward until the week shows this date. */
async function openWeekWith(page: Page, date: Date): Promise<Locator> {
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  // The week is on screen before looking for the day in it.
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
  const day = page.getByRole("region", { name: dayLabel(date) });
  for (let i = 0; i < 6 && !(await day.isVisible()); i++) {
    const shown = await page.getByRole("region").first().getAttribute("aria-label");
    await page.getByRole("button", { name: "Следующая неделя", exact: true }).click();
    // The next week has replaced this one before looking again.
    await expect(page.getByRole("region").first()).not.toHaveAttribute("aria-label", shown ?? "");
  }
  await expect(day).toBeVisible();
  return day;
}

function lessonOf(day: Locator, firstName: string) {
  return day.getByRole("button", { name: new RegExp(firstName) });
}

/** Opens a student's lesson on that date: the dialog with what can be done to it, and the day it is on. */
async function openLesson(page: Page, date: Date, firstName: string): Promise<{ day: Locator; dialog: Locator }> {
  const day = await openWeekWith(page, date);
  await lessonOf(day, firstName).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return { day, dialog };
}

/** «Перенести» on a lesson: a new date and time in the student's zone; returns once it has left its day. */
async function move(page: Page, from: Date, firstName: string, to: Date, time: string) {
  const { day, dialog } = await openLesson(page, from, firstName);
  await dialog.getByRole("button", { name: "Перенести", exact: true }).click();
  await dialog.getByLabel("Дата").fill(isoDate(to));
  await dialog.getByLabel("Время").fill(time);
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  // Saved before the scenario moves on: the week no longer shows it on its old day.
  await expect(lessonOf(day, firstName)).toHaveCount(0);
}

/** The Moscow date and «ЧЧ:ММ» a few hours from now, rounded to five minutes. */
function moscowSoon(hours: number): { date: Date; time: string } {
  const moment = new Date(Math.ceil((Date.now() + hours * 3_600_000) / 300_000) * 300_000);
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(moment);
  const time = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(moment);
  return { date: new Date(`${iso}T12:00:00Z`), time };
}

test.beforeEach(async ({ page }) => {
  await setTeacherTimeZone(page, "Москва");
});

test("a lesson moved to another day shows there with «перенесён с …», and the slot's other lessons stay", async ({
  page,
}) => {
  await createStudent(page, "Перенос");
  const first = moscowDate(2);
  await addSlot(page, weekday(first), "17:00");

  await move(page, first, "Перенос", plusDays(first, 1), "18:00");

  await expect(lessonOf(await openWeekWith(page, first), "Перенос")).toHaveCount(0);
  const moved = lessonOf(await openWeekWith(page, plusDays(first, 1)), "Перенос");
  await expect(moved).toHaveCount(1);
  await expect(moved).toContainText("18:00");
  await expect(moved).toContainText(`перенесён с ${dayMonth(first)}`);

  const next = lessonOf(await openWeekWith(page, plusDays(first, 7)), "Перенос");
  await expect(next).toHaveCount(1);
  await expect(next).toContainText("17:00");
});

test("a slot changed from a date moves the lessons after it; earlier ones and one moved by hand stay", async ({
  page,
}) => {
  const card = await createStudent(page, "Новое время");
  const first = moscowDate(2);
  const day = weekday(first);
  await addSlot(page, day, "17:00");

  // The second lesson is moved by hand first.
  const second = plusDays(first, 7);
  await move(page, second, "Новое время", plusDays(second, 2), "12:00");

  await page.goto(card);
  await control(page, "Изменить слот").click();
  await page.getByLabel("Время").fill("19:00");
  await page.getByLabel("С даты").fill(isoDate(second));
  await page.getByRole("button", { name: "Сохранить слот", exact: true }).click();
  await expect(page.getByText(new RegExp(`${day}, 19:00`))).toBeVisible();

  const before = lessonOf(await openWeekWith(page, first), "Новое время");
  await expect(before).toContainText("17:00");
  await expect(lessonOf(await openWeekWith(page, second), "Новое время")).toHaveCount(0);
  await expect(lessonOf(await openWeekWith(page, plusDays(second, 2)), "Новое время")).toContainText("12:00");
  for (const week of [2, 3]) {
    const later = lessonOf(await openWeekWith(page, plusDays(first, week * 7)), "Новое время");
    await expect(later).toHaveCount(1);
    await expect(later).toContainText("19:00");
    await expect(later).not.toContainText("17:00");
  }
});

test("cancelling offers «Списать» ticked less than 24 hours ahead and unticked further, and keeps the teacher's choice", async ({
  page,
}) => {
  // Less than 24 hours ahead: ticked; the teacher unticks it.
  await createStudent(page, "Поздняя отмена");
  const soon = moscowSoon(3);
  await addLesson(page, "Поздняя отмена", soon.date, soon.time);
  let { day, dialog } = await openLesson(page, soon.date, "Поздняя отмена");
  await dialog.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(dialog.getByLabel("Списать")).toBeChecked();
  await dialog.getByLabel("Списать").uncheck();
  await dialog.getByRole("button", { name: "Отменить урок", exact: true }).click();
  // Saved before the page is left: the week marks the lesson cancelled.
  await expect(lessonOf(day, "Поздняя отмена")).toContainText("отменён");

  ({ dialog } = await openLesson(page, soon.date, "Поздняя отмена"));
  await expect(dialog.getByLabel("Списать")).not.toBeChecked();

  // Three days ahead: unticked; the teacher ticks it.
  await createStudent(page, "Ранняя отмена");
  const later = moscowDate(3);
  await addLesson(page, "Ранняя отмена", later, "10:00");
  ({ day, dialog } = await openLesson(page, later, "Ранняя отмена"));
  await dialog.getByRole("button", { name: "Отменить", exact: true }).click();
  await expect(dialog.getByLabel("Списать")).not.toBeChecked();
  await dialog.getByLabel("Списать").check();
  await dialog.getByRole("button", { name: "Отменить урок", exact: true }).click();
  await expect(lessonOf(day, "Ранняя отмена")).toContainText("отменён");

  ({ dialog } = await openLesson(page, later, "Ранняя отмена"));
  await expect(dialog.getByLabel("Списать")).toBeChecked();
});

test("moving a lesson onto another lesson's time warns «в это время уже урок с …» and still saves", async ({ page }) => {
  await createStudent(page, "Занят");
  const first = moscowDate(2);
  await addSlot(page, weekday(first), "17:00");
  await createStudent(page, "Поверх");
  await addLesson(page, "Поверх", plusDays(first, 1), "10:00");

  const { day: from, dialog } = await openLesson(page, plusDays(first, 1), "Поверх");
  await dialog.getByRole("button", { name: "Перенести", exact: true }).click();
  await dialog.getByLabel("Дата").fill(isoDate(first));
  await dialog.getByLabel("Время").fill("17:30");
  // The warning comes while choosing, before saving; saving is still allowed.
  await expect(dialog.getByText(/в это время уже урок с Занят/)).toBeVisible();
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(lessonOf(from, "Поверх")).toHaveCount(0);

  const day = await openWeekWith(page, first);
  await expect(lessonOf(day, "Занят")).toContainText("17:00");
  await expect(lessonOf(day, "Поверх")).toContainText("17:30");
});

test("a meeting link pasted into one lesson is copied by «Скопировать» and belongs to that lesson only", async ({ page }) => {
  await createStudent(page, "Встреча");
  const first = moscowDate(2);
  await addSlot(page, weekday(first), "16:00");
  // A made-up address on a reserved test domain.
  const link = "https://meet.example.test/abc-defg-hij";

  let { dialog } = await openLesson(page, first, "Встреча");
  await expect(dialog.getByLabel("Ссылка на встречу")).toHaveValue("");
  await dialog.getByLabel("Ссылка на встречу").fill(link);
  await dialog.getByRole("button", { name: "Сохранить ссылку", exact: true }).click();
  await expect(dialog.getByText("Ссылка сохранена")).toBeVisible();

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await dialog.getByRole("button", { name: "Скопировать", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link);

  // Kept after a reload; the next lesson of the slot has its own, empty one.
  ({ dialog } = await openLesson(page, first, "Встреча"));
  await expect(dialog.getByLabel("Ссылка на встречу")).toHaveValue(link);
  ({ dialog } = await openLesson(page, plusDays(first, 7), "Встреча"));
  await expect(dialog.getByLabel("Ссылка на встречу")).toHaveValue("");
});
