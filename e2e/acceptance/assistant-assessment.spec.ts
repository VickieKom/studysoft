// Acceptance for #313: the assistant drafts the month's assessment. It reads
// the assessment format with the homework format's other descriptions, saves
// a draft for a student, and the draft shows on the card in «Замеры» «от
// ассистента». Saving again replaces the draft while the teacher has done
// nothing to it; once she has («Убрать», the recording, the picture), the
// next save makes a new draft and keeps hers. A draft that fails the format
// is refused with the messages of an import. The assistant never approves;
// once the teacher approves, the student context dates the period of the
// next assessment from that approval. The units and words of the period are
// pinned by an integration test.
//
// The assistant's calls are the HTTP calls the MCP server makes with the
// token, from a request context without the teacher's cookies (as in #3).
// The student and the texts are synthetic.
import { randomUUID } from "node:crypto";
import { type APIRequestContext, expect, type Page, test as base } from "@playwright/test";
import { TEACHER_SESSION } from "./sessions";

const NO_SESSION = { cookies: [], origins: [] };

const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright, baseURL }, use) => {
    const context = await playwright.request.newContext({ baseURL, storageState: NO_SESSION });
    await use(context);
    await context.dispose();
  },
});

test.use({ storageState: TEACHER_SESSION });
// One token per teacher: creating one revokes the previous one, so these
// scenarios must not run side by side.
test.describe.configure({ mode: "serial" });

function control(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).or(page.getByRole("button", { name, exact: true }));
}

type Call = { status: number; body: { result?: { data: unknown }; error?: { message: string } } };

/** An agent query over HTTP, as the MCP server calls it. */
async function agentQuery(request: APIRequestContext, token: string, procedure: string, input?: unknown): Promise<Call> {
  const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const response = await request.get(`/api/trpc/${procedure}${query}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status(), body: await response.json() };
}

/** An agent mutation over HTTP, as the MCP server calls it. */
async function agentMutation(request: APIRequestContext, token: string, procedure: string, input: unknown): Promise<Call> {
  const response = await request.post(`/api/trpc/${procedure}`, {
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    data: JSON.stringify(input),
  });
  return { status: response.status(), body: await response.json() };
}

async function createToken(page: Page): Promise<string> {
  await page.goto("/teacher/assistant");
  await control(page, "Создать токен").click();
  const token = page.getByLabel("Токен ассистента");
  await expect(token).not.toHaveValue("");
  return token.inputValue();
}

/** A new student; returns the card address and the id. */
async function createStudent(page: Page, firstName: string) {
  await page.goto("/teacher/students");
  await control(page, "Новый ученик").click();
  await page.getByLabel("Имя").fill(firstName);
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("heading", { level: 1, name: firstName })).toBeVisible();
  const card = page.url();
  return { card, studentId: card.split("/").pop()! };
}

/** A synthetic reading text of about 130 words. */
const READING = Array.from(
  { length: 7 },
  (_, i) => `Day ${i + 1}: the demo robot Pim walks to the blue box, opens it and counts the round stones inside.`,
).join(" ");

/** An assessment in the format of #252, without «Аудирование», so it needs no recording to be approved. */
function assessment(title: string) {
  return {
    version: 1,
    title,
    sections: [
      {
        skill: "reading",
        text: READING,
        questions: [
          { type: "true_false", statement: "Pim is a robot.", answer: "true" },
          { type: "choice", question: "What colour is the box?", options: ["red", "blue", "green"], answer: 1 },
        ],
      },
      {
        skill: "grammar",
        text: "Yesterday Pim ___ to the box and ___ the stones.",
        gaps: [
          { options: ["walk", "walked", "walks"], answer: 1 },
          { options: ["count", "counted", "counting"], answer: 1 },
        ],
      },
      {
        skill: "vocabulary",
        questions: [
          { type: "translation", translation: "камешек", answers: ["pebble"] },
          { type: "sentence", text: "Pim keeps the stones in a ___.", answers: ["crate"] },
        ],
      },
      { skill: "writing", task: "Write a note to Pim about your weekend (30–60 words)." },
      { skill: "speaking", questions: ["What can you see in the picture?", "What is the robot doing?"] },
    ],
  };
}

function assessmentsOnCard(page: Page) {
  return page.getByRole("region", { name: "Замеры" }).getByRole("group");
}

type Period = { lastAssessmentAt: string | null; since: string };

async function period(request: APIRequestContext, token: string, studentId: string): Promise<Period> {
  const { status, body } = await agentQuery(request, token, "agent.studentContext", { studentId });
  expect(status).toBe(200);
  return (body.result!.data as { assessmentPeriod: Period }).assessmentPeriod;
}

test("the assistant reads the assessment format with the homework format's other descriptions", async ({ page, assistant }) => {
  const token = await createToken(page);
  const { status, body } = await agentQuery(assistant, token, "agent.assessmentFormat");
  expect(status).toBe(200);
  const format = body.result!.data as { version: number; description: string };
  expect(format.version).toBe(1);
  for (const skill of ["listening", "reading", "grammar", "vocabulary", "writing", "speaking"]) {
    expect(format.description).toContain(skill);
  }
  expect(format.description).toContain("vocabularyWord");
});

test("a saved draft shows on the card «от ассистента», and saving again replaces it while the teacher has done nothing", async ({
  page,
  assistant,
}) => {
  const { card, studentId } = await createStudent(page, "Замер ассистента");
  const token = await createToken(page);

  const first = await agentMutation(assistant, token, "agent.saveAssessmentDraft", {
    studentId,
    assessment: assessment("Assistant assessment: first"),
  });
  expect(first.status).toBe(200);
  await page.goto(card);
  await expect(assessmentsOnCard(page)).toHaveCount(1);
  const draft = assessmentsOnCard(page).first();
  await expect(draft).toContainText("Assistant assessment: first");
  await expect(draft).toContainText("Черновик");
  await expect(draft).toContainText("от ассистента");
  await expect(draft.getByRole("region", { name: "Лексика", exact: true })).toContainText("камешек");
  // As the child will see it: no keys of the typed answers.
  await expect(draft).not.toContainText("pebble");

  const second = await agentMutation(assistant, token, "agent.saveAssessmentDraft", {
    studentId,
    assessment: assessment("Assistant assessment: second"),
  });
  expect(second.status).toBe(200);
  await page.reload();
  await expect(assessmentsOnCard(page)).toHaveCount(1);
  await expect(assessmentsOnCard(page).first()).toContainText("Assistant assessment: second");
  await expect(assessmentsOnCard(page).first()).toContainText("от ассистента");
});

test("once the teacher removes a question, the next save makes a new draft and keeps hers", async ({ page, assistant }) => {
  const { card, studentId } = await createStudent(page, "Правка замера");
  const token = await createToken(page);
  await agentMutation(assistant, token, "agent.saveAssessmentDraft", { studentId, assessment: assessment("Assistant assessment") });

  await page.goto(card);
  const hers = assessmentsOnCard(page).filter({ hasText: "Assistant assessment" });
  const vocabulary = hers.getByRole("region", { name: "Лексика", exact: true }).getByRole("listitem");
  await vocabulary.filter({ hasText: "камешек" }).getByRole("button", { name: "Убрать", exact: true }).click();
  await expect(vocabulary).toHaveCount(1);

  await agentMutation(assistant, token, "agent.saveAssessmentDraft", {
    studentId,
    assessment: assessment("Assistant assessment, revised"),
  });
  await page.reload();
  await expect(assessmentsOnCard(page)).toHaveCount(2);
  await expect(assessmentsOnCard(page).filter({ hasText: "Assistant assessment, revised" })).toContainText("от ассистента");

  // The teacher's version is untouched: one question fewer.
  const kept = assessmentsOnCard(page).filter({ hasText: "Assistant assessment", hasNotText: "revised" });
  await expect(kept.getByRole("region", { name: "Лексика", exact: true }).getByRole("listitem")).toHaveCount(1);
  await expect(kept).not.toContainText("камешек");
});

test("a draft that fails the format is refused with the import's messages, and nothing is saved", async ({ page, assistant }) => {
  const { card, studentId } = await createStudent(page, "Неформатный замер");
  const token = await createToken(page);
  const broken = assessment("Broken assessment");
  (broken.sections[2]!.questions![1] as { answers: string[] }).answers = [];

  const saved = await agentMutation(assistant, token, "agent.saveAssessmentDraft", { studentId, assessment: broken });
  expect(saved.status).toBe(400);
  expect(saved.body.error!.message).toMatch(/Лексика, вопрос 2, поле answers/);

  await page.goto(card);
  await expect(page.getByRole("region", { name: "Замеры" })).toContainText("Замеров пока нет");
});

test("a student who is not the teacher's is not found", async ({ page, assistant }) => {
  const token = await createToken(page);
  const saved = await agentMutation(assistant, token, "agent.saveAssessmentDraft", {
    studentId: randomUUID(),
    assessment: assessment("Nobody's assessment"),
  });
  expect(saved.status).toBe(404);
});

test("the assistant cannot approve; once the teacher approves, the next period starts at her approval", async ({ page, assistant }) => {
  const { card, studentId } = await createStudent(page, "Утверждает учитель");
  const token = await createToken(page);
  await agentMutation(assistant, token, "agent.saveAssessmentDraft", { studentId, assessment: assessment("Approved by the teacher") });

  // No assessment approved yet: the period is the last 30 days.
  const before = await period(assistant, token, studentId);
  expect(before.lastAssessmentAt).toBeNull();
  const thirtyDays = Date.now() - new Date(before.since).getTime();
  expect(thirtyDays).toBeGreaterThan(29 * 86_400_000);
  expect(thirtyDays).toBeLessThan(31 * 86_400_000);

  // No agent procedure approves: the same answer as a procedure that does not exist.
  const none = await agentMutation(assistant, token, "agent.noSuchProcedure", { studentId });
  expect((await agentMutation(assistant, token, "agent.approveAssessment", { studentId })).status).toBe(none.status);

  await page.goto(card);
  const draft = assessmentsOnCard(page).filter({ hasText: "Approved by the teacher" });
  await draft.getByRole("button", { name: "Утвердить", exact: true }).click();
  await expect(draft).toContainText("Утверждён");

  const after = await period(assistant, token, studentId);
  expect(after.lastAssessmentAt).not.toBeNull();
  expect(after.since).toBe(after.lastAssessmentAt);
  expect(Date.now() - new Date(after.lastAssessmentAt!).getTime()).toBeLessThan(10 * 60_000);
});
