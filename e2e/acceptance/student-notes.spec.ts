// Acceptance for #42: the teacher keeps dated notes on a student's card.
//
// Every scenario starts signed in (sessions.setup.ts). Notes are synthetic.
import { expect, test, type Page } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });

function control(page: Page, name: string) {
  return page.getByRole("link", { name }).or(page.getByRole("button", { name }));
}

/** Creates a student through the form and returns the address of the card. */
async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  return page.url();
}

async function addNote(page: Page, text: string) {
  await page.getByLabel("Новая заметка").fill(text);
  await page.getByRole("button", { name: "Добавить заметку" }).click();
  await expect(note(page, text)).toBeVisible();
}

/** A note of the feed: one list item on the card. */
function note(page: Page, text: string) {
  return page.getByRole("listitem").filter({ hasText: text });
}

/** Today as the teacher's browser shows a date: "12 ноября". */
async function today(page: Page): Promise<string> {
  return page.evaluate(() => new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" }));
}

test("a note is saved with today's date and survives a reload", async ({ page }) => {
  const card = await createStudent(page, "Заметки");
  await addNote(page, "Путает he и she, повторить");

  await expect(note(page, "Путает he и she, повторить")).toContainText(await today(page));
  await expect(page.getByLabel("Новая заметка")).toHaveValue("");

  await page.goto(card);
  await expect(note(page, "Путает he и she, повторить")).toBeVisible();
});

test("the newest note is at the top of the feed", async ({ page }) => {
  await createStudent(page, "Порядок");
  await addNote(page, "Первая заметка");
  await addNote(page, "Вторая заметка");

  await expect(page.getByRole("listitem").first()).toContainText("Вторая заметка");
  await expect(page.getByRole("listitem").nth(1)).toContainText("Первая заметка");
});

test("a note can be edited and another deleted", async ({ page }) => {
  // Deleting may or may not ask for confirmation; accept it if it does.
  page.on("dialog", (dialog) => dialog.accept());
  const card = await createStudent(page, "Правка");
  await addNote(page, "Исправить меня");
  await addNote(page, "Удалить меня");

  await note(page, "Исправить меня").getByRole("button", { name: "Изменить заметку" }).click();
  await page.getByLabel("Текст заметки").fill("Исправленная заметка");
  await page.getByRole("button", { name: "Сохранить заметку" }).click();
  await expect(note(page, "Исправленная заметка")).toBeVisible();

  await note(page, "Удалить меня").getByRole("button", { name: "Удалить заметку" }).click();
  await expect(note(page, "Удалить меня")).toHaveCount(0);

  await page.goto(card);
  await expect(note(page, "Исправленная заметка")).toBeVisible();
  await expect(page.getByText("Исправить меня")).toHaveCount(0);
  await expect(page.getByText("Удалить меня")).toHaveCount(0);
});

test("another teacher sees none of the notes", async ({ page, browser }) => {
  const card = await createStudent(page, "Чужие заметки");
  await addNote(page, "Секретная заметка");

  const context = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const other = await context.newPage();
  const response = await other.goto(card);

  expect(response?.ok()).toBe(false);
  await expect(other.getByText("Секретная заметка")).toHaveCount(0);
  await context.close();
});
