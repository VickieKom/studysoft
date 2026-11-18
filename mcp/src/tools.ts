// The assistant's tools: thin wrappers over agent procedures. Each answers
// with JSON text; the assistant reads it.
import { z } from "zod";
import type { Platform } from "./platform";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

/** Errors reach the assistant as plain words, never as a stack. `refused` names what a BAD_REQUEST refused. */
function failure(error: unknown, refused = "invalid homework"): ToolResult {
  const code = (error as { data?: { code?: string } })?.data?.code;
  const message = (error as { message?: string })?.message ?? "";
  const text =
    code === "BAD_REQUEST"
      ? `${refused}, nothing was saved; fix these and save again:\n${message}`
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

// A game or a warm-up for the library (#120): its title and the tags the library filters by.
const libraryTags = {
  id: z
    .string()
    .uuid()
    .optional()
    .describe("The id of your earlier draft to replace; it is replaced while the teacher has neither edited nor added it"),
  title: z.string().describe("What the teacher sees in the library, up to 200 characters"),
  level: z.enum(["A1", "A2", "B1", "B2", "C1"]).describe("CEFR level"),
  topic: z.string().describe("A topic for the library's filter, up to 100 characters; empty for none"),
  ageGroup: z.enum(["younger", "teens"]).describe("younger children or teens"),
};

export const gameDraftInput = {
  ...libraryTags,
  html: z
    .string()
    .describe(
      "The whole game as one self-contained HTML file, at most 5 MB. To report the student's answers it posts a result " +
        "in the game result format (see get_homework_format)",
    ),
};

export const warmupDraftInput = {
  ...libraryTags,
  format: z.enum(["questions", "picture"]).describe("A list of conversation questions or one picture"),
  questions: z.array(z.string()).optional().describe("For questions: 1 to 30, each up to 300 characters"),
  picture: z.string().optional().describe("For a picture: PNG, JPEG or WebP as base64, at most 2 MB"),
};

type LibraryTags = { id?: string; title: string; level: "A1" | "A2" | "B1" | "B2" | "C1"; topic: string; ageGroup: "younger" | "teens" };

const savedToLibrary = (id: string) =>
  json({ id, status: "draft", note: "Saved as a draft in «Библиотека» under «От ассистента»; the teacher adds it to the library." });

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
        // Games report results in a format of their own (#119): the assistant gets it with the homework format.
        const game = await platform.agent.gameResultFormat.query();
        const text =
          `Homework format, version ${format.version}\n\n${format.description}\n\n` +
          `Game result format, version ${game.version}\n\n${game.description}`;
        return { content: [{ type: "text", text }] };
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
    async saveGameDraft(input: LibraryTags & { html: string }): Promise<ToolResult> {
      try {
        return savedToLibrary((await platform.agent.saveGameDraft.mutate(input)).id);
      } catch (error) {
        return failure(error, "game refused");
      }
    },
    async saveWarmupDraft({
      format,
      questions,
      picture,
      ...tags
    }: LibraryTags & { format: "questions" | "picture"; questions?: string[]; picture?: string }): Promise<ToolResult> {
      try {
        const saved =
          format === "questions"
            ? await platform.agent.saveWarmupDraft.mutate({ ...tags, format, questions: questions ?? [] })
            : await platform.agent.saveWarmupDraft.mutate({ ...tags, format, picture: picture ?? "" });
        return savedToLibrary(saved.id);
      } catch (error) {
        return failure(error, "warm-up refused");
      }
    },
  };
}
