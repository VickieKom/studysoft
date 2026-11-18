// Acceptance for #156: the teacher uploads a textbook set to «Библиотека»:
// the student's book as a PDF and a folder of audio tracks, with a title and
// a level. The server renders the book's pages to images in the background;
// the textbook's page shows the status, then the pages and the tracks, which
// play. Pages and tracks are the teacher's only: a student by their link, a
// parent and another teacher get the same 404 as for a missing one. A file
// that is not a PDF is refused with a message, and nothing is saved.
// Rendering interrupted by a restart is pinned by an integration test.
//
// The teacher starts signed in (sessions.setup.ts). The PDF and the tracks
// are synthetic, made here: three pages that say their number, and a second
// of silence.
import { expect, type Page, test } from "@playwright/test";
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

test.use({ storageState: TEACHER_SESSION, permissions: ["clipboard-read", "clipboard-write"] });
test.describe.configure({ mode: "serial" });

// A student's or a parent's browser has no teacher session: a context made here would otherwise inherit hers from test.use.
const NO_SESSION = { cookies: [], origins: [] };

/** A PDF of `pages` pages, each saying its number. */
function pdf(pages: number): Buffer {
  const objects: string[] = [];
  const kids = Array.from({ length: pages }, (_, i) => `${3 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`);
  const font = 3 + pages * 2;
  for (let i = 0; i < pages; i++) {
    const content = `BT /F1 48 Tf 72 700 Td (Page ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** About a second of MP3 silence: MPEG-1 Layer III frames, 128 kbit/s, 44.1 kHz, mono. */
function mp3(): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc4]);
  return Buffer.concat(Array.from({ length: 40 }, () => frame));
}

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

/** A new student; returns the student's and the parent's links. */
async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const links: string[] = [];
  for (const name of ["Ссылка ученика", "Ссылка родителя"]) {
    await page.evaluate(() => navigator.clipboard.writeText(""));
    await control(page, name).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/#.+/);
    links.push(await page.evaluate(() => navigator.clipboard.readText()));
  }
  return { student: links[0]!, parent: links[1]! };
}

async function openUploadForm(page: Page) {
  await page.goto("/teacher/library");
  await control(page, "Учебники").click();
  await control(page, "Загрузить учебник").click();
}

let pageAddress: string;
let trackAddress: string;

test("the teacher uploads a book and tracks; the pages are rendered, and a track plays", async ({ page }) => {
  await openUploadForm(page);
  await page.getByLabel("Название").fill("Demo Textbook 1");
  await page.getByLabel("Уровень").selectOption("A2");
  await page.getByLabel("Student's Book (PDF)").setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: pdf(3) });
  await page.getByLabel("Треки").setInputFiles([
    { name: "1-01.mp3", mimeType: "audio/mpeg", buffer: mp3() },
    { name: "1-02.mp3", mimeType: "audio/mpeg", buffer: mp3() },
  ]);
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Demo Textbook 1" })).toBeVisible();
  const book = page.getByRole("region", { name: "Student's Book" });
  // Rendering runs in the background: the status shows until the pages are ready.
  await expect(async () => {
    await page.reload();
    await expect(book.getByText("Готов", { exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  const pages = book.getByRole("img", { name: /^Страница \d+$/ });
  await expect(pages).toHaveCount(3);
  pageAddress = new URL((await pages.nth(1).getAttribute("src"))!, page.url()).toString();
  const forTeacher = await page.request.get(pageAddress);
  expect(forTeacher.status()).toBe(200);
  expect(forTeacher.headers()["content-type"]).toMatch(/^image\//);

  const tracks = page.getByRole("list", { name: "Треки" }).getByRole("listitem");
  await expect(tracks).toHaveCount(2);
  await expect(tracks.first()).toContainText("1-01");
  const audio = tracks.first().locator("audio");
  trackAddress = new URL((await audio.getAttribute("src"))!, page.url()).toString();
  // The player reads the track: its length is known.
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("a student, a parent and another teacher get the same 404 for a page and a track as for a missing one", async ({ page, browser }) => {
  const { student, parent } = await createStudent(page, "Без учебника");
  const missingPage = pageAddress.replace(/[0-9a-f-]{36}/, "00000000-0000-4000-8000-000000000000");
  const missingTrack = trackAddress.replace(/[0-9a-f-]{36}/, "00000000-0000-4000-8000-000000000000");

  const visitors = [];
  for (const link of [student, parent]) {
    const visitor = await (await browser.newContext({ storageState: NO_SESSION })).newPage();
    await visitor.goto(link);
    await expect.poll(() => visitor.url()).not.toContain("#");
    visitors.push(visitor);
  }
  visitors.push(await (await browser.newContext({ storageState: SECOND_TEACHER_SESSION })).newPage());

  for (const visitor of visitors) {
    for (const [real, missing] of [
      [pageAddress, missingPage],
      [trackAddress, missingTrack],
    ] as const) {
      const got = await visitor.request.get(real);
      const none = await visitor.request.get(missing);
      expect(got.status()).toBe(404);
      expect({ status: got.status(), body: await got.text() }).toEqual({ status: none.status(), body: await none.text() });
    }
    await visitor.context().close();
  }
});

test("a file that is not a PDF is refused with a message, and nothing is saved", async ({ page }) => {
  await openUploadForm(page);
  await page.getByLabel("Название").fill("Demo Textbook not a PDF");
  await page.getByLabel("Уровень").selectOption("A2");
  await page
    .getByLabel("Student's Book (PDF)")
    .setInputFiles({ name: "students-book.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a PDF") });
  await page.getByRole("button", { name: "Загрузить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("PDF");

  await page.goto("/teacher/library");
  await control(page, "Учебники").click();
  await expect(page.getByText("Demo Textbook not a PDF")).toHaveCount(0);
});
