// Acceptance for #184, the third slice of #129: a matching exercise pairs
// pictures with sentences. The pictures are on the left, in their order; the
// sentences on the right are shuffled as before. The student matches each
// picture to a sentence, and the task is checked as before. Nothing the
// student's page receives before submission holds the pairing or a stored
// file. A picture of another type on a pair is refused at import, naming the
// task and the pair, and nothing is saved.
//
// The teacher starts signed in (sessions.setup.ts). The homework and its
// pictures are synthetic (deploy/seed/homework/demo-match-pictures.json).
import { expect, type Page, test } from "@playwright/test";
import homework from "../../deploy/seed/homework/demo-match-pictures.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

// A student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

const [task] = homework.tasks;
const sentences = task!.pairs.map((p) => p.right);

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

/** The picture on the left of pair n, as the student sees it. */
function picture(page: Page, n: number) {
  return page.getByRole("button", { name: `Картинка ${n}`, exact: true });
}

test("pictures on the left match sentences on the right, and the task is checked as before", async ({ page, browser }) => {
  const { link } = await createStudent(page, "Сопоставь картинки");
  await importHomework(page, homework);

  // The teacher's preview shows the three pictures.
  for (const n of [1, 2, 3]) await expect(page.getByRole("main").getByRole("img", { name: `Картинка ${n}`, exact: true })).toBeVisible();
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
  for (const n of [1, 2, 3]) await expect(picture(student, n).getByRole("img")).toHaveCount(1);
  const src = await picture(student, 2).getByRole("img").getAttribute("src");
  expect(src).toMatch(/^\/api\/files\/homework\//);
  const file = await student.request.get(new URL(src!, student.url()).toString());
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("image/png");

  // Nothing received before submission held the pairing or a stored file.
  const before = received.join("\n");
  expect(before).not.toContain(JSON.stringify(sentences));
  expect(before).not.toContain("blob:");
  expect(before).not.toContain("data:image");

  for (const [i, sentence] of sentences.entries()) {
    await picture(student, i + 1).click();
    await student.getByRole("button", { name: sentence, exact: true }).click();
  }
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText("Домашка сдана")).toBeVisible();
  // The score is the teacher's (#227).
  await expect(await reviewRow(page, "Сопоставь картинки")).toContainText("1 верно, 0 неверно");
  await student.context().close();
});

test("a picture of another type on a pair is refused at import, naming the task and the pair, and nothing is saved", async ({ page }) => {
  const { card } = await createStudent(page, "Не та картинка в паре");
  const gif = `data:image/gif;base64,${Buffer.from("GIF89a not allowed").toString("base64")}`;
  await importHomework(page, {
    version: 1,
    title: "Demo: a GIF in a pair",
    tasks: [
      {
        type: "match",
        prompt: "Match.",
        pairs: [
          { left: task!.pairs[0]!.left, right: "one" },
          { left: { images: [gif] }, right: "two" },
        ],
      },
    ],
  });
  const message = page.getByRole("alert").filter({ hasText: "Задание 1" });
  await expect(message).toContainText("пара 2");
  await page.goto(card);
  await expect(page.getByRole("region", { name: "Домашки" }).getByRole("listitem")).toHaveCount(0);
});
