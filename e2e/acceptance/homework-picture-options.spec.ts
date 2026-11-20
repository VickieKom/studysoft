// Acceptance for #129, the first slice: answer options that are a picture, a
// picture with a caption, or text, mixed in one task; an option may hold two
// pictures. The interface draws the letters a, b, c; the student picks one and
// it is checked as before. The pictures reach the student by an address of
// their own, never as the stored file, and nothing the page receives before
// submission holds the right option. A picture of another type is refused at
// import, naming the task and the option, and nothing is saved.
//
// The teacher starts signed in (sessions.setup.ts). The homework and its
// pictures are synthetic (deploy/seed/homework/demo-picture-options.json).
import { expect, type Locator, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-picture-options.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

// A student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

type Option = string | { images: string[]; text?: string };
const [red, two] = homework.tasks as { prompt: string; options: Option[] }[] as [
  { prompt: string; options: Option[] },
  { prompt: string; options: Option[] },
];

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

/** The answer option with this letter, drawn by the interface. */
function option(page: Page, letter: string): Locator {
  return page.getByRole("button", { name: new RegExp(`^${letter}\\b`) });
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

test("picture, captioned picture and text options with letters; an option of two pictures; checked as before", async ({
  page,
  browser,
}) => {
  const { link } = await createStudent(page, "Картинки-варианты");
  await importHomework(page, homework);

  // The teacher's preview shows the pictures in place: one, one, and two.
  await expect(page.getByRole("main").getByRole("img")).toHaveCount(4);
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  const received: string[] = [];
  student.on("response", async (response) => {
    if (response.url().includes("/api/trpc/")) received.push(await response.text().catch(() => ""));
  });
  await student.goto(link);
  await expect(student.getByText(red.prompt).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();

  // Task 1: a picture, a picture with its caption, text — lettered a, b, c.
  await expect(student.getByRole("heading", { level: 1 })).toHaveText(red.prompt);
  await expect(option(student, "a").getByRole("img")).toHaveCount(1);
  await expect(option(student, "b").getByRole("img")).toHaveCount(1);
  await expect(option(student, "b")).toContainText("green square");
  await expect(option(student, "c").getByRole("img")).toHaveCount(0);
  await expect(option(student, "c")).toContainText("no colour");
  await expect(option(student, "d")).toHaveCount(0);

  // The picture comes from its own address, for this student.
  const src = await option(student, "a").getByRole("img").getAttribute("src");
  expect(src).toMatch(/^\/api\/files\/homework\//);
  const picture = await student.request.get(new URL(src!, student.url()).toString());
  expect(picture.status()).toBe(200);
  expect(picture.headers()["content-type"]).toContain("image/png");

  await option(student, "a").click();
  await student.getByRole("button", { name: "Дальше", exact: true }).click();

  // Task 2: an option of two pictures shows both.
  await expect(student.getByRole("heading", { level: 1 })).toHaveText(two.prompt);
  await expect(option(student, "b").getByRole("img")).toHaveCount(2);
  await option(student, "b").click();

  // Nothing received before submission held the right option or a stored file.
  const before = received.join("\n");
  expect(before).not.toMatch(/"answer":/);
  expect(before).not.toContain("blob:");
  expect(before).not.toContain("data:image");

  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText("Домашка сдана")).toBeVisible();
  // The score is the teacher's (#227).
  await expect(await reviewRow(page, "Картинки-варианты")).toContainText("2 верно, 0 неверно");
  await student.context().close();
});

test("a picture of another type in an option is refused at import, naming the task and the option, and nothing is saved", async ({
  page,
}) => {
  const { card } = await createStudent(page, "Не та картинка");
  const gif = `data:image/gif;base64,${Buffer.from("GIF89a not allowed").toString("base64")}`;
  await importHomework(page, {
    version: 1,
    title: "Demo: a GIF option",
    tasks: [{ type: "single_choice", prompt: "Pick one.", options: ["text", { images: [gif] }], answer: 0 }],
  });
  const message = page.getByRole("alert").filter({ hasText: "Задание 1" });
  await expect(message).toContainText("вариант 2");
  await page.goto(card);
  await expect(page.getByRole("region", { name: "Домашки" }).getByRole("listitem")).toHaveCount(0);
});
