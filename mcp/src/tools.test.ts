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

  it("return the homework format with its version", async () => {
    const tools = createTools(
      platformAnswering(200, { result: { data: { version: 1, description: "# Homework format, version 1" } } }),
    );
    const result = await tools.getHomeworkFormat();
    expect(result.content[0]!.text).toMatch(/^Homework format, version 1\n\n# Homework format/);
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
});
