// Acceptance for #424: the assistant's student context carries the latest
// past lessons — held or missed, never cancelled — newest first, so the next
// plan does not repeat yesterday's warm-up and picks up what the student
// struggled with. A lesson held in the lesson mode has its plan's stages (the
// book lesson with the exercises skipped, the warm-up), the note and the
// lesson's words; a lesson only marked on the card has its date, status,
// unit and note, and no stages.
//
// Every lesson here is in the past: a lesson finished before its time would
// move to the moment it was finished (#154) and stay going on for the
// scenarios after this one. A past lesson is prepared from its dialog on the
// week, «Подготовка к уроку».
//
// That another teacher's assistant gets NOT_FOUND and that no student or
// parent procedure returns a lesson's note is an integration test.
//
// The teacher starts signed in (sessions.setup.ts); her time zone and the
// student's are Moscow. The assistant's calls are the HTTP calls the MCP
// server makes with the token. The textbook, the warm-up and the notes are
// synthetic, made here. Helpers follow lesson-finish.spec.ts and
// lesson-marks.spec.ts; those files are not touched.
import { type APIRequestContext, expect, type Locator, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
// One token per teacher and her time zone are shared with other scenario files.
test.describe.configure({ mode: "serial" });

const DAY = 86_400_000;
const BOOK = "Demo History Book";
const WARMUP = "History warm-up";
const PANEL_NOTE = "Mixed up was and were, repeat next time";
const CARD_NOTE = "Synthetic note of a lesson marked on the card";
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

/** A calendar date in Moscow, `days` from today. */
function moscowDate(days: number): Date {
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(Date.now() + days * DAY));
  return new Date(`${iso}T12:00:00Z`);
}

/** How the week names a day: «вторник, 17 ноября». */
const dayLabel = (date: Date) =>
  date.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

type Stage = { kind: string; title: string | null; skip?: string };
type PastLesson = {
  date: string;
  status: "held" | "missed";
  intro: boolean;
  bookLesson: string | null;
  stages: Stage[];
  note: string | null;
  words: string[];
};

async function agentCall(request: APIRequestContext, token: string, procedure: string, input: unknown) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const response = await request.post(`/api/trpc/${procedure}`, { headers, data: JSON.stringify(input) });
  return response.status();
}

async function studentContext(request: APIRequestContext, token: string, studentId: string) {
  const input = encodeURIComponent(JSON.stringify({ studentId }));
  const response = await request.get(`/api/trpc/agent.studentContext?input=${input}`, { headers: { authorization: `Bearer ${token}` } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return body.result.data.recentLessons as PastLesson[];
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const tokenField = page.getByLabel("Токен ассистента");
  await expect(tokenField).not.toHaveValue("");
  return tokenField.inputValue();
}

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** A set of a six-page Student's Book with a confirmed unit: 1.1, then 1.2 with a word, then 1.3. */
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
          { title: "1.2", pages: { students_book: { from: 3, to: 4 } }, tracks: [], words: ["lantern"] },
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

async function warmup(page: Page) {
  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Разминка" });
  await page.getByLabel("Формат разминки").selectOption({ label: "Вопросы" });
  await page.getByLabel("Вопросы").fill("What did you do yesterday?");
  await page.getByLabel("Название").fill(WARMUP);
  await page.getByLabel("Уровень").selectOption({ label: "A2" });
  await page.getByLabel("Тема").fill("lesson history");
  await page.getByLabel("Возраст").selectOption({ label: "младшие" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();
}

async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const block = page.getByRole("region", { name: "Учебник ученика" });
  await block.getByLabel("Учебник").selectOption({ label: BOOK });
  await block.getByLabel("Пройденный урок").selectOption({ label: "Unit 1 · 1.1" });
  await block.getByRole("button", { name: "Сохранить учебник", exact: true }).click();
  await expect(block.getByText("Сохранено")).toBeVisible();
  return page.url().split("/").at(-1)!;
}

/** «+ Урок» on «Расписание» on that Moscow date at 10:00. */
async function addLesson(page: Page, firstName: string, date: Date) {
  await page.goto("/teacher/schedule");
  await control(page, "+ Урок").click();
  await page.getByLabel("Ученик").selectOption({ label: firstName });
  await page.getByLabel("Дата").fill(isoDate(date));
  await page.getByLabel("Время", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Сохранить урок", exact: true }).click();
  await expect(control(page, "+ Урок")).toBeVisible();
}

/** Opens «Расписание» on the week that shows this date. */
async function openWeekWith(page: Page, date: Date): Promise<Locator> {
  await page.goto("/teacher/schedule");
  await expect(page.getByRole("heading", { level: 1, name: "Расписание" })).toBeVisible();
  const step = date < moscowDate(0) ? "Предыдущая неделя" : "Следующая неделя";
  const day = page.getByRole("region", { name: dayLabel(date) });
  for (let i = 0; i < 6 && !(await day.isVisible()); i++) {
    const shown = await page.getByRole("region").first().getAttribute("aria-label");
    await page.getByRole("button", { name: step, exact: true }).click();
    await expect(page.getByRole("region").first()).not.toHaveAttribute("aria-label", shown ?? "");
  }
  await expect(day).toBeVisible();
  return day;
}

async function openLesson(page: Page, date: Date, firstName: string) {
  const day = await openWeekWith(page, date);
  await day.getByRole("button", { name: new RegExp(firstName) }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return { day, dialog };
}

/** Marks the lesson on that date on the week, as in #82. */
async function mark(page: Page, date: Date, firstName: string, status: "Проведён" | "Пропущен", fields: { unit?: string; note?: string } = {}) {
  const { day, dialog } = await openLesson(page, date, firstName);
  await dialog.getByLabel(status, { exact: true }).check();
  if (fields.unit !== undefined) await dialog.getByLabel("Юнит").fill(fields.unit);
  if (fields.note !== undefined) await dialog.getByLabel("Заметка").fill(fields.note);
  await dialog.getByRole("button", { name: "Сохранить отметку", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(day.getByRole("button", { name: new RegExp(firstName) })).toContainText(status.toLowerCase());
}

const stages = (page: Page) => page.getByRole("list", { name: "План урока" }).getByRole("listitem");

/** Prepares the student's lesson on that date from its dialog: the warm-up first, then book lesson 1.2 with exercise «3» skipped. */
async function prepare(page: Page, date: Date, firstName: string) {
  const { dialog } = await openLesson(page, date, firstName);
  await dialog.getByRole("link", { name: "Подготовка к уроку", exact: true }).click();
  await expect(page).toHaveURL(/\/teacher\/prep\/[0-9a-f-]{36}$/);
  await expect(stages(page).first()).toContainText("Student's Book: 1.2");
  await page.getByLabel("Добавить из библиотеки").selectOption({ label: WARMUP });
  await control(page, "Добавить этап").click();
  await stages(page).filter({ hasText: WARMUP }).getByRole("button", { name: "Выше", exact: true }).click();
  await expect(stages(page).first()).toContainText(WARMUP);
  await stages(page).filter({ hasText: "Student's Book" }).getByLabel("Пропустить упражнения").fill("3");
  await control(page, "Сохранить план").click();
  await expect(page.getByText("План сохранён")).toBeVisible();
}

/** Runs the prepared lesson: a note and a word on the panel, then «Завершить урок» with the note the form proposes. */
async function holdLesson(page: Page) {
  const opened = page.context().waitForEvent("page");
  await control(page, "Запустить урок").click();
  const stage = await opened;
  await expect(stage.getByRole("tablist", { name: "Этапы урока" })).toBeVisible();
  await expect(page.getByText(HINT)).toBeVisible();

  await page.getByLabel("Заметка к уроку").fill(PANEL_NOTE);
  await expect(page.getByText("Заметка сохранена")).toBeVisible();
  const words = page.getByRole("region", { name: "Слова урока" });
  await words.getByLabel("Слово", { exact: true }).fill("kettle");
  await words.getByRole("button", { name: "Добавить слово", exact: true }).click();
  await expect(words.getByRole("listitem").filter({ hasText: "kettle" })).toHaveCount(1);

  await control(page, "Завершить урок").click();
  const form = page.getByRole("dialog", { name: "Завершить урок" });
  await expect(form.getByLabel("Заметка")).toHaveValue(PANEL_NOTE);
  await form.getByRole("button", { name: "Завершить урок", exact: true }).click();
  await expect(stage.getByText("Урок завершён")).toBeVisible();
  await stage.close();
}

test.beforeEach(async ({ page }) => {
  await setTeacherTimeZone(page, "Москва");
});

test("the context lists the latest held and missed lessons, newest first, with the plan's stages, the note and the words; never a cancelled one", async ({
  page,
  assistant,
}) => {
  const token = await createToken(page);
  await textbook(page, assistant, token);
  await warmup(page);
  const studentId = await createStudent(page, "Историк");

  // Four days ago: held, marked on the card only, with a unit and a note.
  const marked = moscowDate(-4);
  await addLesson(page, "Историк", marked);
  await mark(page, marked, "Историк", "Проведён", { unit: "Unit 1 · 1.1", note: CARD_NOTE });
  // Yesterday: missed.
  const missed = moscowDate(-1);
  await addLesson(page, "Историк", missed);
  await mark(page, missed, "Историк", "Пропущен");
  // Three days ago: cancelled.
  const cancelled = moscowDate(-3);
  await addLesson(page, "Историк", cancelled);
  const { day, dialog } = await openLesson(page, cancelled, "Историк");
  await dialog.getByRole("button", { name: "Отменить", exact: true }).click();
  await dialog.getByRole("button", { name: "Отменить урок", exact: true }).click();
  await expect(day.getByRole("button", { name: /Историк/ })).toContainText("отменён");

  // Two days ago: prepared and held in the lesson mode.
  const prepared = moscowDate(-2);
  await addLesson(page, "Историк", prepared);
  await prepare(page, prepared, "Историк");
  await holdLesson(page);

  const lessons = await studentContext(assistant, token, studentId);
  expect(lessons.map((l) => l.status)).toEqual(["missed", "held", "held"]);
  const [skipped, held, onCard] = lessons;

  expect(held).toMatchObject({ intro: false, bookLesson: "Unit 1 · 1.2", note: PANEL_NOTE });
  expect(isoDate(new Date(held!.date))).toBe(isoDate(prepared));
  expect(held!.stages).toEqual([
    { kind: "warmup", title: WARMUP },
    { kind: "book", title: "Unit 1 · 1.2", skip: "3" },
  ]);
  expect([...held!.words].sort()).toEqual(["kettle", "lantern"]);

  expect(skipped).toMatchObject({ status: "missed", bookLesson: null, stages: [], note: null, words: [] });
  expect(isoDate(new Date(skipped!.date))).toBe(isoDate(missed));

  expect(onCard).toMatchObject({ status: "held", bookLesson: "Unit 1 · 1.1", stages: [], note: CARD_NOTE, words: [] });
  expect(isoDate(new Date(onCard!.date))).toBe(isoDate(marked));
});
