import { type Browser, expect, type Page, type Route, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

// Acceptance for #399: an answer given on the assessment right before a
// reload is the one the child sees after it. The reload can be rendered from
// the database a moment before that answer is saved there, while the page
// being left still hears that it was saved. The scenario forces that order:
// the reloaded page is rendered first, then the answer is saved and the page
// being left is told so, then the reloaded page arrives.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// student's are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago, and cancelled at the end. The texts are synthetic.

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

// A student's browser has no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A synthetic reading text of about 130 words. */
const READING = Array.from(
  { length: 7 },
  (_, i) => `Day ${i + 1}: the demo robot Pim walks to the blue box, opens it and counts the round stones inside.`,
).join(" ");

const assessment = (title: string) => ({
  version: 1,
  title,
  sections: [
    {
      skill: "reading",
      text: READING,
      questions: [{ type: "choice", question: "What colour is the box?", options: ["red", "blue", "green"], answer: 1 }],
    },
    { skill: "writing", task: "Write a note to Pim about your weekend (30–60 words)." },
  ],
});

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Creates a student in Moscow; returns the card's address and the student's link. */
async function createStudent(page: Page, firstName: string): Promise<{ card: string; link: string }> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return { card, link: await page.evaluate(() => navigator.clipboard.readText()) };
}

/** «+ Урок» for today, five minutes ago in Moscow: a lesson going on now. */
async function addLessonNow(page: Page, firstName: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() - 5 * 60_000));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(`${part("year")}-${part("month")}-${part("day")}`);
  await page.getByLabel("Время", { exact: true }).fill(`${part("hour")}:${part("minute")}`);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
}

/** Today in Moscow, as the week names its day: «понедельник, 23 ноября». */
function todayLabel(): string {
  const iso = new Date(Date.now() - 5 * 60_000).toLocaleDateString("en-CA", { timeZone: "Europe/Moscow" });
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

/** Cancels the lesson going on now, so it does not go on for the scenarios that run after this one. */
async function cancelLessonNow(page: Page, firstName: string) {
  await page.goto("/teacher/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
  const day = page.getByRole("region", { name: todayLabel() });
  await day.getByRole("button", { name: new RegExp(firstName) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Отменить", exact: true }).click();
  await dialog.getByRole("button", { name: "Отменить урок", exact: true }).click();
  await expect(day.getByRole("button", { name: new RegExp(firstName) })).toContainText("отменён");
}

/** Opens a link in a fresh browser without any session, as the student would, and waits for their page. */
async function openAsStudent(browser: Browser, link: string, firstName: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect(page.getByText(firstName)).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("an answer given right before a reload is shown after it, even when the reload was rendered before the answer was saved", async ({ page, browser }) => {
  const { card, link } = await createStudent(page, "Перезагружает замер");
  await addLessonNow(page, "Перезагружает замер");

  await page.goto(card);
  const region = page.getByRole("region", { name: "Замеры" });
  await region.getByRole("button", { name: "Импортировать замер", exact: true }).click();
  await region.getByLabel("JSON замера").fill(JSON.stringify(assessment("Reload check")));
  await region.getByRole("button", { name: "Импортировать", exact: true }).click();
  const draft = region.getByRole("group", { name: "Reload check" });
  await draft.getByRole("button", { name: "Утвердить", exact: true }).click();
  await expect(draft).toContainText("Утверждён");
  await draft.getByRole("button", { name: "Открыть ученику", exact: true }).click();
  await expect(draft).toContainText("Открыт ученику");

  const student = await openAsStudent(browser, link, "Перезагружает замер");
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: /^Материалы урока/ }).click();
  await student.getByRole("region", { name: "Замер" }).getByRole("link", { name: "Reload check" }).click();
  await expect(student.getByRole("heading", { level: 1, name: "Reload check" })).toBeVisible();

  // A first answer, saved.
  const first = student.waitForResponse((response) => response.url().includes("student.assessments.answer") && response.ok());
  await student.getByRole("radio", { name: "red", exact: true }).check();
  await first;

  // The second answer is held on its way to the server.
  let releaseAnswer!: () => void;
  const answerHeld = new Promise<Route>((resolve) => {
    void student.route("**/api/trpc/**", async (route) => {
      if (!route.request().url().includes("student.assessments.answer")) return route.fallback();
      resolve(route);
      await new Promise<void>((release) => (releaseAnswer = release));
      await route.continue();
    });
  });
  await student.getByRole("radio", { name: "blue", exact: true }).check();
  await answerHeld;

  // The reload is rendered while the server still has the first answer, and held back.
  const address = student.url();
  let releasePage!: () => void;
  const pageRendered = new Promise<void>((rendered) => {
    void student.route(address, async (route) => {
      if (route.request().resourceType() !== "document") return route.fallback();
      const response = await route.fetch();
      rendered();
      await new Promise<void>((release) => (releasePage = release));
      await route.fulfill({ response });
    });
  });
  const reloaded = student.reload();
  await pageRendered;

  // Now the second answer is saved, and the page being left hears so.
  const saved = student.waitForResponse((response) => response.url().includes("student.assessments.answer") && response.ok());
  releaseAnswer();
  await saved;
  // A moment for the page being left to act on the save before it is replaced.
  await student.waitForTimeout(200);
  releasePage();
  await reloaded;

  await expect(student.getByRole("heading", { level: 1, name: "Reload check" })).toBeVisible();
  await expect(student.getByRole("radio", { name: "blue", exact: true })).toBeChecked();
  await student.context().close();
  await cancelLessonNow(page, "Перезагружает замер");
});
