// Acceptance for #32: the teacher imports a homework draft for a student,
// previews it, publishes it with a deadline, and can take it back before the
// student submits.
//
// The teacher's scenarios start signed in (sessions.setup.ts); the student
// opens the link in a fresh browser. Homework comes from deploy/seed/homework/
// (synthetic, docs/homework-format.md).
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import allTypes from "../../deploy/seed/homework/demo-all-types.json" with { type: "json" };
import short from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_HOMEWORK = "Домашних заданий пока нет";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url();
}

async function studentLink(page: Page): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** The homework list on the student's card. */
function homeworkOnCard(page: Page): Locator {
  return page.getByRole("region", { name: "Домашки" }).getByRole("listitem");
}

/** Imports a homework on the open card; ends on the draft's preview. */
async function importHomework(page: Page, homework: unknown) {
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework, null, 2));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
}

// "к четвергу": the weekday after «к», as the product owner asked.
const WEEKDAY_AFTER_K = ["воскресенью", "понедельнику", "вторнику", "среде", "четвергу", "пятнице", "субботе"];

/**
 * A deadline a few days ahead, as the date field takes it and as the student
 * sees it: "к четвергу, 15 ноября".
 */
function deadline(daysAhead: number) {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const iso = date.toISOString().slice(0, 10);
  const day = new Date(`${iso}T00:00:00Z`);
  const dayMonth = day.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
  return { iso, shown: `${WEEKDAY_AFTER_K[day.getUTCDay()]}, ${dayMonth}` };
}

async function publish(page: Page, iso: string) {
  await page.getByLabel("Срок").fill(iso);
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
}

async function openAsStudent(browser: Browser, link: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  return page;
}

test("an imported homework is a draft whose preview shows the keys to the teacher; the student does not see it", async ({
  page,
  browser,
}) => {
  const card = await createStudent(page, "Черновик");
  const link = await studentLink(page);

  await importHomework(page, allTypes);
  await expect(page.getByRole("heading", { level: 1, name: allTypes.title })).toBeVisible();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();

  // The preview lists every task in order, and shows the teacher the keys so
  // that a wrong one is caught before publishing (product owner's decision).
  const tasks = page.getByRole("listitem");
  await expect(tasks).toHaveCount(allTypes.tasks.length);
  for (const [index, task] of allTypes.tasks.entries()) {
    await expect(tasks.nth(index)).toContainText(task.prompt);
  }
  await expect(tasks.nth(2)).toContainText("carrots");

  await page.goto(card);
  await expect(homeworkOnCard(page).filter({ hasText: allTypes.title })).toContainText("Черновик");

  const student = await openAsStudent(browser, link);
  await expect(student.getByText(NO_HOMEWORK)).toBeVisible();
  await student.context().close();
});

test("an invalid homework is not saved and the message names the task and the field", async ({ page }) => {
  await createStudent(page, "Ошибка");

  const unknownType = structuredClone(allTypes);
  (unknownType.tasks[1] as { type: string }).type = "riddle";
  await importHomework(page, unknownType);
  // Next.js keeps its own "alert" region for route announcements, so the
  // message is found by its text among the alerts.
  const alert = page.getByRole("alert").filter({ hasText: "2" }).filter({ hasText: "type" });
  await expect(alert).toBeVisible();

  const wrongVersion = { ...short, version: 99 };
  await page.getByLabel("JSON домашки").fill(JSON.stringify(wrongVersion));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "version" })).toBeVisible();

  await page.getByLabel("JSON домашки").fill("{ not json");
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "JSON" })).toBeVisible();

  await page.goBack();
  await page.reload();
  await expect(homeworkOnCard(page)).toHaveCount(0);
});

test("a published homework shows up for the student with its deadline and number of tasks", async ({
  page,
  browser,
}) => {
  const card = await createStudent(page, "Публикация");
  const link = await studentLink(page);
  const due = deadline(3);

  await importHomework(page, allTypes);
  await publish(page, due.iso);

  const student = await openAsStudent(browser, link);
  await expect(student.getByText(`Домашка к ${due.shown}`)).toBeVisible();
  await expect(student.getByText(new RegExp(`${allTypes.tasks.length}\\s+задани`))).toBeVisible();
  await expect(student.getByText(NO_HOMEWORK)).toHaveCount(0);
  await student.context().close();

  await page.goto(card);
  await expect(homeworkOnCard(page).filter({ hasText: allTypes.title })).toContainText("Опубликована");
});

test("publishing a new homework closes the unsubmitted one as «не сдана»", async ({ page, browser }) => {
  const card = await createStudent(page, "Две домашки");
  const link = await studentLink(page);

  await importHomework(page, allTypes);
  await publish(page, deadline(2).iso);
  await page.goto(card);
  await importHomework(page, short);
  const due = deadline(5);
  await publish(page, due.iso);

  await page.goto(card);
  await expect(homeworkOnCard(page).filter({ hasText: allTypes.title })).toContainText("Не сдана");
  await expect(homeworkOnCard(page).filter({ hasText: short.title })).toContainText("Опубликована");

  const student = await openAsStudent(browser, link);
  await expect(student.getByText(`Домашка к ${due.shown}`)).toBeVisible();
  await expect(student.getByText(new RegExp(`${short.tasks.length}\\s+задани`))).toBeVisible();
  await student.context().close();
});

test("«Снять с публикации» before submission hides it again and makes it a draft", async ({ page, browser }) => {
  const card = await createStudent(page, "Снятие");
  const link = await studentLink(page);

  await importHomework(page, short);
  await publish(page, deadline(3).iso);
  await page.getByRole("button", { name: "Снять с публикации", exact: true }).click();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();

  const student = await openAsStudent(browser, link);
  await expect(student.getByText(NO_HOMEWORK)).toBeVisible();
  await student.context().close();

  // The draft can be published again.
  await publish(page, deadline(4).iso);
  await page.goto(card);
  await expect(homeworkOnCard(page).filter({ hasText: short.title })).toContainText("Опубликована");
});
