// Acceptance for #100: when a student's time zone changes on the card, the
// weekly slot keeps its moment — the lesson stays where it was for the
// teacher, and the student's local time changes; the teacher moves it by
// hand if needed (product owner, 2026-11-17). The card never shows a stale
// time: a slot reads in the student's current zone, and in the teacher's
// when hers differs, as the week does. Changing only the zone, the form says
// that the lesson time stays and where to change it.
//
// The teacher starts signed in (sessions.setup.ts). Her zone is set to
// Thailand here (UTC+7), the student starts in Moscow (UTC+3): 17:00 for the
// student is 21:00 for the teacher. Helpers follow
// e2e/acceptance/schedule-changes.spec.ts; that file is not touched.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The teacher's time zone is shared with the other schedule scenarios.
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

/** How the week names a day: «вторник, 17 ноября». */
const dayLabel = (date: Date) =>
  date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

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

/** Opens «Расписание» and moves forward until the week shows this date. */
async function openWeekWith(page: Page, date: Date): Promise<Locator> {
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
  const day = page.getByRole("region", { name: dayLabel(date) });
  for (let i = 0; i < 6 && !(await day.isVisible()); i++) {
    const shown = await page.getByRole("region").first().getAttribute("aria-label");
    await page.getByRole("button", { name: "Следующая неделя", exact: true }).click();
    await expect(page.getByRole("region").first()).not.toHaveAttribute("aria-label", shown ?? "");
  }
  await expect(day).toBeVisible();
  return day;
}

function lessonOf(day: Locator, firstName: string) {
  return day.getByRole("button", { name: new RegExp(firstName) });
}

test("a student's new time zone leaves the lesson at its moment, and the card shows the slot in the new zone", async ({
  page,
}) => {
  await setTeacherTimeZone(page, "Таиланд");
  const card = await createStudent(page, "Переезд");
  // Two days ahead: the lesson is never today, and in Moscow and Thailand it is the same date at these hours.
  const first = moscowDate(2);
  const day = weekday(first);

  await control(page, "Добавить слот").click();
  await page.getByLabel("День недели").selectOption({ label: day });
  await page.getByLabel("Время", { exact: true }).fill("17:00");
  await page.getByRole("button", { name: "Сохранить слот", exact: true }).click();

  // Before: the student's 17:00, the teacher's 21:00.
  const slots = page.getByRole("region", { name: "Регулярные уроки" });
  await expect(slots.getByRole("listitem")).toHaveCount(1);
  await expect(slots.getByRole("listitem")).toContainText(`${day}, 17:00`);
  await expect(slots.getByRole("listitem")).toContainText("у вас 21:00");
  let lesson = lessonOf(await openWeekWith(page, first), "Переезд");
  await expect(lesson).toContainText("21:00");
  await expect(lesson).toContainText("у ученика 17:00");

  // The student moves to Thailand.
  await page.goto(card);
  await control(page, "Изменить").click();
  await page.getByLabel("Часовой пояс").selectOption({ label: "Таиланд" });
  // The form says the lessons stay where they are and the slot is changed on the card (product owner, 2026-11-17).
  await expect(page.getByRole("status").filter({ hasText: "Регулярные уроки" })).toContainText("Изменить слот");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Переезд" })).toBeVisible();

  // After: the lesson is still at 21:00 for the teacher, which is now the student's time too.
  await page.goto(card);
  await expect(slots.getByRole("listitem")).toHaveCount(1);
  await expect(slots.getByRole("listitem")).toContainText(`${day}, 21:00`);
  await expect(slots.getByRole("listitem")).not.toContainText("17:00");
  await expect(slots.getByRole("listitem")).not.toContainText("у вас");
  // «Изменить слот» starts from the time the card shows.
  await control(page, "Изменить слот").click();
  await expect(slots.getByLabel("Время", { exact: true })).toHaveValue("21:00");

  lesson = lessonOf(await openWeekWith(page, first), "Переезд");
  await expect(lesson).toHaveCount(1);
  await expect(lesson).toContainText("21:00");
  await expect(lesson).not.toContainText("17:00");
});
