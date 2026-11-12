// Acceptance for #80: recurring slots on the student card, lessons created
// from them 4 weeks ahead, and «Расписание» showing the week in two time
// zones: the student's and the teacher's.
//
// The teacher starts signed in (sessions.setup.ts). The slot is set two days
// ahead in Moscow, so its first lesson is never "today" whenever this runs.
// The teacher's time zone is set to «Таиланд» (Bangkok, UTC+7) and the
// student's is Moscow (UTC+3): 17:00 for the student is 21:00 for the teacher,
// on the same date.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The teacher's time zone is shared by every scenario here.
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

/** Adds a weekly slot on the open card: weekday, time in the student's zone, duration. */
async function addSlot(page: Page, weekday: string, time: string, duration?: string) {
  await control(page, "Добавить слот").click();
  await page.getByLabel("День недели").selectOption({ label: weekday });
  await page.getByLabel("Время").fill(time);
  if (duration) await page.getByLabel("Длительность").selectOption({ label: duration });
  await page.getByRole("button", { name: "Сохранить слот", exact: true }).click();
}

/** Opens «Расписание» and moves forward until the week shows this date. */
async function openWeekWith(page: Page, date: Date) {
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  const day = page.getByRole("region", { name: dayLabel(date) });
  for (let i = 0; i < 6 && !(await day.isVisible()); i++) {
    await page.getByRole("button", { name: "Следующая неделя", exact: true }).click();
  }
  await expect(day).toBeVisible();
  return day;
}

function lessonOf(day: ReturnType<Page["getByRole"]>, firstName: string) {
  return day.getByRole("button", { name: new RegExp(firstName) });
}

test("a weekly slot puts the student's lessons on the week for 4 weeks, in both time zones", async ({ page }) => {
  await setTeacherTimeZone(page, "Таиланд");
  await createStudent(page, "Слот");
  const first = moscowDate(2);
  await addSlot(page, WEEKDAYS[first.getUTCDay()]!, "17:00");
  await expect(page.getByText(`${WEEKDAYS[first.getUTCDay()]}, 17:00 · 60 мин`)).toBeVisible();

  for (let week = 0; week < 4; week++) {
    const date = new Date(first.getTime() + week * 7 * DAY);
    const lesson = lessonOf(await openWeekWith(page, date), "Слот");
    await expect(lesson).toHaveCount(1);
    await expect(lesson).toContainText("17:00");
    await expect(lesson).toContainText("21:00");
  }
  // Four weeks ahead, not more.
  const fifth = new Date(first.getTime() + 4 * 7 * DAY);
  await expect(lessonOf(await openWeekWith(page, fifth), "Слот")).toHaveCount(0);

  // «‹» goes back.
  await page.getByRole("button", { name: "Предыдущая неделя", exact: true }).click();
  await expect(page.getByRole("region", { name: dayLabel(new Date(fifth.getTime() - 7 * DAY)) })).toBeVisible();
});

test("«+ Урок» adds a one-off lesson, which can be an introductory one", async ({ page }) => {
  await createStudent(page, "Разовый");
  const date = moscowDate(3);
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: "Разовый" });
  await page.getByLabel("Дата").fill(isoDate(date));
  await page.getByLabel("Время").fill("10:00");
  await page.getByLabel("Длительность").selectOption({ label: "45 мин" });
  await page.getByLabel("Вводный урок").check();
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();

  const lesson = lessonOf(await openWeekWith(page, date), "Разовый");
  await expect(lesson).toHaveCount(1);
  await expect(lesson).toContainText("10:00");
  await expect(lesson).toContainText("14:00");
  await expect(lesson).toContainText("вводный");
});

test("changing the teacher's time zone changes her times and keeps the student's", async ({ page }) => {
  await createStudent(page, "Пояс");
  const date = moscowDate(2);
  await addSlot(page, WEEKDAYS[date.getUTCDay()]!, "17:00");

  await setTeacherTimeZone(page, "Москва");
  const lesson = lessonOf(await openWeekWith(page, date), "Пояс");
  await expect(lesson).toContainText("17:00");
  await expect(lesson).not.toContainText("21:00");

  await setTeacherTimeZone(page, "Таиланд");
  await expect(lessonOf(await openWeekWith(page, date), "Пояс")).toContainText("21:00");
});

test("«На паузе» and «Завершили» take the future lessons off the week", async ({ page }) => {
  const date = moscowDate(2);
  for (const status of ["На паузе", "Завершили"]) {
    const firstName = status === "На паузе" ? "Пауза слота" : "Конец слота";
    const card = await createStudent(page, firstName);
    await addSlot(page, WEEKDAYS[date.getUTCDay()]!, "12:00");
    await expect(lessonOf(await openWeekWith(page, date), firstName)).toHaveCount(1);

    await page.goto(card);
    await control(page, "Изменить").click();
    await page.getByLabel("Статус").selectOption({ label: status });
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.getByText(status, { exact: true })).toBeVisible();
    await expect(lessonOf(await openWeekWith(page, date), firstName)).toHaveCount(0);
  }
});

test("another teacher sees none of these lessons", async ({ page, browser }) => {
  const date = moscowDate(2);
  await createStudent(page, "Чужой слот");
  await addSlot(page, WEEKDAYS[date.getUTCDay()]!, "15:00");

  const other = await otherTeacher(browser);
  const day = await openWeekWith(other, date);
  await expect(lessonOf(day, "Чужой слот")).toHaveCount(0);
  await other.context().close();
});

async function otherTeacher(browser: Browser): Promise<Page> {
  return (await browser.newContext({ storageState: SECOND_TEACHER_SESSION })).newPage();
}
