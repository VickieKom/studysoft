// Acceptance for #335: the child's feedback in the assistant's student
// context, so that the plans and the homework it drafts offer more of what
// works. The context carries «что заходит» — the lesson materials' kinds and
// the homework's kinds of tasks, with the number of answers (#333) — the
// topics the child rated «пока путаюсь», and the latest «А ещё я хочу…». The
// MCP description says how to use it; another student's answers never show,
// and nothing of it reaches the student or the parent (integration tests).
//
// The assistant's calls are the HTTP calls the MCP server makes with the
// token, without the teacher's cookies (as in #3). The teacher starts signed
// in (sessions.setup.ts); her time zone and the student's are Moscow. Two
// lessons "this week" are added with «+ Урок», each prepared with a game and a
// video and marked «Проведён». The games are synthetic HTML written here, the
// videos links to a test address; the homework is synthetic
// (deploy/seed/homework/demo-short.json).
import { type APIRequestContext, type Browser, expect, type Page, test as base } from "@playwright/test";
import short from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

// The student's browser and the assistant have no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// One token per teacher: these scenarios must not run side by side.
test.describe.configure({ mode: "serial" });

const SURVEY = "Опрос по урокам";
const FIRST_NAME = "Контекст фидбэка";
const ROUNDS = [
  { game: "Context comets game", topic: "comets", video: "Context comets clip", minutes: 50 },
  { game: "Context rivers game", topic: "rivers", video: "Context rivers clip", minutes: 25 },
];
const WISH = "Больше игр про кометы";

type Rated = { kind: string; chosen: number; of: number };
type Feedback = { lessonMaterials: Rated[]; homeworkTasks: Rated[]; topics: { topic: string; chosen: number }[]; struggling: string[]; wishes: string[] };

const game = (title: string) =>
  Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title} is ready</h1></body></html>`);

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** The date and the time in Moscow of a moment `minutes` ago, as the lesson form takes them. */
function moscowAgo(minutes: number): { date: string; time: string; day: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(Date.now() - minutes * 60_000));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return { date, time: `${part("hour")}:${part("minute")}`, day: new Date(`${date}T12:00:00Z`) };
}

/** How the week names a day: «вторник, 17 ноября». */
const dayLabel = (date: Date) => date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Creates a student in Moscow; returns their card's address, their id and their link. */
async function createStudent(page: Page, firstName: string) {
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
  return { card, studentId: card.split("/").pop()!, link: await page.evaluate(() => navigator.clipboard.readText()) };
}

async function uploadGame(page: Page, title: string, topic: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: game(title) });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill(topic);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

async function addVideoLink(page: Page, title: string, topic: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Видео" });
  await page.getByLabel("Источник видео").selectOption({ label: "Ссылка" });
  await page.getByLabel("Ссылка на видео").fill(`https://video.example.test/${encodeURIComponent(title)}`);
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill(topic);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

/** A lesson that started `minutes` ago, prepared with the given materials, then marked «Проведён». */
async function heldLessonWith(page: Page, firstName: string, minutes: number, materials: string[]) {
  const at = moscowAgo(minutes);
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(at.date);
  await page.getByLabel("Время", { exact: true }).fill(at.time);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();

  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).last().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  for (const title of materials) {
    await page.getByLabel("Добавить из библиотеки").selectOption({ label: title });
    await control(page, "Добавить этап").click();
  }
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();

  await page.goto("/teacher/schedule");
  const day = page.getByRole("region", { name: dayLabel(at.day) });
  if (!(await day.isVisible())) await page.getByRole("button", { name: "Предыдущая неделя", exact: true }).click();
  await day.getByRole("button", { name: new RegExp(`${firstName}.*${at.time}|${at.time}.*${firstName}`) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Проведён", { exact: true }).check();
  await dialog.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openFresh(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

async function studentFeedback(request: APIRequestContext, token: string, studentId: string): Promise<Feedback> {
  const input = encodeURIComponent(JSON.stringify({ studentId }));
  const response = await request.get(`/api/trpc/agent.studentContext?input=${input}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  return (await response.json()).result.data.feedback as Feedback;
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  for (const round of ROUNDS) {
    await uploadGame(page, round.game, round.topic);
    await addVideoLink(page, round.video, round.topic);
  }
  await page.context().close();
});

test("the assistant's student context holds «что заходит» with games first, the topic «пока путаюсь» and «А ещё я хочу…»", async ({
  page,
  browser,
  assistant,
}) => {
  const child = await createStudent(page, FIRST_NAME);
  for (const round of ROUNDS) await heldLessonWith(page, FIRST_NAME, round.minutes, [round.game, round.video]);

  // A homework with the survey: the child picks the games, is confused by comets, and wishes for more.
  await page.goto(child.card);
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(short));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByRole("checkbox", { name: SURVEY }).check();
  await expect(page.getByRole("region", { name: SURVEY }).getByRole("listitem").first()).toBeVisible();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await openFresh(browser, child.link);
  const survey = student.getByRole("region", { name: "Опрос про уроки" });
  for (const round of ROUNDS) {
    await survey.getByRole("group", { name: `Что было веселее: ${round.game} или ${round.video}?`, exact: true }).getByRole("button", { name: round.game, exact: true }).click();
  }
  await survey.getByRole("group", { name: "Насколько понятно: comets?", exact: true }).getByRole("button", { name: "пока путаюсь", exact: true }).click();
  await survey.getByRole("group", { name: "А ещё я хочу…", exact: true }).getByRole("textbox").fill(WISH);
  await survey.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(survey).toHaveCount(0);
  await student.context().close();

  const token = await createToken(page);
  const feedback = await studentFeedback(assistant, token, child.studentId);
  expect(feedback.lessonMaterials[0]).toEqual({ kind: "game", chosen: 2, of: 2 });
  expect(feedback.struggling).toContain("comets");
  expect(feedback.wishes).toContain(WISH);
});
