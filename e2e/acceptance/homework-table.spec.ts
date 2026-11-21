// Acceptance for #186, the last slice of #129: a workbook exercise laid out
// as a table. The header holds pictures with captions; the body holds text
// (a printed ✓ or ✗ included), marks the student sets to ✓ or ✗, and gaps to
// type in. The interface draws the grid. The marks and gaps are checked
// together, as the gaps of a gap task are: the task is one point. Nothing the
// student's page receives before submission holds a key or a stored file. A
// picture of another type in the header is refused at import, naming the
// task and the cell, and nothing is saved.
//
// The teacher starts signed in (sessions.setup.ts). The homework and its
// pictures are synthetic (deploy/seed/homework/demo-table.json).
import { expect, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-table.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

// A student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const [task] = homework.tasks;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** The submission's row in «Проверка домашек»: the score is the teacher's; the student sees none (#227). */
async function reviewRow(page: Page, firstName: string) {
  await page.goto("/teacher/homework-review");
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  const row = page.getByRole("listitem").filter({ hasText: firstName });
  await expect(row).toHaveCount(1);
  return row;
}

async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return { card, link: await page.evaluate(() => navigator.clipboard.readText()) };
}

async function importHomework(page: Page, document: unknown) {
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(document));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
}

/** A cell the student fills, named by its row and column in the body, from 1. */
const cell = (row: number, column: number) => `Строка ${row}, столбец ${column}`;

test("a table with pictures in its header, marks and gaps; filled and checked as one task", async ({ page, browser }) => {
  const { link } = await createStudent(page, "Таблица");
  await importHomework(page, homework);

  // The teacher's preview draws the table with its two pictures.
  const preview = page.getByRole("main").getByRole("table");
  await expect(preview).toBeVisible();
  await expect(preview.getByRole("img")).toHaveCount(2);
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  const received: string[] = [];
  student.on("response", async (response) => {
    if (response.url().includes("/api/trpc/")) received.push(await response.text().catch(() => ""));
  });
  await student.goto(link);
  await expect(student.getByText(task!.prompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();

  await expect(student.getByRole("heading", { level: 1 })).toHaveText(task!.prompt);
  const table = student.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveCount(3);
  await expect(table.getByRole("columnheader", { name: /Square A/ }).getByRole("img")).toHaveCount(1);
  await expect(table.getByRole("columnheader", { name: /Square B/ }).getByRole("img")).toHaveCount(1);
  await expect(table.getByRole("row")).toHaveCount(4);
  // The printed marks are text, not something to set.
  await expect(table.getByRole("row").nth(2)).toContainText("✗");
  await expect(table.getByRole("group", { name: cell(2, 2), exact: true })).toHaveCount(0);

  const src = await table.getByRole("img").first().getAttribute("src");
  expect(src).toMatch(/^\/api\/files\/homework\//);
  expect((await student.request.get(new URL(src!, student.url()).toString())).status()).toBe(200);

  // Nothing received before submission held a key or a stored file.
  const before = received.join("\n");
  expect(before).not.toMatch(/"mark":|"gap":|dark blue/);
  expect(before).not.toContain("blob:");
  expect(before).not.toContain("data:image");

  await table.getByRole("group", { name: cell(1, 2), exact: true }).getByRole("button", { name: "✓", exact: true }).click();
  await table.getByRole("group", { name: cell(1, 3), exact: true }).getByRole("button", { name: "✗", exact: true }).click();
  await table.getByRole("textbox", { name: cell(3, 2), exact: true }).fill("Red");
  await table.getByRole("textbox", { name: cell(3, 3), exact: true }).fill("dark blue");
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText("Домашка сдана")).toBeVisible();
  // The score is the teacher's (#227).
  await expect(await reviewRow(page, "Таблица")).toContainText("1 верно, 0 неверно");
  await student.context().close();
});

test("a picture of another type in the header is refused at import, naming the task and the cell, and nothing is saved", async ({ page }) => {
  const { card } = await createStudent(page, "Не та картинка в таблице");
  const gif = `data:image/gif;base64,${Buffer.from("GIF89a not allowed").toString("base64")}`;
  await importHomework(page, {
    version: 1,
    title: "Demo: a GIF in a table",
    tasks: [{ type: "table", prompt: "Fill in.", header: ["", { images: [gif] }], rows: [["one", { gap: ["1"] }]] }],
  });
  const message = page.getByRole("alert").filter({ hasText: "Задание 1" });
  await expect(message).toContainText("шапка, столбец 2");
  await page.goto(card);
  await expect(page.getByRole("region", { name: "Домашки" }).getByRole("listitem")).toHaveCount(0);
});
