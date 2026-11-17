// Acceptance for #85: «Расписание» has three views — «День», «Неделя» and
// «Список». The week stays the default; «День» shows one day's lessons in time
// order with both times and moves a day with «‹ ›»; «Список» shows the lessons
// from now on, grouped by date, with the meeting link if set. The chosen view
// is kept when the teacher comes back in the same browser.
//
// The teacher's time zone is «Таиланд» (Bangkok, UTC+7) and the students' is
// Moscow (UTC+3): 09:00 for the student is 13:00 for the teacher, on the same
// date. Lessons are added for dates counted from the teacher's today, which is
// never before the student's today, so «+ Урок» always takes them.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The teacher's time zone is shared by every scenario here.
test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A calendar date in a time zone, `days` from today there. */
function dateIn(timeZone: string, days: number): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  return new Date(new Date(`${iso}T12:00:00Z`).getTime() + days * DAY);
}
const teacherDate = (days: number) => dateIn("Asia/Bangkok", days);

/** How the schedule names a day: «вторник, 17 ноября». */
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

async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
}

async function openSchedule(page: Page) {
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
}

/** «+ Урок»: a one-off lesson at the student's date and time, saved before moving on. */
async function addLesson(page: Page, firstName: string, date: Date, time: string) {
  await openSchedule(page);
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата", { exact: true }).fill(isoDate(date));
  await page.getByLabel("Время", { exact: true }).fill(time);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
}

function lessonsOf(scope: Locator, firstName: string) {
  return scope.getByRole("button", { name: new RegExp(firstName) });
}

test("the week is the default; «День» shows the day's lessons in time order with both times and moves a day", async ({
  page,
}) => {
  await setTeacherTimeZone(page, "Таиланд");
  await createStudent(page, "Видом день");
  const today = teacherDate(0);
  const tomorrow = teacherDate(1);
  // Added out of order: the day sorts them by time.
  await addLesson(page, "Видом день", today, "11:00");
  await addLesson(page, "Видом день", today, "09:00");
  await addLesson(page, "Видом день", tomorrow, "10:00");

  await openSchedule(page);
  await expect(control(page, "Неделя")).toHaveAttribute("aria-current", "page");
  await expect(control(page, "Следующая неделя")).toBeVisible();

  await control(page, "День").click();
  await expect(control(page, "День")).toHaveAttribute("aria-current", "page");
  const day = page.getByRole("region", { name: dayLabel(today) });
  await expect(day).toBeVisible();
  // One day only.
  await expect(page.getByRole("region", { name: dayLabel(tomorrow) })).toHaveCount(0);
  const lessons = lessonsOf(day, "Видом день");
  await expect(lessons).toHaveCount(2);
  await expect(lessons.nth(0)).toContainText("09:00");
  await expect(lessons.nth(0)).toContainText("13:00");
  await expect(lessons.nth(1)).toContainText("11:00");
  await expect(lessons.nth(1)).toContainText("15:00");

  await control(page, "Следующий день").click();
  const next = page.getByRole("region", { name: dayLabel(tomorrow) });
  await expect(next).toBeVisible();
  await expect(lessonsOf(next, "Видом день")).toHaveCount(1);
  await expect(lessonsOf(next, "Видом день")).toContainText("10:00");
  await expect(lessonsOf(next, "Видом день")).toContainText("14:00");

  await control(page, "Предыдущий день").click();
  await expect(page.getByRole("region", { name: dayLabel(today) })).toBeVisible();
});

test("«Список» shows the lessons from now on, grouped by date, with both times and the meeting link", async ({ page }) => {
  await setTeacherTimeZone(page, "Таиланд");
  await createStudent(page, "Видом список");
  // Midnight of the student's today has always passed: not in the list.
  await addLesson(page, "Видом список", dateIn("Europe/Moscow", 0), "00:00");
  const first = teacherDate(1);
  const second = teacherDate(2);
  await addLesson(page, "Видом список", first, "10:00");
  await addLesson(page, "Видом список", second, "12:00");

  await openSchedule(page);
  await control(page, "Список").click();
  await expect(control(page, "Список")).toHaveAttribute("aria-current", "page");
  await expect(lessonsOf(page.getByRole("main"), "Видом список")).toHaveCount(2);

  const firstDay = page.getByRole("region", { name: dayLabel(first) });
  await expect(lessonsOf(firstDay, "Видом список")).toHaveCount(1);
  await expect(lessonsOf(firstDay, "Видом список")).toContainText("10:00");
  await expect(lessonsOf(firstDay, "Видом список")).toContainText("14:00");
  const secondDay = page.getByRole("region", { name: dayLabel(second) });
  await expect(lessonsOf(secondDay, "Видом список")).toHaveCount(1);
  await expect(lessonsOf(secondDay, "Видом список")).toContainText("12:00");
  await expect(lessonsOf(secondDay, "Видом список")).toContainText("16:00");
  // Dates in order.
  const labels = await page.getByRole("region").evaluateAll((regions) => regions.map((r) => r.getAttribute("aria-label")));
  expect(labels.indexOf(dayLabel(first))).toBeLessThan(labels.indexOf(dayLabel(second)));

  // A meeting link set on the lesson shows in the list.
  const meeting = "https://meet.example.test/views-list";
  await lessonsOf(firstDay, "Видом список").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Ссылка на встречу").fill(meeting);
  await dialog.getByRole("button", { name: "Сохранить ссылку", exact: true }).click();
  await expect(dialog.getByText("Сохранено")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: dayLabel(first) }).locator(`a[href="${meeting}"]`)).toBeVisible();
  await expect(page.getByRole("region", { name: dayLabel(second) }).locator(`a[href="${meeting}"]`)).toHaveCount(0);
});

test("the chosen view is kept when the teacher comes back to «Расписание»", async ({ page }) => {
  await openSchedule(page);
  await control(page, "Список").click();
  await expect(control(page, "Список")).toHaveAttribute("aria-current", "page");

  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await expect(control(page, "Список")).toHaveAttribute("aria-current", "page");
  await expect(control(page, "Следующая неделя")).toHaveCount(0);

  await control(page, "День").click();
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await expect(control(page, "День")).toHaveAttribute("aria-current", "page");

  await control(page, "Неделя").click();
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await expect(control(page, "Неделя")).toHaveAttribute("aria-current", "page");
  await expect(control(page, "Следующая неделя")).toBeVisible();
});
