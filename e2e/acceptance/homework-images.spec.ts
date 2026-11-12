// Acceptance for #33: a homework task can carry a picture; it travels inside
// the homework JSON, the teacher sees it in the preview, and only the student
// whose published homework it is can load it.
//
// The pictures are tiny synthetic PNGs generated here — never a textbook page.
import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

// A 1×1 PNG, written for this test.
const PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG = `data:image/png;base64,${PIXEL_PNG}`;
// A 1×1 GIF: a type the format does not accept.
const GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

function homeworkWithImages(title: string, images: [string, string]) {
  return {
    version: 1,
    title,
    tasks: [
      { type: "single_choice", prompt: "What is in the picture?", options: ["a dot", "a cat"], answer: 0, image: images[0] },
      { type: "multiple_choice", prompt: "Pick what you see.", options: ["dot", "line", "space"], answers: [0, 2], image: images[1] },
    ],
  };
}

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function createStudentWithLink(page: Page, firstName: string): Promise<{ card: string; link: string }> {
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

async function importHomework(page: Page, card: string, homework: unknown) {
  await page.goto(card);
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
}

async function publish(page: Page) {
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();
}

/** Every picture on the page has loaded. */
async function expectImagesLoaded(page: Page, count: number) {
  const images = page.locator("main img");
  await expect(images).toHaveCount(count);
  for (let i = 0; i < count; i++) {
    await expect.poll(() => images.nth(i).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  }
}

async function openAsStudent(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await expect(page.getByText("What is in the picture?").or(control(page, "Начать"))).toBeVisible();
  if (await control(page, "Начать").isVisible()) await control(page, "Начать").click();
  return page;
}

async function status(request: APIRequestContext, url: string) {
  const response = await request.get(url);
  return { status: response.status(), body: await response.text() };
}

test("the preview shows each task's picture, and the student sees it in the published homework", async ({
  page,
  browser,
}) => {
  const { card, link } = await createStudentWithLink(page, "Картинки");
  await importHomework(page, card, homeworkWithImages("With pictures", [PNG, PNG]));

  const tasks = page.getByRole("listitem");
  await expect(tasks).toHaveCount(2);
  for (let i = 0; i < 2; i++) await expect(tasks.nth(i).locator("img")).toHaveCount(1);
  await expectImagesLoaded(page, 2);

  await publish(page);
  const student = await openAsStudent(browser, link);
  await expect(student.getByText("What is in the picture?")).toBeVisible();
  await expectImagesLoaded(student, 1);
  await student.context().close();
});

test("a picture loads only for its own student's published homework", async ({ page, browser, playwright }) => {
  const own = await createStudentWithLink(page, "Своя картинка");
  const other = await createStudentWithLink(page, "Чужая картинка");

  await importHomework(page, own.card, homeworkWithImages("Published", [PNG, PNG]));
  await publish(page);
  await importHomework(page, own.card, homeworkWithImages("Still a draft", [PNG, PNG]));
  const draftSrc = await page.locator("main img").first().getAttribute("src");

  const student = await openAsStudent(browser, own.link);
  const publishedSrc = await student.locator("main img").first().getAttribute("src");
  expect(publishedSrc).toBeTruthy();
  expect(draftSrc).toBeTruthy();

  const missing = await status(student.request, `${new URL(publishedSrc!, student.url()).pathname}x`);
  expect(missing.status).toBe(404);

  // Without any session.
  const anonymous = await playwright.request.newContext({ baseURL: new URL(student.url()).origin });
  expect(await status(anonymous, publishedSrc!)).toEqual(missing);
  await anonymous.dispose();

  // With another student's session.
  const otherStudent = await (await browser.newContext()).newPage();
  await otherStudent.goto(other.link);
  await expect(otherStudent.getByText("Домашних заданий пока нет")).toBeVisible();
  expect(await status(otherStudent.request, publishedSrc!)).toEqual(missing);
  await otherStudent.context().close();

  // A draft's picture, even for its own student.
  expect(await status(student.request, draftSrc!)).toEqual(missing);
  await student.context().close();
});

test("an oversized or unsupported picture is refused, naming the task, and nothing is saved", async ({ page }) => {
  const { card } = await createStudentWithLink(page, "Большая картинка");

  await importHomework(page, card, homeworkWithImages("Wrong type", [PNG, GIF]));
  await expect(page.getByRole("alert").filter({ hasText: "2" }).filter({ hasText: "image" })).toBeVisible();

  // Far over any sensible limit for a homework picture: 12 MB.
  const huge = `data:image/png;base64,${Buffer.concat([Buffer.from(PIXEL_PNG, "base64"), Buffer.alloc(12 * 1024 * 1024)]).toString("base64")}`;
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homeworkWithImages("Too big", [huge, PNG])));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "1" }).filter({ hasText: "image" })).toBeVisible();

  await page.goto(card);
  await expect(page.getByRole("region", { name: "Домашки" }).getByRole("listitem")).toHaveCount(0);
});
