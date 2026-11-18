// Acceptance for #128: a gap may offer its own options, as a workbook's
// "circle the correct word" does, next to gaps the student types. The student
// picks each option from that gap's own buttons; each gap is checked against
// its key; no key reaches the page before submission. A gap whose key is not
// among its own options is refused at import, naming the task and the gap.
//
// The teacher starts signed in (sessions.setup.ts). The homework is synthetic
// (deploy/seed/homework/demo-gap-choices.json).
import { expect, type Page, test } from "@playwright/test";
import choices from "../../deploy/seed/homework/demo-gap-choices.json" with { type: "json" };
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

// A student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A new student; returns the student's link and leaves the card open. */
async function createStudent(page: Page, firstName: string): Promise<string> {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка ученика").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/s#.+/);
  return page.evaluate(() => navigator.clipboard.readText());
}

async function importHomework(page: Page, homework: unknown) {
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework, null, 2));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
}

test("each gap offers its own options, next to a typed gap; no key reaches the student", async ({ page, browser }) => {
  const link = await createStudent(page, "Обводящий");
  await importHomework(page, choices);
  // The teacher's preview shows each gap's options.
  await expect(page.getByText("on / at")).toBeVisible();
  await expect(page.getByText("plays / does")).toBeVisible();
  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  const received: string[] = [];
  student.on("response", async (response) => {
    if (response.url().includes("/api/trpc/")) received.push(await response.text().catch(() => ""));
  });
  await student.goto(link);
  await expect(student.getByRole("heading", { level: 1 }).or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  await expect(student.getByRole("heading", { level: 1 })).toHaveText(choices.tasks[0]!.prompt);

  // Each gap with options has its own buttons, and only its own.
  const first = student.getByRole("group", { name: "Пропуск 1" });
  const second = student.getByRole("group", { name: "Пропуск 2" });
  await expect(first.getByRole("button")).toHaveText(["on", "at"]);
  await expect(second.getByRole("button")).toHaveText(["plays", "does"]);
  // The typed gap is a field; the gaps with options are not.
  await expect(student.getByRole("textbox")).toHaveCount(1);

  await first.getByRole("button", { name: "on", exact: true }).click();
  await expect(first.getByRole("button", { name: "on", exact: true })).toHaveAttribute("aria-pressed", "true");
  await second.getByRole("button", { name: "plays", exact: true }).click();
  await student.getByRole("textbox", { name: "Пропуск 3" }).fill("Mila");
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText(/1\s+верно/)).toBeVisible();

  // The typed gap's key never reached the page: «Mila» came only from the student.
  for (const body of received) expect(body).not.toMatch(/"answers"\s*:/);
  await student.context().close();
});

test("a gap whose key is not among its own options is refused at import, naming the task and the gap", async ({ page }) => {
  await createStudent(page, "Неверный ключ");
  const broken = structuredClone(choices);
  broken.tasks[0]!.answers[1] = ["play"];
  await importHomework(page, broken);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Задание 1");
  await expect(alert).toContainText("пропуск 2");
  await expect(page.getByText("Опубликована", { exact: true })).toHaveCount(0);
});
