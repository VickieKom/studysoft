// Acceptance for #227: the automatic check has incomplete keys more often
// than it seems, and the teacher decides what is really a mistake (product
// owner, 2026-11-17 and 2026-11-20). So after «Сдать» the child is praised
// without a score — no digits, no «верно» or «неверно», nothing per task —
// and the parent sees no score either. The teacher keeps the score in
// «Проверка домашек»; mistakes are reviewed in the lesson (#153).
//
// The teacher starts signed in (sessions.setup.ts); the student and the
// parent open their links in fresh browsers without her cookies. The
// homework is synthetic (deploy/seed/homework/demo-review.json).
import { type Browser, expect, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-review.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };
const PRAISE = "Готово! Домашка сдана, учитель посмотрит";
const [sky, gap, animals, day] = homework.tasks as [
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
  (typeof homework.tasks)[number],
];

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function copyLink(page: Page, name: "Ссылка ученика" | "Ссылка родителя"): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, name).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

async function openFresh(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await page.goto(link);
  await expect.poll(() => page.url()).not.toContain("#");
  return page;
}

test("after «Сдать» the child is praised without a score, the parent sees none, the teacher keeps it", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Беззачётный");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Беззачётный" })).toBeVisible();
  const studentLink = await copyLink(page, "Ссылка ученика");
  const parentLink = await copyLink(page, "Ссылка родителя");
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  // The student does it with one mistake, «are» in the gap.
  const student = await openFresh(browser, studentLink);
  await expect(student.getByText(sky.prompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  await student.getByRole("button", { name: "blue", exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(student.getByText(gap.prompt)).toBeVisible();
  await student.getByLabel("Пропуск 1").fill("are");
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(student.getByText(animals.prompt)).toBeVisible();
  await student.getByRole("button", { name: "cat", exact: true }).click();
  await student.getByRole("button", { name: "dog", exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();
  await expect(student.getByText(day.prompt)).toBeVisible();
  await student.getByLabel("Ваш ответ").fill("I read a book.");
  await student.getByRole("button", { name: "Сдать", exact: true }).click();

  // Praise, and no score at all: no «верно», no digits, no task.
  await expect(student.getByText(PRAISE)).toBeVisible();
  const shown = await student.locator("main").innerText();
  expect(shown).not.toMatch(/верно|\d/);
  for (const task of [sky, gap, animals, day]) expect(shown).not.toContain(task.prompt);
  await student.context().close();

  // The parent sees no score either.
  const parent = await openFresh(browser, parentLink);
  await expect(parent.getByText("Успехи Беззачётный")).toBeVisible();
  expect(await parent.locator("body").innerText()).not.toMatch(/верно/);
  await parent.context().close();

  // The teacher keeps it.
  await page.goto("/teacher/homework-review");
  await page.getByLabel("Ученик").selectOption({ label: "Беззачётный" });
  await expect(page.getByRole("listitem").filter({ hasText: "Беззачётный" })).toContainText("2 верно, 1 неверно");
});
