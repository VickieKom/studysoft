// Acceptance for #131: a task carried over from a workbook keeps the book's
// layout. The instruction is the heading; a reading text is its own part in
// regular type with its line breaks, shown above every task that uses it; an
// example is shown with its answer, marked as an example, with no field and
// not counted. The teacher's preview lays the parts out the same way, and
// nothing the student's page receives before submission holds a key.
//
// The teacher starts signed in (sessions.setup.ts). The homework is synthetic
// (deploy/seed/homework/demo-layout.json).
import { expect, type Page, test } from "@playwright/test";
import layout from "../../deploy/seed/homework/demo-layout.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

// A student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

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

type Choice = { prompt: string; passage: string; options: string[]; answer: number };
type Gap = { prompt: string; example: { text: string; answer: string } };
const [blog, blogAgain, gap] = layout.tasks as unknown as [Choice, Choice, Gap];
const passageLines = blog.passage.split("\n").filter((line) => line !== "");

test("instruction, reading text and example are parts of their own, for the teacher and for the student", async ({
  page,
  browser,
}) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Тетрадный");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Тетрадный" })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(layout, null, 2));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();

  // The teacher's preview: the reading text and the example are there, apart from the instruction.
  const preview = page.getByRole("main");
  await expect(preview.getByText(blog.prompt, { exact: true })).toBeVisible();
  await expect(preview.getByText(passageLines[1]!, { exact: false }).first()).toBeVisible();
  await expect(preview.getByText("Пример").first()).toBeVisible();
  await expect(preview.getByText(gap.example.text.replace("___", gap.example.answer), { exact: false })).toBeVisible();

  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  const received: string[] = [];
  student.on("response", async (response) => {
    if (response.url().includes("/api/trpc/")) received.push(await response.text().catch(() => ""));
  });
  await student.goto(link);
  await expect(student.getByText(blog.prompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();

  // Task 1: the instruction alone is the heading; the text is below it, in its own lines.
  await expect(student.getByRole("heading", { level: 1 })).toHaveText(blog.prompt);
  const reading = student.getByRole("region", { name: "Текст" });
  for (const line of passageLines) await expect(reading).toContainText(line);
  expect(await reading.evaluate((element) => getComputedStyle(element).fontWeight)).toBe("400");
  await student.getByRole("button", { name: blog.options[blog.answer]!, exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();

  // Task 2 shares the text: it is above this task too.
  await expect(student.getByRole("heading", { level: 1 })).toHaveText(blogAgain.prompt);
  for (const line of passageLines) await expect(student.getByRole("region", { name: "Текст" })).toContainText(line);
  await student.getByRole("button", { name: blogAgain.options[blogAgain.answer]!, exact: true }).click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();

  // Task 3: the example with its answer, marked, without a field of its own.
  await expect(student.getByRole("heading", { level: 1 })).toHaveText(gap.prompt);
  const example = student.getByRole("region", { name: "Пример" });
  await expect(example).toContainText(gap.example.text.replace("___", gap.example.answer));
  await expect(example.getByRole("textbox")).toHaveCount(0);
  await expect(student.getByRole("textbox")).toHaveCount(1);
  await student.getByRole("textbox").fill("are");
  await student.getByRole("button", { name: "Сдать", exact: true }).click();

  // Three tasks, three right: the example is not counted.
  await expect(student.getByText("Домашка сдана")).toBeVisible();
  // The score is the teacher's (#227); the example is not a task.
  const row = await reviewRow(page, "Тетрадный");
  await expect(row).toContainText("3 верно");
  await expect(row).not.toContainText("4 верно");

  // Nothing the page received held a key: the gap's other accepted answer never came.
  expect(received.join("\n")).not.toContain("'re");
  await student.context().close();
});
