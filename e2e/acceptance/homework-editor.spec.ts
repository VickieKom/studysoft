// Acceptance for #37: the teacher fixes an imported draft in place instead of
// re-importing the whole JSON.
//
// The teacher's part starts signed in (sessions.setup.ts). The homework is
// synthetic (deploy/seed/homework/demo-editor.json); its first prompt has a
// typo on purpose.
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-editor.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

function control(page: Page | Locator, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function draftForNewStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByText("Черновик", { exact: true })).toBeVisible();
  return link;
}

/** A task of the preview, by a piece of its prompt. */
function task(page: Page, text: string): Locator {
  return page.getByRole("listitem").filter({ hasText: text });
}

/** The prompts of the preview, in order. */
async function prompts(page: Page): Promise<string[]> {
  return page.getByRole("listitem").evaluateAll((items) => items.map((item) => item.textContent ?? ""));
}

test("a typo is fixed and a second correct variant added; the student's answer in that variant counts", async ({
  page,
  browser,
}) => {
  const link = await draftForNewStudent(page, "Правка");

  await control(task(page, "Fil in the gap."), "Изменить задание").click();
  await page.getByLabel("Текст задания").fill("Fill in the gap.");
  // One accepted variant per line.
  await page.getByLabel("Ответы для пропуска 1").fill("is\n's");
  await page.getByRole("button", { name: "Сохранить задание", exact: true }).click();

  await expect(task(page, "Fill in the gap.")).toBeVisible();
  await expect(page.getByText("Fil in the gap.")).toHaveCount(0);
  await page.reload();
  await expect(task(page, "Fill in the gap.")).toBeVisible();

  // Publish and answer the gap with the new variant as the student.
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
  await answerOnlyTheGap(browser, link, "'s");
});

async function answerOnlyTheGap(browser: Browser, link: string, answer: string) {
  const student = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await student.goto(link);
  await expect(student.getByText("Fill in the gap.").or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  await student.getByRole("textbox").fill(answer);
  // The other tasks are left unanswered; submitting anyway is allowed (#34).
  for (;;) {
    const submit = student.getByRole("button", { name: "Сдать", exact: true });
    if (await submit.isVisible()) {
      await submit.click();
      break;
    }
    await student.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  // Confirming a submission with unanswered tasks, if the page asks.
  const confirm = student.getByRole("button", { name: "Всё равно сдать", exact: true });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(student.getByText(/1\s+верно/)).toBeVisible();
  await student.context().close();
}

test("a task is added, another deleted and one moved up", async ({ page }) => {
  await draftForNewStudent(page, "Порядок заданий");

  await page.getByLabel("Тип нового задания").selectOption({ label: "Выбор одного ответа" });
  await control(page, "Добавить задание").click();
  await page.getByLabel("Текст задания").fill("Pick a colour.");
  await page.getByLabel("Варианты").fill("blue\ntable");
  await page.getByLabel("blue").check();
  await page.getByRole("button", { name: "Сохранить задание", exact: true }).click();
  await expect(task(page, "Pick a colour.")).toBeVisible();

  await control(task(page, "Pick a fruit."), "Удалить задание").click();
  await expect(task(page, "Pick a fruit.")).toHaveCount(0);
  await control(task(page, "Pick a colour."), "Выше").click();

  await page.reload();
  const order = await prompts(page);
  expect(order).toHaveLength(3);
  expect(order[0]).toContain("Fil in the gap.");
  expect(order[1]).toContain("Pick a colour.");
  expect(order[2]).toContain("Write about your pet.");
});

test("an auto-checked task without a correct answer is not saved", async ({ page }) => {
  await draftForNewStudent(page, "Без ответа");

  await control(task(page, "Fil in the gap."), "Изменить задание").click();
  await page.getByLabel("Ответы для пропуска 1").fill("");
  await page.getByRole("button", { name: "Сохранить задание", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /ответ/i })).toBeVisible();

  await page.reload();
  await control(task(page, "Fil in the gap."), "Изменить задание").click();
  await expect(page.getByLabel("Ответы для пропуска 1")).toHaveValue("is");
});

test("a published homework has no edit controls", async ({ page }) => {
  await draftForNewStudent(page, "Опубликованная");
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  for (const name of ["Изменить задание", "Удалить задание", "Выше", "Добавить задание"]) {
    await expect(control(page, name)).toHaveCount(0);
  }
});
