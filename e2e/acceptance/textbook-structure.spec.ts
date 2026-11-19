// Acceptance for #150: a textbook's units and lessons. The assistant saves a
// structure through the agent procedures, as the MCP server does: units,
// lessons with their page ranges, a track and words each. The teacher sees it
// as a draft «от ассистента» on the textbook's page, corrects a page range
// and confirms it; a lesson then shows its pages, its track and its words.
// Without the assistant the teacher marks a textbook out by hand. The
// assistant cannot confirm; another teacher's textbook is not found for it
// (pinned by an integration test).
//
// The teacher starts signed in (sessions.setup.ts). The PDF (six pages that
// say their number), the tracks (a second of MP3 silence) and the words are
// synthetic, made here.
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

// The assistant has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION });
// One token per teacher: creating one revokes the previous one.
test.describe.configure({ mode: "serial" });

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

/** About a second of MP3 silence. */
function mp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc4]);
  return Buffer.concat(Array.from({ length: 40 }, () => frame));
}

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** Uploads a six-page student's book and two tracks; waits for the pages; returns the textbook's id. */
async function uploadTextbook(page: Page, title: string): Promise<string> {
  await page.goto("/teacher/library/textbooks/new");
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "book.pdf", mimeType: "application/pdf", buffer: pdf(6) });
  await page.getByLabel("Треки").setInputFiles([
    { name: "1-01.mp3", mimeType: "audio/mpeg", buffer: mp3() },
    { name: "1-02.mp3", mimeType: "audio/mpeg", buffer: mp3() },
  ]);
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("region", { name: "Student's Book" }).getByText("Готов", { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  return page.url().split("/").at(-1)!;
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

/** An agent mutation over HTTP, as the MCP server calls it. */
async function agentMutation(request: APIRequestContext, token: string, procedure: string, input: unknown) {
  const response = await request.post(`/api/trpc/${procedure}`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: JSON.stringify(input),
  });
  return { status: response.status(), body: await response.json() };
}

const structure = (unit: string) => ({
  units: [
    {
      title: unit,
      lessons: [
        { title: "1.1", pages: { students_book: { from: 1, to: 2 } }, tracks: ["1-01"], words: ["kite", "lamp", "nest"] },
        { title: "1.2", pages: { students_book: { from: 3, to: 4 } }, tracks: ["1-02"], words: ["oven", "pear", "quilt"] },
      ],
    },
  ],
});

test("the assistant's structure is a draft; the teacher corrects a range and confirms; a lesson shows its pages, track and words", async ({
  page,
  assistant,
}) => {
  const textbookId = await uploadTextbook(page, "Demo Structure Book");
  const token = await createToken(page);
  const saved = await agentMutation(assistant, token, "agent.saveTextbookStructure", { textbookId, structure: structure("Unit 1") });
  expect(saved.status).toBe(200);
  // The assistant cannot confirm: the same answer as for a procedure that does not exist.
  const none = await agentMutation(assistant, token, "agent.noSuchProcedure", { textbookId });
  expect((await agentMutation(assistant, token, "agent.confirmTextbookStructure", { textbookId })).status).toBe(none.status);

  await page.goto(`/teacher/library/textbooks/${textbookId}`);
  const editor = page.getByRole("region", { name: "Структура" });
  await expect(editor).toContainText("Черновик от ассистента");
  const unit = editor.getByRole("group", { name: "Юнит 1", exact: true });
  await expect(unit.getByLabel("Название юнита")).toHaveValue("Unit 1");
  const second = unit.getByRole("group", { name: "Урок 2", exact: true });
  await expect(second.getByLabel("Название урока")).toHaveValue("1.2");
  await expect(second.getByLabel("Student's Book с")).toHaveValue("3");

  // The teacher corrects the second lesson's range and confirms.
  await second.getByLabel("Student's Book по").fill("5");
  await editor.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(editor).toContainText("Подтверждена");
  await expect(editor).not.toContainText("Черновик от ассистента");

  await page.getByRole("link", { name: "1.2", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "1.2" })).toBeVisible();
  const pages = page.getByRole("img", { name: /^Страница \d+$/ });
  await expect(pages).toHaveCount(3);
  await expect(pages.first()).toHaveAttribute("alt", "Страница 3");
  await expect(page.getByRole("list", { name: "Треки" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("list", { name: "Треки" })).toContainText("1-02");
  await expect(page.getByRole("list", { name: "Слова" })).toContainText("quilt");
});

test("without the assistant the teacher marks a textbook out by hand and confirms it", async ({ page }) => {
  const textbookId = await uploadTextbook(page, "Demo Hand Book");
  await page.goto(`/teacher/library/textbooks/${textbookId}`);
  const editor = page.getByRole("region", { name: "Структура" });
  await editor.getByRole("button", { name: "Разметить вручную", exact: true }).click();
  const unit = editor.getByRole("group", { name: "Юнит 1", exact: true });
  await unit.getByLabel("Название юнита").fill("Starter unit");
  const lesson = unit.getByRole("group", { name: "Урок 1", exact: true });
  await lesson.getByLabel("Название урока").fill("Starter");
  await lesson.getByLabel("Student's Book с").fill("1");
  await lesson.getByLabel("Student's Book по").fill("2");
  await editor.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(editor).toContainText("Подтверждена");

  await page.getByRole("link", { name: "Starter", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Starter" })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Страница \d+$/ })).toHaveCount(2);
});
