// The assistant's tools: thin wrappers over agent procedures. Each answers
// with JSON text; the assistant reads it.
import { z } from "zod";
import type { Platform } from "./platform";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** Errors reach the assistant as plain words, never as a stack. */
function failure(error: unknown): ToolResult {
  const code = (error as { data?: { code?: string } })?.data?.code;
  const text =
    code === "UNAUTHORIZED"
      ? "unauthorized: the token is missing, wrong or revoked — create a new one in «Ассистент»"
      : code === "NOT_FOUND"
        ? "not found: there is no such student"
        : "the platform did not answer; try again later";
  return { content: [{ type: "text", text }], isError: true };
}

export const studentIdInput = { studentId: z.string().uuid().describe("The student's id from list_students") };

export function createTools(platform: Platform) {
  return {
    async listStudents(): Promise<ToolResult> {
      try {
        return json(await platform.agent.listStudents.query());
      } catch (error) {
        return failure(error);
      }
    },
    async getStudentContext({ studentId }: { studentId: string }): Promise<ToolResult> {
      try {
        return json(await platform.agent.studentContext.query({ studentId }));
      } catch (error) {
        return failure(error);
      }
    },
  };
}
