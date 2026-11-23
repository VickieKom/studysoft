// Acceptance for #333: the child's answers gathered up where the teacher
// looks anyway. «Фидбэк» on the card shows the week's answers and two
// ratings «что заходит» (product owner, 2026-11-23): the kinds of homework
// tasks, from the one-tap question after the homework (#331), and the kinds
// of lesson materials — games, warm-ups, videos — from the survey's «Что было
// веселее?» (#332); «3 из 3» is chosen in three answers of three; the topics
// in a list of their own. «Прогресс» on the card says what the child likes
// most. The teacher's general screen marks the student «Новый фидбэк» until
// she opens the card. The parent sees none of it, and the topics and the
// rating across students are pinned by integration tests.
//
// The teacher starts signed in (sessions.setup.ts); her time zone and the
// student's are Moscow. Three lessons "this week" are added with «+ Урок»,
// each prepared with a game and a video and marked «Проведён». The games are
// synthetic HTML written here, the videos links to a test address; the
// homework is synthetic (deploy/seed/homework/demo-short.json).
import { type Browser, expect, type Page, test } from "@playwright/test";
import short from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

// The student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };
const MINI = "Мини-вопрос после домашки";
const SURVEY = "Опрос по урокам";
const ROUNDS = [
  { game: "Rating race game", video: "Rating race clip", minutes: 55 },
  { game: "Rating memory game", video: "Rating memory clip", minutes: 35 },
  { game: "Rating puzzle game", video: "Rating puzzle clip", minutes: 15 },
];
const FIRST_NAME = "Любит игры";

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

/** Creates a student in Moscow; returns their card's address and their link. */
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

async function uploadGame(page: Page, title: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: game(title) });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("rating");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

async function addVideoLink(page: Page, title: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Видео" });
  await page.getByLabel("Источник видео").selectOption({ label: "Ссылка" });
  await page.getByLabel("Ссылка на видео").fill(`https://video.example.test/${encodeURIComponent(title)}`);
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("rating");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

/** A lesson that started `minutes` ago, prepared with a game and a video, then marked «Проведён». */
async function heldLessonWith(page: Page, firstName: string, minutes: number, materials: string[]) {
  const at = moscowAgo(minutes);
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(at.date);
  await page.getByLabel("Время", { exact: true }).fill(at.time);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();

  // The lesson started within the hour, so «Подготовка» still lists it; the newest one is last.
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

/** On the card: imports demo-short.json, ticks the boxes asked for, and publishes it. */
async function publish(page: Page, card: string, boxes: string[]) {
  await page.goto(card);
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(short));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  for (const box of boxes) await page.getByRole("checkbox", { name: box }).check();
  // The survey's questions are gathered before «Опубликовать» is pressed.
  if (boxes.includes(SURVEY)) await expect(page.getByRole("region", { name: SURVEY }).getByRole("listitem").first()).toBeVisible();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
}

async function openFresh(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

/** demo-short.json done, «Сдать», and «Выбрать ответ» as the most interesting kind. */
async function doHomeworkAndPick(student: Page) {
  const [odd, pet] = short.tasks as [(typeof short.tasks)[number], (typeof short.tasks)[number]];
  await expect(student.getByText(odd.prompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  await student.getByRole("button", { name: "apple", exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(student.getByText(pet.prompt)).toBeVisible();
  await student.getByLabel("Ваш ответ").fill("My cat sleeps all day.");
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  const question = student.getByRole("region", { name: "Какое задание было самым интересным?" });
  await question.getByRole("button", { name: "Выбрать ответ", exact: true }).click();
  await expect(student.getByText("Спасибо!")).toBeVisible();
}

/** The «Новый фидбэк» block of the teacher's general screen. */
async function newFeedback(page: Page) {
  await page.goto("/teacher");
  return page.getByRole("region", { name: "Новый фидбэк" });
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  for (const round of ROUNDS) {
    await uploadGame(page, round.game);
    await addVideoLink(page, round.video);
  }
  await page.context().close();
});

test("two one-tap answers and a survey: «Фидбэк» shows the week and both ratings, games «3 из 3»; «Прогресс» says what the child likes most; the general screen marks the new feedback until the card is opened", async ({
  page,
  browser,
}) => {
  const child = await createStudent(page, FIRST_NAME);

  // The first homework, with the one-tap question.
  await publish(page, child.card, [MINI]);
  let student = await openFresh(browser, child.link);
  await doHomeworkAndPick(student);
  await student.context().close();

  // Three lessons this week, each a game and a video; then the second homework, with the question and the survey.
  for (const round of ROUNDS) await heldLessonWith(page, FIRST_NAME, round.minutes, [round.game, round.video]);
  await publish(page, child.card, [MINI, SURVEY]);
  student = await openFresh(browser, child.link);
  const survey = student.getByRole("region", { name: "Опрос про уроки" });
  for (const round of ROUNDS) {
    await survey.getByRole("group", { name: `Что было веселее: ${round.game} или ${round.video}?`, exact: true }).getByRole("button", { name: round.game, exact: true }).click();
  }
  await survey.getByRole("button", { name: "Готово", exact: true }).click();
  await expect(survey).toHaveCount(0);
  await doHomeworkAndPick(student);
  await student.context().close();

  // The general screen: the student has new feedback.
  await expect((await newFeedback(page)).getByRole("link", { name: FIRST_NAME, exact: true })).toBeVisible();

  // The card: the week's answers and the two ratings.
  await page.goto(child.card);
  const feedback = page.getByRole("region", { name: "Фидбэк" });
  const lessons = feedback.getByRole("list", { name: "Что заходит на уроках" }).getByRole("listitem");
  await expect(lessons.first()).toHaveText("Игры — 3 из 3");
  const homework = feedback.getByRole("list", { name: "Что заходит в домашке" }).getByRole("listitem");
  await expect(homework.first()).toHaveText("Выбрать ответ — 2 из 2");
  const week = feedback.getByRole("list", { name: "Ответы за неделю" });
  await expect(week).toContainText("Самое интересное: Выбрать ответ");
  await expect(week).toContainText("Опрос по урокам");
  await expect(page.getByRole("region", { name: "Прогресс" })).toContainText("Больше всего нравится: игры");

  // Opened: the mark is gone.
  await expect((await newFeedback(page)).getByRole("link", { name: FIRST_NAME, exact: true })).toHaveCount(0);
});
