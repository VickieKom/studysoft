// Acceptance for #268: published reports on the parent's page. «Опубликовать»
// puts a draft on the parent's page, which lists the published reports with
// their numbers and blocks in place of «Отчётов пока нет». The teacher opens a
// published report from the card and edits its text: the parent sees the
// edit. «Снять с публикации» takes it off the parent's page. That the
// numbers freeze at publishing, the next period starts after the last
// published report, and the parent never gets the balance line or another
// child's reports, is pinned by integration tests.
//
// The teacher starts signed in (sessions.setup.ts); the parent opens their
// link in a fresh browser without her cookies. The texts are synthetic.
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };
const DAY = 86_400_000;

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

const moscow = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date(Date.now() + days * DAY));

async function parentPage(browser: Browser, link: string): Promise<Page> {
  const parent = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await parent.goto(link);
  await expect.poll(() => parent.url()).not.toContain("#");
  return parent;
}

test("a published report reaches the parent's page; an edit reaches it too; taken down, it is gone", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Публикуемая");
  await page.getByLabel("Часовой пояс").selectOption({ label: "Москва" });
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Публикуемая" })).toBeVisible();
  const card = page.url();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка родителя").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/p#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  const progress = page.getByRole("region", { name: "Прогресс" });
  await progress.getByRole("button", { name: "Внести результаты", exact: true }).click();
  const form = progress.getByRole("group", { name: "Результаты" });
  await form.getByLabel("Дата").fill(moscow(-5));
  await form.getByLabel("Чтение", { exact: true }).fill("75");
  await form.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(form).toHaveCount(0);

  // Before anything is published, the parent has no reports.
  let parent = await parentPage(browser, link);
  await expect(parent.getByText("Отчётов пока нет")).toBeVisible();
  await parent.context().close();

  const reports = page.getByRole("region", { name: "Отчёты" });
  await reports.getByRole("button", { name: "Новый отчёт", exact: true }).click();
  const draft = reports.getByRole("group", { name: "Черновик отчёта" });
  await draft.getByLabel("Что получается", { exact: true }).fill("Читает вслух без подсказок.");
  await draft.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(reports.getByRole("listitem").filter({ hasText: "Опубликован" })).toHaveCount(1);

  // The parent sees it: the numbers and the filled block, no empty one.
  parent = await parentPage(browser, link);
  let shown = parent.getByRole("region", { name: "Отчёты" }).getByRole("article");
  await expect(shown).toHaveCount(1);
  await expect(shown).toContainText("Чтение 75%");
  await expect(shown).toContainText("Что получается");
  await expect(shown).toContainText("Читает вслух без подсказок.");
  await expect(shown).not.toContainText("Над чем работаем");
  await expect(parent.getByText("Отчётов пока нет")).toHaveCount(0);

  // The teacher edits the published report: the parent sees the edit.
  await page.goto(card);
  const item = reports.getByRole("listitem").filter({ hasText: "Опубликован" });
  await item.getByRole("button", { name: "Открыть", exact: true }).click();
  const opened = reports.getByRole("group", { name: "Опубликованный отчёт" });
  await opened.getByLabel("Что получается", { exact: true }).fill("Читает вслух и пересказывает.");
  await opened.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(opened.getByRole("status")).toHaveText("Отчёт сохранён");
  await parent.reload();
  shown = parent.getByRole("region", { name: "Отчёты" }).getByRole("article");
  await expect(shown).toContainText("Читает вслух и пересказывает.");
  await expect(shown).not.toContainText("Читает вслух без подсказок.");

  // «Снять с публикации»: the parent's page has no reports again; the card keeps it as a draft.
  await opened.getByRole("button", { name: "Снять с публикации", exact: true }).click();
  await expect(reports.getByRole("listitem").filter({ hasText: "Черновик" })).toHaveCount(1);
  await expect(reports.getByRole("listitem").filter({ hasText: "Опубликован" })).toHaveCount(0);
  await parent.reload();
  await expect(parent.getByText("Отчётов пока нет")).toBeVisible();
  await expect(parent.getByRole("article")).toHaveCount(0);
  await parent.context().close();
});
