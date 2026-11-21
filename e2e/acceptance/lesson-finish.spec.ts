// Acceptance for #154: «Завершить урок» — one form at the end of the lesson,
// and the student's vocabulary. During the lesson the teacher adds the words
// written on the board to «Слова урока» on the panel: a word and its
// translation, which may be left empty. «Завершить урок» is one form: the
// lesson held (charged as in #82), the note, the book lesson covered (the
// plan's, changeable), the lesson's homework published with a deadline (the
// next lesson's date by default) and the words. Afterwards the panel goes to
// the student's card and the stage says the lesson is over (product owner,
// 2026-11-19). The card's «Словарь» has the book lesson's words and the
// panel's; the assistant's student context has them; the student sees them
// in «Тренировка слов», not on the homework page (#236). The next preparation
// proposes the next book lesson.
//
// A form that fails halfway applies nothing: that is an integration test.
//
// The teacher starts signed in (sessions.setup.ts). The textbook, the words
// and the homework are synthetic, made here.
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

// A student's or the assistant's client has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const DAY = 86_400_000;
const BOOK = "Demo Finish Book";
const HOMEWORK = "Finish homework";
const NOTE = "Practised the past simple, read the text twice";
const HINT = "В Телемосте покажите окно «Экран для ученика» и включите звук";

/** A PDF of `pages` pages, each saying its number. */
function pdf(pages: number): Buffer {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  const font = 3 + pages * 2;
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 48 Tf 72 700 Td (Page ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

async function agentCall(request: APIRequestContext, token: string, procedure: string, input: unknown) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const response = await request.post(`/api/trpc/${procedure}`, { headers, data: JSON.stringify(input) });
  return response.status();
}

async function studentContext(request: APIRequestContext, token: string, studentId: string): Promise<string> {
  const input = encodeURIComponent(JSON.stringify({ studentId }));
  const response = await request.get(`/api/trpc/agent.studentContext?input=${input}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  return JSON.stringify(await response.json());
}

/** The assistant's token, from «Ассистент». */
async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const tokenField = page.getByLabel("Токен ассистента");
  await expect(tokenField).not.toHaveValue("");
  return tokenField.inputValue();
}

/** A set of a six-page Student's Book with a confirmed unit: 1.1, then 1.2 with two words, then 1.3. */
async function textbook(page: Page, assistant: APIRequestContext, token: string) {
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(BOOK);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: pdf(6) });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: BOOK })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("region", { name: "Student's Book" }).getByText("Готов", { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const textbookId = page.url().split("/").at(-1)!;
  const structure = {
    units: [
      {
        title: "Unit 1",
        lessons: [
          { title: "1.1", pages: { students_book: { from: 1, to: 2 } }, tracks: [], words: [] },
          { title: "1.2", pages: { students_book: { from: 3, to: 4 } }, tracks: [], words: ["lantern", "pebble"] },
          { title: "1.3", pages: { students_book: { from: 5, to: 6 } }, tracks: [], words: [] },
        ],
      },
    ],
  };
  expect(await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).toBe(200);
  await page.reload();
  await page.getByRole("region", { name: "Структура" }).getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("region", { name: "Структура" })).toContainText("Подтверждена");
}

/** «+ Урок» for this many days ahead. */
async function addLesson(page: Page, firstName: string, days: number, time: string) {
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(new Date(Date.now() + days * DAY)));
  await page.getByLabel("Время", { exact: true }).fill(time);
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
}

/**
 * A student on the textbook with 1.1 passed, a homework draft, a lesson
 * tomorrow and another in eight days. The lesson tomorrow is prepared: 1.2,
 * with the homework draft attached. Returns the card's address and the link.
 */
async function preparedStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  const block = page.getByRole("region", { name: "Учебник ученика" });
  await block.getByLabel("Учебник").selectOption({ label: BOOK });
  await block.getByLabel("Пройденный урок").selectOption({ label: "Unit 1 · 1.1" });
  await block.getByRole("button", { name: "Сохранить учебник", exact: true }).click();
  await expect(block.getByText("Сохранено")).toBeVisible();

  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(
    JSON.stringify({ version: 1, title: HOMEWORK, tasks: [{ type: "single_choice", prompt: "Pick the first.", options: ["a", "b"], answer: 0 }] }),
  );
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  // Saved before the scenario moves on: the import opens the new draft's page.
  await expect(page).toHaveURL(/\/teacher\/students\/[0-9a-f-]{36}\/homework\/[0-9a-f-]{36}$/);

  await addLesson(page, firstName, 1, "10:00");
  await addLesson(page, firstName, 8, "10:00");

  await openPreparation(page, firstName);
  await expect(stages(page).first()).toContainText("Student's Book: 1.2");
  await page.getByRole("region", { name: "Домашка к уроку" }).getByLabel("Черновик домашки").selectOption({ label: HOMEWORK });
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();
  return { card, link };
}

/** The preparation of the student's nearest upcoming lesson. */
async function openPreparation(page: Page, firstName: string) {
  await page.goto("/teacher/prep");
  await page.getByRole("list", { name: "Предстоящие уроки" }).getByRole("listitem").filter({ hasText: firstName }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
}

const stages = (page: Page) => page.getByRole("list", { name: "План урока" }).getByRole("listitem");

/** «Запустить урок»: the panel in this tab, the stage in a new window. Returns the stage. */
async function launch(page: Page): Promise<Page> {
  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();
  await expect(page.getByText(HINT)).toBeVisible();
  return stage;
}

/** Adds a word to «Слова урока» on the panel. */
async function addWord(page: Page, word: string, translation = "") {
  const words = page.getByRole("region", { name: "Слова урока" });
  await words.getByLabel("Слово", { exact: true }).fill(word);
  await words.getByLabel("Перевод", { exact: true }).fill(translation);
  await words.getByRole("button", { name: "Добавить слово", exact: true }).click();
  await expect(words.getByRole("listitem").filter({ hasText: word })).toHaveCount(1);
}

test("«Завершить урок» holds the lesson, publishes its homework and puts the words in the student's vocabulary", async ({
  page,
  browser,
  assistant,
}) => {
  const token = await createToken(page);
  await textbook(page, assistant, token);
  const { card, link } = await preparedStudent(page, "Ростислав");
  const studentId = card.split("/").at(-1)!;

  const stage = await launch(page);

  // Two words from the board: one with its translation, one without. Kept on a reloaded panel.
  await addWord(page, "orange", "апельсин");
  await addWord(page, "kettle");
  await page.reload();
  const words = page.getByRole("region", { name: "Слова урока" });
  await expect(words.getByRole("listitem")).toHaveCount(2);
  await expect(words).toContainText("апельсин");

  // One form: the book lesson of the plan, the note, the homework with the next lesson's date, the words.
  await control(page, "Завершить урок").click();
  const form = page.getByRole("dialog", { name: "Завершить урок" });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("Пройденный урок учебника").locator("option:checked")).toHaveText("Unit 1 · 1.2");
  await expect(form.getByLabel("Списать")).toBeChecked();
  await expect(form).toContainText(HOMEWORK);
  await expect(form.getByLabel("Срок")).toHaveValue(isoDate(new Date(Date.now() + 8 * DAY)));
  await expect(form).toContainText("orange");
  await expect(form).toContainText("kettle");
  await form.getByLabel("Заметка").fill(NOTE);
  await form.getByRole("button", { name: "Завершить урок", exact: true }).click();

  // The panel goes to the card; the stage says the lesson is over.
  await expect(page).toHaveURL(card);
  await expect(stage.getByText("Урок завершён")).toBeVisible();

  // Held, with the book lesson and the note.
  const held = page.getByRole("region", { name: "История уроков" }).getByRole("listitem").first();
  await expect(held).toContainText("проведён");
  await expect(held).toContainText("1.2");
  await expect(held).toContainText(NOTE);

  // The vocabulary: the book lesson's words and the panel's.
  const vocabulary = page.getByRole("region", { name: "Словарь" });
  for (const word of ["lantern", "pebble", "orange", "kettle"]) {
    await expect(vocabulary.getByRole("listitem").filter({ hasText: word })).toHaveCount(1);
  }
  await expect(vocabulary.getByRole("listitem").filter({ hasText: "orange" })).toContainText("апельсин");

  // The assistant reads them in the student context.
  const context = await studentContext(assistant, token, studentId);
  for (const word of ["lantern", "pebble", "orange", "kettle", "апельсин"]) expect(context).toContain(word);

  // The student has the lesson's homework by the link, due on the next lesson's day; the words are not on the homework page.
  // The student's page names a homework by its deadline and size, not its title.
  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect.poll(() => student.url()).not.toContain("#");
  await expect(student.getByText("1 задание")).toBeVisible();
  await expect(control(student, "Начать")).toBeVisible();
  const seen = await student.locator("body").innerText();
  for (const hidden of ["Словарь", "lantern", "orange", "kettle", NOTE]) expect(seen).not.toContain(hidden);
  // They are in «Тренировка слов» (#236), the translation with its word; never the note.
  await student.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Тренировка слов", exact: true }).click();
  const mine = student.getByRole("list", { name: "Мои слова" });
  for (const word of ["lantern", "pebble", "orange", "kettle"]) await expect(mine.getByRole("listitem").filter({ hasText: word })).toHaveCount(1);
  await expect(mine.getByRole("listitem").filter({ hasText: "orange" })).toContainText("апельсин");
  expect(await student.locator("body").innerText()).not.toContain(NOTE);
  await student.context().close();

  // The next preparation proposes the next lesson of the book.
  await openPreparation(page, "Ростислав");
  await expect(stages(page).first()).toContainText("Student's Book: 1.3");
});
