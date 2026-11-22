// Acceptance for #291: a game is linked to a lesson of the teacher's
// textbook in the library form — the textbook, then the lesson with its
// unit. «Библиотека» filters by «Учебник», then «Урок»; the material's page
// shows the link; an edit removes it. The assistant saves a game draft for a
// lesson and reads, in the textbook's structure, the games of each lesson; a
// lesson not in the structure is refused. A lesson removed from the
// structure later, and another teacher's textbook, are pinned by
// integration tests.
//
// The teacher starts signed in (sessions.setup.ts). The textbook and the
// games are synthetic, made here.
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION });

const game = (name: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title></head><body><h1>${name}</h1></body></html>`;

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

function materials(page: Page) {
  return page.getByRole("list", { name: "Материалы" }).getByRole("listitem");
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

async function agentCall(request: APIRequestContext, token: string, procedure: string, input: unknown, query = false) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const response = query
    ? await request.get(`/api/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers })
    : await request.post(`/api/trpc/${procedure}`, { headers, data: JSON.stringify(input) });
  return { status: response.status(), body: await response.json() };
}

/** A textbook of six pages with a confirmed unit of lessons 1.1–1.3, saved by the assistant and confirmed by the teacher. */
async function textbookWithLessons(page: Page, assistant: APIRequestContext, token: string, title: string) {
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "book.pdf", mimeType: "application/pdf", buffer: pdf(6) });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("region", { name: "Student's Book" }).getByText("Готов", { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const textbookId = page.url().split("/").at(-1)!;
  const lesson = (name: string, from: number) => ({ title: name, pages: { students_book: { from, to: from + 1 } }, tracks: [], words: [] });
  const structure = { units: [{ title: "Unit 1", lessons: [lesson("1.1", 1), lesson("1.2", 3), lesson("1.3", 5)] }] };
  expect((await agentCall(assistant, token, "agent.saveTextbookStructure", { textbookId, structure })).status).toBe(200);
  await page.reload();
  await page.getByRole("region", { name: "Структура" }).getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.getByRole("region", { name: "Структура" })).toContainText("Подтверждена");
  return textbookId;
}

async function filterByLesson(page: Page, textbook: string, lesson: string) {
  await page.goto("/teacher/library");
  await control(page, "Игры").click();
  await page.getByLabel("Учебник").selectOption({ label: textbook });
  await page.getByLabel("Урок").selectOption({ label: lesson });
}

test("a game linked to a textbook lesson is found by it and shows it; an edit removes the link", async ({ page, assistant }) => {
  const token = await createToken(page);
  await textbookWithLessons(page, assistant, token, "Linked book");

  await page.goto("/teacher/library");
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: Buffer.from(game("Lesson game")) });
  await page.getByLabel("Название").fill("Lesson game");
  await page.getByLabel("Учебник").selectOption({ label: "Linked book" });
  await page.getByLabel("Урок").selectOption({ label: "Unit 1 · 1.2" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека", exact: true })).toBeVisible();

  await filterByLesson(page, "Linked book", "Unit 1 · 1.2");
  await expect(materials(page).filter({ hasText: "Lesson game" })).toHaveCount(1);
  await page.getByLabel("Урок").selectOption({ label: "Unit 1 · 1.3" });
  await expect(materials(page).filter({ hasText: "Lesson game" })).toHaveCount(0);

  await page.getByLabel("Урок").selectOption({ label: "Unit 1 · 1.2" });
  await materials(page).filter({ hasText: "Lesson game" }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByText("Linked book · Unit 1 · 1.2")).toBeVisible();

  await control(page, "Изменить").click();
  await expect(page.getByLabel("Урок")).toHaveValue(/.+/);
  await page.getByLabel("Учебник").selectOption({ label: "Без учебника" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Lesson game" })).toBeVisible();
  await expect(page.getByText("Linked book · Unit 1 · 1.2")).toHaveCount(0);
  await filterByLesson(page, "Linked book", "Unit 1 · 1.2");
  await expect(materials(page).filter({ hasText: "Lesson game" })).toHaveCount(0);
});

test("the assistant saves a game draft for a lesson and sees it in the structure; a lesson not in it is refused", async ({ page, assistant }) => {
  const token = await createToken(page);
  const textbookId = await textbookWithLessons(page, assistant, token, "Assistant's book");
  const structure = await agentCall(assistant, token, "agent.textbookStructure", { textbookId }, true);
  const third = structure.body.result.data.structure.units[0].lessons[2];
  const tags = { title: "Drafted for 1.3", level: "A2", topic: "", ageGroup: "younger", html: game("Drafted for 1.3") };

  const saved = await agentCall(assistant, token, "agent.saveGameDraft", { ...tags, textbookId, textbookLessonId: third.id });
  expect(saved.status).toBe(200);
  const after = await agentCall(assistant, token, "agent.textbookStructure", { textbookId }, true);
  expect(after.body.result.data.structure.units[0].lessons[2].games).toEqual([{ id: saved.body.result.data.id, title: "Drafted for 1.3" }]);
  expect(after.body.result.data.structure.units[0].lessons[0].games).toEqual([]);

  const refused = await agentCall(assistant, token, "agent.saveGameDraft", { ...tags, textbookId, textbookLessonId: "00000000-0000-4000-8000-000000000000" });
  expect(refused.status).toBe(400);
  expect(refused.body.error.message).toBe("Такого урока нет в учебнике");
});
