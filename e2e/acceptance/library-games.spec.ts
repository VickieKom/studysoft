// Acceptance for #115: «Библиотека» keeps the teacher's games — single HTML
// files — with tags, filters them, and opens a game in an isolated frame. A
// game's script runs but cannot reach the platform's page or cookies, even
// when its address is opened directly.
//
// The teacher starts signed in (sessions.setup.ts). The games are synthetic
// HTML written here: they report on their own page whether their script ran
// and whether it could read the page around it and the cookies.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The filters count the materials of this teacher, so the scenarios run in order.
test.describe.configure({ mode: "serial" });

/** A synthetic game: it says it is ready and whether it could read the parent page and the cookies. */
const game = (name: string) =>
  Buffer.from(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${name}</title></head>
<body>
<h1 id="state">Not started</h1>
<p id="parent"></p>
<p id="cookie"></p>
<script>
document.getElementById("state").textContent = "${name} is ready";
var parentResult;
try { parentResult = window.parent.document.title !== undefined && window.parent !== window ? "read" : "none"; } catch (e) { parentResult = "blocked"; }
document.getElementById("parent").textContent = "parent: " + parentResult;
var cookieResult;
try { cookieResult = document.cookie === "" ? "empty" : "read"; } catch (e) { cookieResult = "blocked"; }
document.getElementById("cookie").textContent = "cookie: " + cookieResult;
</script>
</body></html>`);

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

async function uploadGame(
  page: Page,
  { title, level, topic, age, file = game(title) }: { title: string; level: string; topic: string; age: string; file?: Buffer },
) {
  await openLibrary(page);
  await control(page, "Загрузить").click();
  await page.getByLabel("Тип материала").selectOption({ label: "Игра" });
  await page.getByLabel("Файл игры").setInputFiles({ name: "game.html", mimeType: "text/html", buffer: file });
  await page.getByLabel("Название").fill(title);
  await page.getByLabel("Уровень").selectOption({ label: level });
  await page.getByLabel("Тема").fill(topic);
  await page.getByLabel("Возраст").selectOption({ label: age });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  // Saved, back on the list, or refused with a message: either way the upload is over before the scenario moves on.
  await expect(
    page.getByRole("heading", { level: 1, name: "Библиотека", exact: true }).or(page.getByRole("alert").filter({ hasText: /МБ|HTML/ })),
  ).toBeVisible();
}

test("an empty library says so and offers «Загрузить»", async ({ browser }) => {
  // The second teacher has no materials in any scenario.
  const page = await (await browser.newContext({ storageState: SECOND_TEACHER_SESSION })).newPage();
  await openLibrary(page);
  await expect(page.getByText("В библиотеке пока ничего нет")).toBeVisible();
  await expect(control(page, "Загрузить")).toBeVisible();
  await page.context().close();
});

test("an uploaded game is listed with its tags and opens in a frame where its script runs but cannot reach the platform", async ({
  page,
}) => {
  await uploadGame(page, { title: "Colour hunt", level: "A2", topic: "colours", age: "младшие" });

  await control(page, "Игры").click();
  const card = materials(page).filter({ hasText: "Colour hunt" });
  await expect(card).toHaveCount(1);
  for (const tag of ["A2", "colours", "младшие"]) await expect(card).toContainText(tag);

  await card.getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Colour hunt" })).toBeVisible();
  const frame = page.frameLocator('iframe[title="Colour hunt"]');
  await expect(frame.getByText("Colour hunt is ready")).toBeVisible();
  await expect(frame.getByText("parent: blocked")).toBeVisible();
  await expect(frame.getByText("cookie: blocked")).toBeVisible();

  // Opened by its own address, the game still runs without the platform's cookies.
  const src = await page.locator('iframe[title="Colour hunt"]').getAttribute("src");
  expect(src).toBeTruthy();
  await page.goto(src!);
  await expect(page.getByText("Colour hunt is ready")).toBeVisible();
  await expect(page.getByText("cookie: blocked")).toBeVisible();
});

test("the filters by level, topic and age narrow the list, and one that matches nothing says so", async ({ page }) => {
  await uploadGame(page, { title: "Animal snap", level: "A1", topic: "animals", age: "младшие" });
  await uploadGame(page, { title: "Tense race", level: "B1", topic: "past simple", age: "подростки" });

  await openLibrary(page);
  await control(page, "Игры").click();
  const titles = ["Colour hunt", "Animal snap", "Tense race"];
  for (const title of titles) await expect(materials(page).filter({ hasText: title })).toHaveCount(1);

  await page.getByLabel("Уровень").selectOption({ label: "B1" });
  await expect(materials(page).filter({ hasText: "Tense race" })).toHaveCount(1);
  await expect(materials(page).filter({ hasText: "Animal snap" })).toHaveCount(0);

  await page.getByLabel("Уровень").selectOption({ label: "Все уровни" });
  await page.getByLabel("Возраст").selectOption({ label: "младшие" });
  await expect(materials(page).filter({ hasText: "Animal snap" })).toHaveCount(1);
  await expect(materials(page).filter({ hasText: "Colour hunt" })).toHaveCount(1);
  await expect(materials(page).filter({ hasText: "Tense race" })).toHaveCount(0);

  await page.getByLabel("Тема").selectOption({ label: "animals" });
  await expect(materials(page)).toHaveCount(1);
  await expect(materials(page).first()).toContainText("Animal snap");

  await page.getByLabel("Уровень").selectOption({ label: "B1" });
  await expect(page.getByText("Ничего не нашлось")).toBeVisible();
  await expect(materials(page)).toHaveCount(0);

  // Games are not warm-ups or videos.
  await control(page, "Разминки").click();
  await expect(materials(page).filter({ hasText: "Colour hunt" })).toHaveCount(0);
});

test("a file over 5 MB or not an HTML page is refused with a message, and nothing is saved", async ({ page }) => {
  const huge = Buffer.concat([game("Too big"), Buffer.alloc(5 * 1024 * 1024 + 1, 32)]);
  await uploadGame(page, { title: "Too big", level: "A2", topic: "size", age: "младшие", file: huge });
  await expect(page.getByRole("alert").filter({ hasText: "5 МБ" })).toBeVisible();

  const notHtml = Buffer.from("%PDF-1.4 not a game");
  await uploadGame(page, { title: "Not a game", level: "A2", topic: "size", age: "младшие", file: notHtml });
  await expect(page.getByRole("alert").filter({ hasText: "HTML" })).toBeVisible();

  await openLibrary(page);
  await expect(materials(page).filter({ hasText: "Too big" })).toHaveCount(0);
  await expect(materials(page).filter({ hasText: "Not a game" })).toHaveCount(0);
});

test("a game can be renamed and retagged, and once deleted it is gone with its file", async ({ page }) => {
  await uploadGame(page, { title: "Draft name", level: "A2", topic: "food", age: "младшие" });
  await openLibrary(page);
  await materials(page).filter({ hasText: "Draft name" }).getByRole("link", { name: "Открыть" }).click();
  const src = await page.locator("iframe").getAttribute("src");

  await control(page, "Изменить").click();
  await page.getByLabel("Название").fill("Food bingo");
  await page.getByLabel("Уровень").selectOption({ label: "A1" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Food bingo" })).toBeVisible();

  await openLibrary(page);
  const card = materials(page).filter({ hasText: "Food bingo" });
  await expect(card).toContainText("A1");
  await expect(materials(page).filter({ hasText: "Draft name" })).toHaveCount(0);

  await card.getByRole("link", { name: "Открыть" }).click();
  await control(page, "Удалить").click();
  await expect(page.getByRole("heading", { level: 1, name: "Библиотека" })).toBeVisible();
  await expect(materials(page).filter({ hasText: "Food bingo" })).toHaveCount(0);
  expect((await page.request.get(new URL(src!, page.url()).toString())).status()).toBe(404);
});

test("another teacher gets the same 404 for a game's page and its file as for missing ones", async ({ page, browser }) => {
  await openLibrary(page);
  await materials(page).filter({ hasText: "Colour hunt" }).getByRole("link", { name: "Открыть" }).click();
  const gamePage = page.url();
  const file = new URL((await page.locator("iframe").getAttribute("src"))!, page.url()).toString();
  const missingPage = gamePage.replace(/[0-9a-f-]{36}$/, "00000000-0000-4000-8000-000000000000");
  const missingFile = file.replace(/[0-9a-f-]{36}/, "00000000-0000-4000-8000-000000000000");

  const other = await browser.newContext({ storageState: SECOND_TEACHER_SESSION });
  const otherPage = await other.newPage();
  const foreign = await otherPage.goto(gamePage);
  const missing = await otherPage.goto(missingPage);
  expect(foreign?.status()).toBe(404);
  expect(missing?.status()).toBe(404);

  const foreignFile = await other.request.get(file);
  const missingFileResponse = await other.request.get(missingFile);
  expect({ status: foreignFile.status(), body: await foreignFile.text() }).toEqual({
    status: missingFileResponse.status(),
    body: await missingFileResponse.text(),
  });
  expect(foreignFile.status()).toBe(404);
  await other.close();
});
