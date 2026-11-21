// Acceptance for #269: recordings «было» and «стало» in a parent's report.
// In the draft the teacher uploads two recordings; a file that is not audio
// is refused with a message. Published, the report on the parent's page has
// two players, «Было» and «Стало», whose recordings the parent's browser
// gets. That another parent, the student and a stranger get the same 404,
// and the size limit, are pinned by integration tests.
//
// The teacher starts signed in (sessions.setup.ts); the parent opens their
// link in a fresh browser without her cookies. The recordings are generated
// silence, the texts synthetic.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });

const NO_SESSION = { cookies: [], origins: [] };

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** `seconds` of silence as a WAV file: 8 kHz, 8-bit, mono. */
function silence(seconds: number): Buffer {
  const samples = 8000 * seconds;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 0x80)]);
}

test("the teacher uploads «было» and «стало» to a report; published, the parent has two players", async ({ page, browser }) => {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill("Звучащая");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Звучащая" })).toBeVisible();
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await control(page, "Ссылка родителя").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/p#.+/);
  const link = await page.evaluate(() => navigator.clipboard.readText());

  const reports = page.getByRole("region", { name: "Отчёты" });
  await reports.getByRole("button", { name: "Новый отчёт", exact: true }).click();
  const draft = reports.getByRole("group", { name: "Черновик отчёта" });
  await draft.getByLabel("Что получается", { exact: true }).fill("Рассказывает о выходных.");

  // A file that is not audio is refused.
  await draft.getByLabel("Запись «было»", { exact: true }).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("не запись") });
  await expect(draft.getByRole("alert")).toHaveText("Можно загрузить аудио: MP3, M4A, WAV или OGG");

  await draft.getByLabel("Запись «было»", { exact: true }).setInputFiles({ name: "before.wav", mimeType: "audio/wav", buffer: silence(1) });
  await expect(draft.locator('audio[aria-label="Было"]')).toHaveCount(1);
  await draft.getByLabel("Запись «стало»", { exact: true }).setInputFiles({ name: "after.wav", mimeType: "audio/wav", buffer: silence(2) });
  await expect(draft.locator('audio[aria-label="Стало"]')).toHaveCount(1);
  await draft.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(reports.getByRole("listitem").filter({ hasText: "Опубликован" })).toHaveCount(1);

  const parent = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await parent.goto(link);
  await expect.poll(() => parent.url()).not.toContain("#");
  const shown = parent.getByRole("region", { name: "Отчёты" }).getByRole("article");
  await expect(shown).toContainText("Рассказывает о выходных.");
  for (const [label, seconds] of [["Было", 1], ["Стало", 2]] as const) {
    const player = shown.locator(`audio[aria-label="${label}"]`);
    await expect(player).toHaveCount(1);
    const response = await parent.request.get((await player.getAttribute("src"))!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("audio/wav");
    expect((await response.body()).byteLength).toBe(44 + 8000 * seconds);
  }
  await parent.context().close();
});
