// Acceptance for #331: a one-tap question after the homework, only when the
// teacher ticks it. The homework draft has «Мини-вопрос после домашки», off
// by default; with it on, after «Сдать» the child sees «Какое задание было
// самым интересным?» with the kinds of this homework's tasks and «Все
// классные», always with «Пропустить», then «Спасибо!». The answer counts
// for nothing. «Фидбэк» on the student card lists the answers with the
// homework and the date. The kinds are named in the child's words, not the
// editor's, and «Фидбэк» shows the same words. The question is asked after the first «Сдать»
// only, not after a homework reopened for the student; a homework whose
// tasks are all of one kind asks nothing, and the draft says so by the box
// (product owner, 2026-11-23). That no student or parent procedure returns
// the answers is pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts); the students open their
// links in fresh browsers without her cookies. The homework is synthetic
// (deploy/seed/homework/demo-short.json, demo-one-kind.json).
import { type Browser, type BrowserContextOptions, expect, type Page, test } from "@playwright/test";
import oneKind from "../../deploy/seed/homework/demo-one-kind.json" with { type: "json" };
import short from "../../deploy/seed/homework/demo-short.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };
const PRAISE = "Готово! Домашка сдана, учитель посмотрит";
const QUESTION = "Какое задание было самым интересным?";
const BOX = "Мини-вопрос после домашки";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A new student; returns their link, the card left open. */
async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

/** On the open card: imports a homework as a draft, ticks the box if asked, and publishes it. */
async function publish(page: Page, homework: unknown, ask: boolean) {
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  const box = page.getByRole("checkbox", { name: BOX });
  // Off by default.
  await expect(box).not.toBeChecked();
  if (ask) await box.check();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
}

async function openFresh(browser: Browser, link: string, storageState: BrowserContextOptions["storageState"] = NO_SESSION): Promise<Page> {
  const page = await (await browser.newContext({ storageState })).newPage();
  await page.goto(link);
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

async function start(student: Page, firstPrompt: string) {
  await expect(student.getByText(firstPrompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
}

/** demo-short.json: the odd one out, then a sentence, and «Сдать». */
async function doShort(student: Page) {
  const [odd, pet] = short.tasks as [(typeof short.tasks)[number], (typeof short.tasks)[number]];
  await start(student, odd.prompt);
  await student.getByRole("button", { name: "apple", exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(student.getByText(pet.prompt)).toBeVisible();
  await student.getByLabel("Ваш ответ").fill("My cat sleeps all day.");
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
}

/** «Фидбэк» on the student card. */
async function feedback(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await page.getByRole("link", { name: firstName }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.getByRole("region", { name: "Фидбэк" });
}

test("with the box ticked the child picks the most interesting kind of task after «Сдать», and «Фидбэк» shows it", async ({ page, browser }) => {
  const link = await createStudent(page, "Любознательный");
  await publish(page, short, true);

  const student = await openFresh(browser, link);
  await doShort(student);
  const question = student.getByRole("region", { name: QUESTION });
  await expect(question).toBeVisible();
  // The kinds of this homework's tasks, «Все классные» and «Пропустить»: nothing else.
  await expect(question.getByRole("button")).toHaveText(["Выбрать ответ", "Написать", "Все классные", "Пропустить"]);
  await question.getByRole("button", { name: "Написать", exact: true }).click();
  await expect(student.getByText("Спасибо!")).toBeVisible();
  await expect(student.getByRole("region", { name: QUESTION })).toHaveCount(0);
  // The answer changes nothing of the praise.
  await expect(student.getByText(PRAISE)).toBeVisible();
  const studentState = await student.context().storageState();
  await student.context().close();

  const answers = (await feedback(page, "Любознательный")).getByRole("listitem");
  await expect(answers).toHaveCount(1);
  await expect(answers.first()).toContainText(short.title);
  await expect(answers.first()).toContainText("Написать");
  await expect(answers.first()).toContainText(/\d{1,2} [а-я]+/);

  // Reopened for the student, the next «Сдать» asks nothing.
  await page.goto("/teacher/students");
  await page.getByRole("link", { name: /Проверка домашек/ }).click();
  await page.getByLabel("Ученик").selectOption({ label: "Любознательный" });
  await page.getByRole("listitem").filter({ hasText: "Любознательный" }).getByRole("link").first().click();
  await page.getByRole("button", { name: "Открыть заново для ученика", exact: true }).click();
  await expect(page.getByText("Открыта заново")).toBeVisible();

  const again = await openFresh(browser, new URL(link).origin + "/s", studentState);
  await doShort(again);
  await expect(again.getByText(PRAISE)).toBeVisible();
  await expect(again.getByText(QUESTION)).toHaveCount(0);
  await again.context().close();
  await expect((await feedback(page, "Любознательный")).getByRole("listitem")).toHaveCount(1);
});

test("«Пропустить» leaves no answer", async ({ page, browser }) => {
  const link = await createStudent(page, "Торопыга");
  await publish(page, short, true);

  const student = await openFresh(browser, link);
  await doShort(student);
  await student.getByRole("region", { name: QUESTION }).getByRole("button", { name: "Пропустить", exact: true }).click();
  await expect(student.getByRole("region", { name: QUESTION })).toHaveCount(0);
  await expect(student.getByText(PRAISE)).toBeVisible();
  await student.context().close();

  const section = await feedback(page, "Торопыга");
  await expect(section.getByRole("listitem")).toHaveCount(0);
  await expect(section).toContainText("Ответов пока нет");
});

test("a homework published without the box asks nothing after «Сдать»", async ({ page, browser }) => {
  const link = await createStudent(page, "Без вопроса");
  await publish(page, short, false);

  const student = await openFresh(browser, link);
  await doShort(student);
  await expect(student.getByText(PRAISE)).toBeVisible();
  await expect(student.getByText(QUESTION)).toHaveCount(0);
  await student.context().close();
});

test("a homework of one kind of task asks nothing, and the draft says so by the box", async ({ page, browser }) => {
  const link = await createStudent(page, "Однообразный");
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(oneKind));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByRole("checkbox", { name: BOX }).check();
  await expect(page.getByText(/одного вида/)).toBeVisible();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const [grass, number] = oneKind.tasks as [(typeof oneKind.tasks)[number], (typeof oneKind.tasks)[number]];
  const student = await openFresh(browser, link);
  await start(student, grass.prompt);
  await student.getByRole("button", { name: "green", exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(student.getByText(number.prompt)).toBeVisible();
  await student.getByRole("button", { name: "three", exact: true }).click();
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText(PRAISE)).toBeVisible();
  await expect(student.getByText(QUESTION)).toHaveCount(0);
  await student.context().close();
});
