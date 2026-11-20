import { describe, expect, it } from "vitest";
import { createPlatform } from "./platform";
import { createTools } from "./tools";

// A fake platform: answers the router's HTTP calls the way the application does.
function platformAnswering(status: number, body: unknown, seen: { url?: string; auth?: string | null } = {}) {
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.url = String(input);
    seen.auth = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify([body]), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return createPlatform("https://platform.example.test", "test-token", fakeFetch);
}

describe("assistant tools", () => {
  it("call the agent procedure with the token and return its data as JSON", async () => {
    const seen: { url?: string; auth?: string | null } = {};
    const students = [{ id: "00000000-0000-4000-8000-000000000001", firstName: "Тест", status: "active" }];
    const tools = createTools(platformAnswering(200, { result: { data: students } }, seen));

    const result = await tools.listStudents();
    expect(seen.url).toContain("/api/trpc/agent.listStudents");
    expect(seen.auth).toBe("Bearer test-token");
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0]!.text)).toEqual(students);
  });

  it("turn a revoked token into a plain «unauthorized» answer", async () => {
    const tools = createTools(
      platformAnswering(401, { error: { message: "UNAUTHORIZED", code: -32001, data: { code: "UNAUTHORIZED", httpStatus: 401 } } }),
    );
    const result = await tools.getStudentContext({ studentId: "00000000-0000-4000-8000-000000000001" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^unauthorized/);
  });

  it("turn another teacher's student into «not found»", async () => {
    const tools = createTools(
      platformAnswering(404, { error: { message: "NOT_FOUND", code: -32004, data: { code: "NOT_FOUND", httpStatus: 404 } } }),
    );
    const result = await tools.getStudentContext({ studentId: "00000000-0000-4000-8000-000000000001" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^not found/);
  });

  it("return the homework format and the game result format, each with its version", async () => {
    const seen: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      seen.push(String(input));
      const name = String(input).includes("agent.gameResultFormat") ? "Game result" : "Homework";
      const body = [{ result: { data: { version: 1, description: `# ${name} format, version 1` } } }];
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await createTools(createPlatform("https://platform.example.test", "test-token", fakeFetch)).getHomeworkFormat();
    expect(seen.some((url) => url.includes("/api/trpc/agent.homeworkFormat"))).toBe(true);
    expect(seen.some((url) => url.includes("/api/trpc/agent.gameResultFormat"))).toBe(true);
    expect(result.content[0]!.text).toMatch(
      /^Homework format, version 1\n\n# Homework format, version 1\n\nGame result format, version 1\n\n# Game result format/,
    );
  });

  it("save a draft with a POST and pass the platform's message about an invalid homework back", async () => {
    const seen: { url?: string; auth?: string | null } = {};
    const saved = createTools(
      platformAnswering(200, { result: { data: { id: "00000000-0000-4000-8000-000000000002" } } }, seen),
    );
    const ok = await saved.saveHomeworkDraft({ studentId: "00000000-0000-4000-8000-000000000001", homework: {} });
    expect(seen.url).toContain("/api/trpc/agent.saveHomeworkDraft");
    expect(JSON.parse(ok.content[0]!.text)).toMatchObject({ id: "00000000-0000-4000-8000-000000000002", status: "draft" });

    const refused = createTools(
      platformAnswering(400, {
        error: {
          message: "Задание 2, поле type: неизвестный тип «riddle»",
          code: -32600,
          data: { code: "BAD_REQUEST", httpStatus: 400 },
        },
      }),
    );
    const result = await refused.saveHomeworkDraft({ studentId: "00000000-0000-4000-8000-000000000001", homework: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^invalid homework/);
    expect(result.content[0]!.text).toContain("Задание 2, поле type");
  });

  it("save a game draft to the library and pass a refusal back as a refused game", async () => {
    const seen: { url?: string; auth?: string | null } = {};
    const tags = { title: "Zoo quiz", level: "A2" as const, topic: "animals", ageGroup: "younger" as const };
    const saved = createTools(platformAnswering(200, { result: { data: { id: "00000000-0000-4000-8000-000000000003" } } }, seen));
    const ok = await saved.saveGameDraft({ ...tags, html: "<!doctype html><html></html>" });
    expect(seen.url).toContain("/api/trpc/agent.saveGameDraft");
    expect(JSON.parse(ok.content[0]!.text)).toMatchObject({ id: "00000000-0000-4000-8000-000000000003", status: "draft" });

    const refused = createTools(
      platformAnswering(400, {
        error: { message: "Это не HTML-страница", code: -32600, data: { code: "BAD_REQUEST", httpStatus: 400 } },
      }),
    );
    const result = await refused.saveGameDraft({ ...tags, html: "not html" });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^game refused, nothing was saved/);
  });
});

describe("textbook tools (#150)", () => {
  it("return a page as an image and a refused structure as words to fix", async () => {
    const page = createTools(platformAnswering(200, { result: { data: { contentType: "image/jpeg", base64: "AAAA" } } }));
    expect(await page.getTextbookPage({ bookId: "00000000-0000-4000-8000-000000000001", page: 1 })).toEqual({
      content: [{ type: "image", data: "AAAA", mimeType: "image/jpeg" }],
    });
    const refused = createTools(
      platformAnswering(400, { error: { message: "юнит 1, урок 2: трека «9-99» нет в учебнике", code: -32600, data: { code: "BAD_REQUEST", httpStatus: 400 } } }),
    );
    const result = await refused.saveTextbookStructure({ textbookId: "00000000-0000-4000-8000-000000000001", structure: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toMatch(/^invalid textbook structure, nothing was saved/);
  });
});

describe("task bank tools (#224)", () => {
  it("send a lesson's tasks as a draft and a refused draft back as words to fix", async () => {
    const saved = createTools(platformAnswering(200, { result: { data: { status: "draft" } } }));
    const ok = await saved.saveTextbookLessonTasks({ textbookId: "00000000-0000-4000-8000-000000000001", lessonId: "00000000-0000-4000-8000-000000000002", tasks: [] });
    expect(ok.isError).toBeUndefined();
    expect(ok.content[0]!.text).toContain('"status": "draft"');
    const refused = createTools(
      platformAnswering(400, { error: { message: "Задание 1, поле source: укажите книгу, страницу и упражнение", code: -32600, data: { code: "BAD_REQUEST", httpStatus: 400 } } }),
    );
    const result = await refused.saveTextbookLessonTasks({ textbookId: "00000000-0000-4000-8000-000000000001", lessonId: "00000000-0000-4000-8000-000000000002", tasks: [{}] });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^invalid lesson tasks, nothing was saved/);
  });
});
