// MCP server for the teacher's assistant (#3; architecture 3.2, 8.8). Runs on
// the teacher's computer over stdio; talks to the platform with the token the
// teacher created in «Ассистент».
//
//   STUDYSOFT_URL    the platform's address, e.g. https://… (no trailing path)
//   STUDYSOFT_TOKEN  the assistant's token
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlatform } from "./platform";
import { createTools, draftInput, studentIdInput } from "./tools";

const url = process.env.STUDYSOFT_URL;
const token = process.env.STUDYSOFT_TOKEN;
if (!url || !token) {
  console.error("Set STUDYSOFT_URL and STUDYSOFT_TOKEN (see «Ассистент» in the workspace).");
  process.exit(1);
}

const tools = createTools(createPlatform(url, token));
const server = new McpServer({ name: "studysoft", version: "0.1.0" });

server.registerTool(
  "list_students",
  {
    title: "List students",
    description: "The teacher's students: id, first name and status. Use the id with get_student_context.",
  },
  () => tools.listStudents(),
);

server.registerTool(
  "get_student_context",
  {
    title: "Student context",
    description:
      "What the teacher knows about a student for preparing homework: first name, age, school year, CEFR level, " +
      "textbook and current unit, interests, what works, gaps, and the latest notes.",
    inputSchema: studentIdInput,
  },
  (input) => tools.getStudentContext(input),
);

server.registerTool(
  "get_homework_format",
  {
    title: "Homework format",
    description:
      "The homework format the platform accepts, with its version: task types, keys, topic, skill, source. " +
      "Read it before writing a homework.",
  },
  () => tools.getHomeworkFormat(),
);

server.registerTool(
  "save_homework_draft",
  {
    title: "Save a homework draft",
    description:
      "Saves a homework for a student as a draft on their card, marked «от ассистента». Saving again replaces " +
      "your draft until the teacher edits it; after that a new draft is made and hers is kept. Only the teacher " +
      "publishes. An invalid homework is refused with the task and field to fix.",
    inputSchema: draftInput,
  },
  (input) => tools.saveHomeworkDraft(input),
);

server.registerTool(
  "read_homework_draft",
  {
    title: "Read your homework draft",
    description:
      "Your latest draft for a student, as the teacher may have changed it, to revise it after her remarks. " +
      "null when there is none.",
    inputSchema: studentIdInput,
  },
  (input) => tools.readHomeworkDraft(input),
);

await server.connect(new StdioServerTransport());
