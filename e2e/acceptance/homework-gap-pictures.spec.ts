// Acceptance for #181, the second slice of #129: a picture by each gap of a
// `gap` task, as a workbook prints a picture beside each line to label. Each picture
// shows next to its own field, for the teacher and for the student; the task
// is checked as before. Nothing the student's page receives before submission
// holds a key or a stored file. A picture of another type is refused at
// import, naming the task and the gap, and nothing is saved.
//
// The teacher starts signed in (sessions.setup.ts). The homework and its
// pictures are synthetic (deploy/seed/homework/demo-gap-pictures.json).
import { expect, type Locator, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-gap-pictures.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

// A student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const [task] = homework.tasks;

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

async function createStudent(page: Page, firstName: string) {
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

async function importHomework(page: Page, document: unknown) {
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(document));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
}

/** The centre of an element on the page. */
async function centre(locator: Locator) {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Each gap's picture is nearer to its own field than to any other field. */
async function expectPicturesByTheirFields(page: Page) {
  const fields = await Promise.all([1, 2, 3].map((n) => centre(page.getByRole("textbox", { name: `Пропуск ${n}`, exact: true }))));
  for (const n of [1, 2, 3]) {
    const picture = page.getByRole("img", { name: `Картинка к пропуску ${n}`, exact: true });
    await expect(picture).toBeVisible();
    const at = await centre(picture);
    const distances = fields.map((f) => Math.hypot(f.x - at.x, f.y - at.y));
    expect(distances.indexOf(Math.min(...distances))).toBe(n - 1);
  }
}

test("a picture by each gap shows next to its own field; the task is checked as before", async ({ page, browser }) => {
  const { link } = await createStudent(page, "Подпиши картинки");
  await importHomework(page, homework);

  // The teacher's preview: the three pictures, one per gap.
  for (const n of [1, 2, 3]) await expect(page.getByRole("main").getByRole("img", { name: `Картинка к пропуску ${n}`, exact: true })).toBeVisible();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  const received: string[] = [];
  student.on("response", async (response) => {
    if (response.url().includes("/api/trpc/")) received.push(await response.text().catch(() => ""));
  });
  await student.goto(link);
  await expect(student.getByText(task!.prompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();

  await expect(student.getByRole("heading", { level: 1 })).toHaveText(task!.prompt);
  await expectPicturesByTheirFields(student);
  const src = await student.getByRole("img", { name: "Картинка к пропуску 2", exact: true }).getAttribute("src");
  expect(src).toMatch(/^\/api\/files\/homework\//);
  const picture = await student.request.get(new URL(src!, student.url()).toString());
  expect(picture.status()).toBe(200);
  expect(picture.headers()["content-type"]).toContain("image/png");

  // Nothing received before submission held a key or a stored file.
  const before = received.join("\n");
  for (const [key] of task!.answers) expect(before).not.toContain(`"${key}"`);
  expect(before).not.toContain("blob:");
  expect(before).not.toContain("data:image");

  for (const [n, [key]] of task!.answers.entries()) {
    await student.getByRole("textbox", { name: `Пропуск ${n + 1}`, exact: true }).fill(key!);
  }
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText("Домашка сдана")).toBeVisible();
  // The score is the teacher's (#227).
  await expect(await reviewRow(page, "Подпиши картинки")).toContainText("1 верно, 0 неверно");
  await student.context().close();
});

test("a picture of another type by a gap is refused at import, naming the task and the gap, and nothing is saved", async ({ page }) => {
  const { card } = await createStudent(page, "Не та картинка у пропуска");
  const gif = `data:image/gif;base64,${Buffer.from("GIF89a not allowed").toString("base64")}`;
  await importHomework(page, {
    version: 1,
    title: "Demo: a GIF by a gap",
    tasks: [{ type: "gap", prompt: "Write.", text: "1 ___\n2 ___", answers: [["a"], ["b"]], gapImages: [task!.gapImages[0], gif] }],
  });
  const message = page.getByRole("alert").filter({ hasText: "Задание 1" });
  await expect(message).toContainText("пропуск 2");
  await page.goto(card);
  await expect(page.getByRole("region", { name: "Домашки" }).getByRole("listitem")).toHaveCount(0);
});
