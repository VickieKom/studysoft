// Acceptance for #127: a task may carry a recording for the student to listen
// to, as a workbook's listening exercise does. The teacher's preview plays it;
// the student plays it on the task as often as they like, answers and
// submits, and the task is checked as before. A recording of another type is
// refused at import, naming the task and the field, and nothing is saved.
// Another student gets the same 404 for the recording as for a missing one.
// The size limit is pinned by an integration test: a scenario would have to
// paste more than 10 MB.
//
// The teacher starts signed in (sessions.setup.ts). The recording is a
// synthetic second of silence made here.
import { expect, type Page, test } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

// A student's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

/** One second of silence as a WAV file: 8 kHz, 8-bit, mono. */
function silence(): Buffer {
  const samples = 8000;
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

const listening = (audio: string) => ({
  version: 1,
  title: "Demo: listening",
  tasks: [
    {
      type: "gap",
      prompt: "Listen and complete the sentence.",
      audio,
      text: "The bus leaves at ___ o'clock.",
      answers: [["seven", "7"]],
      topic: "time",
      skill: "listening",
    },
  ],
});

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A new student; returns the card's address and the student's link. */
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

async function importHomework(page: Page, homework: unknown) {
  await control(page, "Импортировать домашку").click();
  await page.getByLabel("JSON домашки").fill(JSON.stringify(homework));
  await page.getByRole("button", { name: "Импортировать", exact: true }).click();
}

let clipAddress: string;

test("the teacher's preview and the student's task play the recording; the gap is checked as before", async ({
  page,
  browser,
}) => {
  const { link } = await createStudent(page, "Слушающий");
  await importHomework(page, listening(`data:audio/wav;base64,${silence().toString("base64")}`));

  const preview = page.locator("audio");
  await expect(preview).toHaveCount(1);
  clipAddress = new URL((await preview.getAttribute("src"))!, page.url()).toString();
  const forTeacher = await page.request.get(clipAddress);
  expect(forTeacher.status()).toBe(200);
  expect(forTeacher.headers()["content-type"]).toContain("audio/wav");

  await page.getByLabel("Срок").fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Опубликовать", exact: true }).click();
  await expect(page.getByText("Опубликована", { exact: true })).toBeVisible();

  const student = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await student.goto(link);
  await expect(student.getByText("Listen and complete the sentence.").or(control(student, "Начать"))).toBeVisible();
  if (await control(student, "Начать").isVisible()) await control(student, "Начать").click();
  const clip = student.locator("audio");
  await expect(clip).toHaveCount(1);
  expect(await clip.getAttribute("controls")).not.toBeNull();
  const forStudent = await student.request.get(new URL((await clip.getAttribute("src"))!, student.url()).toString());
  expect(forStudent.status()).toBe(200);
  // A player can seek: the address answers byte ranges.
  const part = await student.request.get(new URL((await clip.getAttribute("src"))!, student.url()).toString(), {
    headers: { Range: "bytes=0-43" },
  });
  expect(part.status()).toBe(206);

  await student.getByRole("textbox").fill("seven");
  await student.getByRole("button", { name: "Сдать", exact: true }).click();
  await expect(student.getByText(/1\s+верно/)).toBeVisible();
  await student.context().close();
});

test("another student gets the same 404 for the recording as for a missing one", async ({ page, browser }) => {
  const { link } = await createStudent(page, "Чужой слушатель");
  const other = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
  await other.goto(link);
  await expect.poll(() => other.url()).not.toContain("#");
  const foreign = await other.request.get(clipAddress);
  const missing = await other.request.get(clipAddress.replace(/[0-9a-f-]{36}/, "00000000-0000-4000-8000-000000000000"));
  expect(foreign.status()).toBe(404);
  expect({ status: foreign.status(), body: await foreign.text() }).toEqual({ status: missing.status(), body: await missing.text() });
  await other.context().close();
});

test("a recording of another type is refused at import, naming the task and the field, and nothing is saved", async ({ page }) => {
  const { card } = await createStudent(page, "Не та запись");
  // Text pretending to be an MP3.
  await importHomework(page, listening(`data:audio/mpeg;base64,${Buffer.from("not a recording at all").toString("base64")}`));
  const message = page.getByRole("alert").filter({ hasText: "Задание 1" });
  await expect(message).toContainText("audio");
  await page.goto(card);
  await expect(page.getByRole("region", { name: "Домашки" }).getByRole("listitem")).toHaveCount(0);
});
