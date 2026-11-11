import { TRPCError } from "@trpc/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { closeDb } from "../../db/client";
import { serveRouter } from "./errors";
import { INTERNAL_ERROR_MESSAGE, publicProcedure, router } from "./trpc";

// A router that exists only in this test: one procedure fails the way a
// driver or a bug would, the other refuses on purpose.
const testRouter = router({
  boom: publicProcedure.output(z.null()).query(() => {
    throw new Error("relation \"student\" column \"secret detail\"");
  }),
  refused: publicProcedure.output(z.null()).query(() => {
    throw new TRPCError({ code: "NOT_FOUND", message: "Student not found" });
  }),
});

async function call(path: string) {
  const response = await serveRouter(testRouter, "/api/trpc", new Request(`http://localhost/api/trpc/${path}`));
  return { status: response.status, text: await response.text() };
}

afterEach(() => vi.restoreAllMocks());
afterAll(closeDb);

describe("router errors", () => {
  it("hide the text of an unexpected error from the client and log it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, text } = await call("boom");

    expect(status).toBe(500);
    expect(text).not.toContain("secret detail");
    expect(text).not.toContain("student");
    expect(JSON.parse(text).error.message).toBe(INTERNAL_ERROR_MESSAGE);

    expect(log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry).toMatchObject({ level: "error", event: "procedure_failed", path: "boom", errorId: expect.any(String) });
    expect(entry.message).toContain("secret detail");
  });

  it("keep the code and message of an error thrown on purpose, without logging it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, text } = await call("refused");

    expect(status).toBe(404);
    expect(JSON.parse(text).error.message).toBe("Student not found");
    expect(log).not.toHaveBeenCalled();
  });
});
