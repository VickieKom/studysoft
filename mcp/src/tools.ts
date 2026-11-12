// The assistant's tools: thin wrappers over agent procedures. Each answers
// with JSON text; the assistant reads it.
import { z } from "zod";
import type { Platform } from "./platform";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** Errors reach the assistant as plain words, never as a stack. */
function failure(error: unknown): ToolResult {
  const code = (error as { data?: { code?: string } })?.data?.code;
  const message = (error as { message?: string })?.message ?? "";
  const text =
    code === "BAD_REQUEST"
      ? `invalid homework, nothing was saved; fix these and save again:\n${message}`
      : code === "UNAUTHORIZED"
      ? "unauthorized: the token is missing, wrong or revoked — create a new one in «Ассистент»"
      : code === "NOT_FOUND"
        ? "not found: there is no such student"
        : "the platform did not answer; try again later";
  return { content: [{ type: "text", text }], isError: true };
}

export const studentIdInput = { studentId: z.string().uuid().describe("The student's id from list_students") };

export const draftInput = {
  ...studentIdInput,
  homework: z
    .record(z.string(), z.unknown())
    .describe("The homework as JSON in the format from get_homework_format: { version, title, tasks }"),
};

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
    async getHomeworkFormat(): Promise<ToolResult> {
      try {
        const format = await platform.agent.homeworkFormat.query();
        return { content: [{ type: "text", text: `Homework format, version ${format.version}\n\n${format.description}` }] };
      } catch (error) {
        return failure(error);
      }
    },
    async saveHomeworkDraft({ studentId, homework }: { studentId: string; homework: unknown }): Promise<ToolResult> {
      try {
        const { id } = await platform.agent.saveHomeworkDraft.mutate({ studentId, homework });
        return json({ id, status: "draft", note: "Saved as a draft on the student's card; the teacher reviews and publishes it." });
      } catch (error) {
        return failure(error);
      }
    },
    async readHomeworkDraft({ studentId }: { studentId: string }): Promise<ToolResult> {
      try {
        return json(await platform.agent.readHomeworkDraft.query({ studentId }));
      } catch (error) {
        return failure(error);
      }
    },
  };
}
