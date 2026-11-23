// Acceptance for #325: a YouTube video plays inside the platform. A video
// link opened to the student (#158) was a button that left for YouTube; a
// YouTube link — youtube.com/watch, youtu.be or youtube.com/shorts — now
// plays in an embedded player from youtube-nocookie.com, on the student's
// video page in «Материалы урока» and on the video's page in the teacher's
// library. A link to any other site stays a button that opens it in a new
// tab. The content security policy, frames from youtube-nocookie.com and
// nothing else new, is pinned by an integration or unit test.
//
// The teacher starts signed in (sessions.setup.ts). Her time zone and the
// student's are Moscow. A lesson "going on now" is added with «+ Урок» for
// today, five minutes ago. The video ids are synthetic, and nothing is
// fetched from YouTube: the scenario answers the player's address itself.
import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// The videos and the student made by one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

// A student's browser has no teacher session: contexts made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const WATCH = "Planets song on YouTube";
const WATCH_LINK = "https://www.youtube.com/watch?v=demoPlanet1";
const SHORT = "Colours short on YouTube";
const SHORT_LINK = "https://youtu.be/demoColour2";
const SHORTS = "Animals clip on YouTube Shorts";
const SHORTS_LINK = "https://www.youtube.com/shorts/demoAnimal3";
const ELSEWHERE = "Rhyme on another site";
const ELSEWHERE_LINK = "https://video.example.test/watch?v=youtube-rhyme";

const EMBED = "https://www.youtube-nocookie.com/embed/";

/** The embedded player never reaches YouTube in a test: its address answers with an empty page. */
async function stubPlayer(context: BrowserContext) {
  await context.route("https://www.youtube-nocookie.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>player</title>" }));
}

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

function materials(page: Page): Locator {
  return page.getByRole("list", { name: "Материалы" }).getByRole("listitem");
}

/** The embedded player on a page, by the video's id. */
function player(page: Page, id: string): Locator {
  return page.getByRole("main").locator(`iframe[src^="${EMBED}${id}"]`);
}

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** Creates a student in Moscow; returns their link. */
async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Opens a link in a fresh browser without any session, as the student would, and waits for their page. */
async function openAsStudent(browser: Browser, link: string, firstName: string): Promise<Page> {
  const context = await browser.newContext({ storageState: NO_SESSION });
  await stubPlayer(context);
  const page = await context.newPage();
  await page.goto(link);
  await expect(page.getByText(firstName)).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

/** «+ Урок» for today, five minutes ago in Moscow: a lesson going on now. */
async function addLessonNow(page: Page, firstName: string) {
  const startedAt = new Date(Date.now() - 5 * 60_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(startedAt);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  await page.goto("/teacher/students");
  await control(page, "Расписание").click();
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(`${part("year")}-${part("month")}-${part("day")}`);
  await page.getByLabel("Время", { exact: true }).fill(`${part("hour")}:${part("minute")}`);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  // Saved before the scenario moves on: the form has closed and «+ Урок» is back.
  await expect(control(page, "+ Урок")).toBeVisible();
}

/** «Загрузить» → a video by link, saved to the library. */
async function saveLinkVideo(page: Page, title: string, link: string) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Видео" });
  await page.getByLabel("Источник видео").selectOption({ label: "Ссылка" });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Тема").fill("embedded videos");
  await page.getByLabel("Ссылка на видео").fill(link);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible({ timeout: 30_000 });
}

/** The video's page in «Библиотека». */
async function openInLibrary(page: Page, title: string) {
  await page.goto("/teacher/library");
  await materials(page).filter({ hasText: title }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/** On the video's page in «Библиотека»: «Открыть ученику» to this student. */
async function openToStudent(page: Page, title: string, firstName: string) {
  await openInLibrary(page, title);
  await control(page, "Открыть ученику").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByRole("button", { name: "Открыть", exact: true }).click();
  await expect(page.getByText(new RegExp(`Открыто ученику: ${firstName}`))).toBeVisible();
}

/** «Материалы урока» in the student's menu (#241), and its «Видео» section. */
async function studentVideos(student: Page) {
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: /^Материалы урока/ }).click();
  await expect(student.getByRole("heading", { level: 1, name: "Материалы урока" })).toBeVisible();
  return student.getByRole("region", { name: "Видео" });
}

let viewerLink: string;

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test.beforeEach(async ({ context }) => {
  await stubPlayer(context);
});

test("a YouTube video opened to the student during a lesson plays in an embedded player on their page, with no button that leaves", async ({
  page,
  browser,
}) => {
  viewerLink = await createStudent(page, "Зритель");
  await addLessonNow(page, "Зритель");
  await saveLinkVideo(page, WATCH, WATCH_LINK);
  await openToStudent(page, WATCH, "Зритель");

  const student = await openAsStudent(browser, viewerLink, "Зритель");
  const entry = (await studentVideos(student)).getByRole("link", { name: WATCH });
  // The entry stays on the platform: it is the student's video page, not YouTube.
  await expect(entry).not.toHaveAttribute("target", "_blank");
  await entry.click();
  await expect(student.getByRole("heading", { level: 1, name: WATCH })).toBeVisible();
  await expect(player(student, "demoPlanet1")).toHaveCount(1);
  await expect(player(student, "demoPlanet1")).toHaveAttribute("title", WATCH);
  await expect(student.getByRole("main").getByRole("link", { name: "Смотреть" })).toHaveCount(0);
  await expect(student.getByRole("main").locator('a[href*="youtube.com"], a[href*="youtu.be"]')).toHaveCount(0);
  await student.context().close();
});

test("a youtu.be link and a YouTube Shorts link play embedded too, on the student's page and on the video's page in the library", async ({
  page,
  browser,
}) => {
  await saveLinkVideo(page, SHORT, SHORT_LINK);
  await saveLinkVideo(page, SHORTS, SHORTS_LINK);

  await openInLibrary(page, WATCH);
  await expect(player(page, "demoPlanet1")).toHaveCount(1);
  await openInLibrary(page, SHORT);
  await expect(player(page, "demoColour2")).toHaveCount(1);
  await openInLibrary(page, SHORTS);
  await expect(player(page, "demoAnimal3")).toHaveCount(1);

  await openToStudent(page, SHORTS, "Зритель");
  const student = await openAsStudent(browser, viewerLink, "Зритель");
  await (await studentVideos(student)).getByRole("link", { name: SHORTS }).click();
  await expect(student.getByRole("heading", { level: 1, name: SHORTS })).toBeVisible();
  await expect(player(student, "demoAnimal3")).toHaveCount(1);
  await student.context().close();
});

test("a link to another site is still a button that opens it in a new tab, with no player", async ({ page, browser }) => {
  await saveLinkVideo(page, ELSEWHERE, ELSEWHERE_LINK);
  await openInLibrary(page, ELSEWHERE);
  await expect(page.getByRole("main").locator(`iframe[src^="${EMBED}"]`)).toHaveCount(0);

  await openToStudent(page, ELSEWHERE, "Зритель");
  const student = await openAsStudent(browser, viewerLink, "Зритель");
  const watch = (await studentVideos(student)).getByRole("link", { name: ELSEWHERE });
  await expect(watch).toHaveAttribute("href", ELSEWHERE_LINK);
  await expect(watch).toHaveAttribute("target", "_blank");
  await student.context().close();
});
