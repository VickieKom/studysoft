// Acceptance for #339: the intro's brief from the teacher's own template.
// During the intro the teacher talks with the parent and the child and fills
// in a brief. She has not settled the questions yet, so «Бриф вводного» in
// «Настройки» starts from the platform's set — «Цели», «Ожидания», «Главная
// метрика», «Боли», «Проблемы в школе», «Интересы ребёнка», each with
// quick-choice options and «другое» — and she adds options and questions of
// her own and removes any. Always in the brief, outside the template:
// «Удобное время», days of the week and time ranges, with «Часовой пояс
// семьи», the teacher's by default (product owner, 2026-11-23). On a
// request, «Бриф» is filled in as she goes and kept. That a later change of
// the template leaves filled briefs as they were is pinned by an
// integration test.
//
// The teacher starts signed in (sessions.setup.ts); her time zone is set to
// Moscow. The request and the answers are synthetic.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION });
// The template and the request of one scenario are used by the next ones.
test.describe.configure({ mode: "serial" });

const STARTING_SET = ["Цели", "Ожидания", "Главная метрика", "Боли", "Проблемы в школе", "Интересы ребёнка"];
const OWN_OPTION = "Подготовка к олимпиаде";
const OWN_QUESTION = "Как ребёнок относится к английскому?";

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

async function setTeacherTimeZone(page: Page, label: string) {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  await page.getByLabel("Часовой пояс").selectOption({ label });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Сохранено")).toBeVisible();
}

/** «Бриф вводного» in «Настройки». */
async function template(page: Page): Promise<Locator> {
  await page.goto("/teacher/students");
  await control(page, "Настройки").click();
  const section = page.getByRole("region", { name: "Бриф вводного" });
  await expect(section).toBeVisible();
  return section;
}

/** «Привлечение клиентов» → a new request from Avito, then its page. */
async function newRequest(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Привлечение клиентов").click();
  await control(page, "Новая заявка").click();
  await page.getByLabel("Имя ребёнка").fill(firstName);
  await page.getByLabel("Источник").selectOption({ label: "Авито" });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await openRequest(page, firstName);
}

async function openRequest(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Привлечение клиентов").click();
  await page.getByRole("listitem").filter({ hasText: firstName }).getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
}

function brief(page: Page): Locator {
  return page.getByRole("region", { name: "Бриф" });
}

function question(scope: Locator, name: string): Locator {
  return scope.getByRole("group", { name, exact: true });
}

test.beforeAll(async ({ browser }) => {
  const page = await (await browser.newContext({ storageState: TEACHER_SESSION })).newPage();
  await setTeacherTimeZone(page, "Москва");
  await page.context().close();
});

test("«Бриф вводного» starts from the platform's set; the teacher adds an option to «Цели» and a question of her own", async ({ page }) => {
  const section = await template(page);
  for (const name of STARTING_SET) {
    await expect(question(section, name)).toBeVisible();
    await expect(question(section, name)).toContainText("другое");
  }
  // «Удобное время» is not part of the template.
  await expect(question(section, "Удобное время")).toHaveCount(0);

  const goals = question(section, "Цели");
  await goals.getByLabel("Новый вариант").fill(OWN_OPTION);
  await goals.getByRole("button", { name: "Добавить вариант", exact: true }).click();
  await expect(goals).toContainText(OWN_OPTION);

  await section.getByLabel("Новый вопрос").fill(OWN_QUESTION);
  await section.getByRole("button", { name: "Добавить вопрос", exact: true }).click();
  await expect(question(section, OWN_QUESTION)).toBeVisible();

  await question(section, "Ожидания").getByRole("button", { name: "Убрать вопрос", exact: true }).click();
  await expect(question(section, "Ожидания")).toHaveCount(0);

  const kept = await template(page);
  await expect(question(kept, "Цели")).toContainText(OWN_OPTION);
  await expect(question(kept, OWN_QUESTION)).toBeVisible();
  await expect(question(kept, "Ожидания")).toHaveCount(0);
});

test("on a request the teacher fills in the brief as she goes: the template's questions and «Удобное время» in the family's time zone", async ({
  page,
}) => {
  await newRequest(page, "Брифовая");
  const filled = brief(page);
  for (const name of ["Цели", "Главная метрика", "Боли", "Проблемы в школе", "Интересы ребёнка", OWN_QUESTION, "Удобное время"]) {
    await expect(question(filled, name)).toBeVisible();
  }
  await expect(question(filled, "Ожидания")).toHaveCount(0);

  await question(filled, "Цели").getByRole("checkbox", { name: OWN_OPTION }).check();
  await question(filled, "Цели").getByLabel("Заметка").fill("Олимпиада в марте");
  await question(filled, OWN_QUESTION).getByLabel("Заметка").fill("Любит песни, стесняется говорить");

  const time = question(filled, "Удобное время");
  await expect(time.getByLabel("Часовой пояс семьи")).toHaveValue("Europe/Moscow");
  await time.getByLabel("Часовой пояс семьи").selectOption({ label: "Новосибирск" });
  await time.getByRole("checkbox", { name: "Вт" }).check();
  await time.getByRole("checkbox", { name: "Чт" }).check();
  await time.getByLabel("С", { exact: true }).fill("16:00");
  await time.getByLabel("До", { exact: true }).fill("19:00");
  await time.getByRole("button", { name: "Добавить промежуток", exact: true }).click();
  await expect(time).toContainText("16:00–19:00");
  await expect(filled.getByText("Сохранено")).toBeVisible();
});

test("reopened, the request shows the brief as filled", async ({ page }) => {
  await openRequest(page, "Брифовая");
  const filled = brief(page);
  await expect(question(filled, "Цели").getByRole("checkbox", { name: OWN_OPTION })).toBeChecked();
  await expect(question(filled, "Цели").getByLabel("Заметка")).toHaveValue("Олимпиада в марте");
  await expect(question(filled, OWN_QUESTION).getByLabel("Заметка")).toHaveValue("Любит песни, стесняется говорить");
  const time = question(filled, "Удобное время");
  await expect(time.getByLabel("Часовой пояс семьи")).toHaveValue("Asia/Novosibirsk");
  await expect(time.getByRole("checkbox", { name: "Вт" })).toBeChecked();
  await expect(time.getByRole("checkbox", { name: "Чт" })).toBeChecked();
  await expect(time.getByRole("checkbox", { name: "Пн" })).not.toBeChecked();
  await expect(time).toContainText("16:00–19:00");
});
