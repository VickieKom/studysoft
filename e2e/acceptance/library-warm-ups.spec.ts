// Acceptance for #116: warm-ups in «Библиотека». A warm-up is a picture or a
// list of conversation questions, saved with the same tags as a game; a game
// marked «разминка» shows under both «Игры» and «Разминки». Edited and
// deleted as games are; another teacher sees none of it.
//
// The teacher starts signed in (sessions.setup.ts). The pictures and the game
// are synthetic, written here.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The warm-ups made by one scenario are opened by the next ones.
test.describe.configure({ mode: "serial" });

// A 1×1 PNG, written for this test.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
// A 1×1 GIF: a type a warm-up picture may not be.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

const GAME = Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Word chain</title></head>
<body><h1 id="state">Not started</h1>
<script>document.getElementById("state").textContent = "Word chain is ready";</script>
</body></html>`);

const QUESTIONS = ["What did you do at the weekend?", "What is your favourite season?", "What makes you laugh?"];

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

function materials(page: Page): Locator {
  return page.getByRole("list", { name: "Материалы" }).getByRole("listitem");
}

async function openLibrary(page: Page) {
  await page.goto("/teacher/students");
  await page.getByRole("navigation", { name: "Разделы" }).getByRole("link", { name: "Библиотека" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека" })).toBeVisible();
}

async function fillTags(page: Page, { title, level, topic, age }: { title: string; level: string; topic: string; age: string }) {
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption({ label: level });
  await page.getByLabel("Тема").fill(topic);
  await page.getByLabel("Возраст").selectOption({ label: age });
}

/** Saves the form; over once back on the list or refused with a message. */
async function save(page: Page) {
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page
      .getByRole("heading", { level: 1, name: "Библиотека", exact: true })
      .or(page.getByRole("alert").filter({ hasText: /МБ|PNG|вопрос/ })),
  ).toBeVisible();
}

async function uploadPicture(page: Page, title: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await openLibrary(page);
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Разминка" });
  await page.getByLabel("Формат разминки").selectOption({ label: "Картинка" });
  await page.getByLabel("Файл картинки").setInputFiles(file);
  await fillTags(page, { title, level: "A2", topic: "feelings", age: "младшие" });
  await save(page);
}

async function open(page: Page, title: string) {
  await openLibrary(page);
  await materials(page).filter({ hasText: title }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

test("a picture warm-up and a questions warm-up are saved with tags, listed under «Разминки» and open", async ({ page }) => {
  await uploadPicture(page, "Mood scale", { name: "mood.png", mimeType: "image/png", buffer: PNG });

  await openLibrary(page);
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Разминка" });
  await page.getByLabel("Формат разминки").selectOption({ label: "Вопросы" });
  await page.getByLabel("Вопросы").fill(QUESTIONS.join("\n"));
  await fillTags(page, { title: "Small talk", level: "B1", topic: "free time", age: "подростки" });
  await save(page);

  await openLibrary(page);
  await control(page, "Разминки").click();
  const picture = materials(page).filter({ hasText: "Mood scale" });
  const questions = materials(page).filter({ hasText: "Small talk" });
  await expect(picture).toHaveCount(1);
  await expect(questions).toHaveCount(1);
  for (const tag of ["A2", "feelings", "младшие"]) await expect(picture).toContainText(tag);
  for (const tag of ["B1", "free time", "подростки"]) await expect(questions).toContainText(tag);

  // Warm-ups are not games.
  await control(page, "Игры").click();
  await expect(materials(page).filter({ hasText: "Mood scale" })).toHaveCount(0);
  await expect(materials(page).filter({ hasText: "Small talk" })).toHaveCount(0);

  await open(page, "Mood scale");
  const image = page.getByRole("main").getByRole("img", { name: "Mood scale" });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  await open(page, "Small talk");
  const list = page.getByRole("list", { name: "Вопросы" }).getByRole("listitem");
  await expect(list).toHaveText(QUESTIONS);
});

test("a game marked «разминка» shows under «Игры» and under «Разминки»", async ({ page }) => {
  await openLibrary(page);
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: GAME });
  await fillTags(page, { title: "Word chain", level: "A2", topic: "vocabulary", age: "младшие" });
  await save(page);

  await control(page, "Разминки").click();
  await expect(materials(page).filter({ hasText: "Word chain" })).toHaveCount(0);

  await open(page, "Word chain");
  await control(page, "Изменить").click();
  await expect(page.getByRole("heading", { level: 1, name: "Изменить материал" })).toBeVisible();
  await page.getByLabel("Подходит как разминка").check();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Word chain" })).toBeVisible();

  await openLibrary(page);
  await control(page, "Игры").click();
  await expect(materials(page).filter({ hasText: "Word chain" })).toHaveCount(1);
  await control(page, "Разминки").click();
  await expect(materials(page).filter({ hasText: "Word chain" })).toHaveCount(1);

  // Still a game: it opens and runs in its frame.
  await materials(page).filter({ hasText: "Word chain" }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.frameLocator('iframe[title="Word chain"]').getByText("Word chain is ready")).toBeVisible();
});

test("a picture over 2 MB or of another type is refused with a message, and nothing is saved", async ({ page }) => {
  const huge = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
  await uploadPicture(page, "Too big", { name: "big.png", mimeType: "image/png", buffer: huge });
  await expect(page.getByRole("alert").filter({ hasText: "2 МБ" })).toBeVisible();

  await uploadPicture(page, "Not a picture", { name: "dot.gif", mimeType: "image/gif", buffer: GIF });
  await expect(page.getByRole("alert").filter({ hasText: "PNG" })).toBeVisible();

  await openLibrary(page);
  await expect(materials(page).filter({ hasText: "Too big" })).toHaveCount(0);
  await expect(materials(page).filter({ hasText: "Not a picture" })).toHaveCount(0);
});

test("a questions warm-up can be edited, and a picture warm-up deleted with its file", async ({ page }) => {
  await open(page, "Small talk");
  await control(page, "Изменить").click();
  await expect(page.getByRole("heading", { level: 1, name: "Изменить материал" })).toBeVisible();
  await page.getByLabel("Вопросы").fill([...QUESTIONS, "Where would you like to travel?"].join("\n"));
  await page.getByLabel("Название").fill("Small talk 2");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Small talk 2" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Вопросы" }).getByRole("listitem")).toHaveCount(4);

  await open(page, "Mood scale");
  const src = await page.getByRole("main").getByRole("img", { name: "Mood scale" }).getAttribute("src");
  await control(page, "Удалить").click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека" })).toBeVisible();
  await expect(materials(page).filter({ hasText: "Mood scale" })).toHaveCount(0);
  expect((await page.request.get(new URL(src!, page.url()).toString())).status()).toBe(404);
});

test("another teacher gets the same 404 for a warm-up's page and its picture as for missing ones", async ({
  page,
  browser,
}) => {
  await uploadPicture(page, "Weather faces", { name: "weather.png", mimeType: "image/png", buffer: PNG });
  await open(page, "Weather faces");
  const pictureUrl = new URL(
    (await page.getByRole("main").getByRole("img", { name: "Weather faces" }).getAttribute("src"))!,
    page.url(),
  ).toString();
  const picturePage = page.url();
  await open(page, "Small talk 2");
  const questionsPage = page.url();
  const missingPage = picturePage.replace(/[0-9a-f-]{36}$/, "00000000-0000-4000-8000-000000000000");
  const missingFile = pictureUrl.replace(/[0-9a-f-]{36}/, "00000000-0000-4000-8000-000000000000");

  const other = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const otherPage = await other.newPage();
  for (const foreign of [picturePage, questionsPage, missingPage]) {
    expect((await otherPage.goto(foreign))?.status()).toBe(404);
  }
  await openLibrary(otherPage);
  await expect(otherPage.getByText("Weather faces")).toHaveCount(0);
  await expect(otherPage.getByText("Small talk 2")).toHaveCount(0);

  const foreignFile = await other.request.get(pictureUrl);
  const missingFileResponse = await other.request.get(missingFile);
  expect({ status: foreignFile.status(), body: await foreignFile.text() }).toEqual({
    status: missingFileResponse.status(),
    body: await missingFileResponse.text(),
  });
  expect(foreignFile.status()).toBe(404);
  await other.close();
});
