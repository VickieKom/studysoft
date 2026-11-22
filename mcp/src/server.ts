// MCP server for the teacher's assistant (#3; architecture 3.2, 8.8). Runs on
// the teacher's computer over stdio; talks to the platform with the token the
// teacher created in «Ассистент».
//
//   STUDYSOFT_URL    the platform's address, e.g. https://… (no trailing path)
//   STUDYSOFT_TOKEN  the assistant's token
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlatform } from "./platform";
import {
  createTools,
  draftInput,
  gameDraftInput,
  lessonIdInput,
  pageInput,
  planInput,
  structureInput,
  lessonTasksInput,
  studentIdInput,
  textbookIdInput,
  textInput,
  upcomingInput,
  warmupDraftInput,
  wordDraftsInput,
} from "./tools";

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
      "textbook and current unit, interests, what works, gaps, the latest notes, and the latest submitted homework " +
      "with the answers, right or wrong, the latest results of games the student played, and the mistakes by topic " +
      "from homework and games over the last 30 days, to repeat what was hard; and the student's vocabulary, the words " +
      "of the lessons covered with their translations, newest first, and the words the student misses more often than " +
      "not in the word training, to work into homework.",
    inputSchema: studentIdInput,
  },
  (input) => tools.getStudentContext(input),
);

server.registerTool(
  "list_student_words",
  {
    title: "The student's words",
    description:
      "The student's vocabulary with each word's id: the confirmed translation and example, and your draft if any. " +
      "Words from the textbook come without a translation.",
    inputSchema: studentIdInput,
  },
  (input) => tools.listStudentWords(input),
);

server.registerTool(
  "save_word_drafts",
  {
    title: "Propose translations and examples",
    description:
      "Saves a translation and an example sentence for words of the student's vocabulary as drafts «от ассистента» " +
      "on the student card. The student sees nothing until the teacher confirms; a confirmed translation stays until " +
      "then. Saving again replaces your draft. Use the ids from list_student_words. Only the teacher confirms.",
    inputSchema: wordDraftsInput,
  },
  (input) => tools.saveWordDrafts(input),
);

server.registerTool(
  "get_homework_format",
  {
    title: "Homework format",
    description:
      "The homework format the platform accepts, with its version: task types, keys, topic, skill, source; " +
      "the game result format, with which a game reports the student's answers to the platform; " +
      "and the game words format, in which a game template gets a student's words. " +
      "Read it before writing a homework or making a game.",
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

server.registerTool(
  "save_game_draft",
  {
    title: "Save a game draft to the library",
    description:
      "Saves a game you made — one self-contained HTML file — to the teacher's library as a draft, under «От ассистента». " +
      "Pass the id of your earlier draft to replace it while the teacher has neither edited nor added it; otherwise a new " +
      "draft is made. Only the teacher adds a draft to the library or deletes it. With vocabulary set, the game is a " +
      "template: it has no words of its own and gets a student's words in the game words format.",
    inputSchema: gameDraftInput,
  },
  (input) => tools.saveGameDraft(input),
);

server.registerTool(
  "save_warmup_draft",
  {
    title: "Save a warm-up draft to the library",
    description:
      "Saves a warm-up — a list of conversation questions or one picture — to the teacher's library as a draft, under " +
      "«От ассистента». Replacing works as for games. Only the teacher adds it to the library.",
    inputSchema: warmupDraftInput,
  },
  (input) => tools.saveWarmupDraft(input),
);

server.registerTool(
  "list_textbooks",
  {
    title: "List textbooks",
    description:
      "The teacher's textbooks: id, title, level, the books (id, students_book or workbook, rendering status, page count) " +
      "and the names of the tracks, and whether a structure is confirmed or a draft waits.",
  },
  () => tools.listTextbooks(),
);

server.registerTool(
  "read_textbook_text",
  {
    title: "Read a textbook's text",
    description:
      "The text layer of a book's pages, page by page, at most 20 pages at a time: headings, unit and lesson titles, " +
      "exercise numbers, word lists. Use it to find where each unit and lesson starts and ends.",
    inputSchema: textInput,
  },
  (input) => tools.readTextbookText(input),
);

server.registerTool(
  "get_textbook_page",
  {
    title: "See a textbook page",
    description: "One rendered page of a book as an image, for its pictures and layout when the text alone is not enough.",
    inputSchema: pageInput,
  },
  (input) => tools.getTextbookPage(input),
);

server.registerTool(
  "read_textbook_structure",
  {
    title: "Read a textbook's structure",
    description: "The confirmed units and lessons of a textbook and the draft waiting for the teacher, to revise it.",
    inputSchema: textbookIdInput,
  },
  (input) => tools.readTextbookStructure(input),
);

server.registerTool(
  "save_textbook_structure",
  {
    title: "Save a textbook's structure",
    description:
      "Saves the units and lessons of a textbook as a draft marked «от ассистента»: each lesson with its page ranges " +
      "in each book, the names of its tracks and its words. A unit's lessons are its numbered lessons (1.1–1.7); " +
      "sections like Get Culture! or Skills Revision are lessons of their own. Saving again replaces your draft. " +
      "Page ranges must lie within the book and tracks must be the textbook's. Only the teacher confirms; while she " +
      "has a draft of her own, yours is refused.",
    inputSchema: structureInput,
  },
  (input) => tools.saveTextbookStructure(input),
);

server.registerTool(
  "save_textbook_lesson_tasks",
  {
    title: "Save a textbook lesson's tasks",
    description:
      "Saves the tasks of one lesson of a textbook for the task bank, as a draft «от ассистента» under «Задания» on the " +
      "textbook's page: the lesson's workbook exercises turned into tasks in the homework format (get_homework_format), " +
      "each with its source, and the exercises that did not become tasks (listening without a recording, a word search…) " +
      "with the reason. Add a Student's Book exercise only when the teacher asks. The lesson must be in the confirmed " +
      "structure (read_textbook_structure). Saving again replaces your draft of the lesson; its confirmed tasks stay " +
      "until the teacher confirms the new draft. Only the teacher confirms.",
    inputSchema: lessonTasksInput,
  },
  (input) => tools.saveTextbookLessonTasks(input),
);

server.registerTool(
  "list_upcoming_lessons",
  {
    title: "Upcoming lessons",
    description: "The teacher's lessons in the next two weeks: id, student, start, minutes, and whether the lesson is prepared.",
    inputSchema: upcomingInput,
  },
  (input) => tools.listUpcomingLessons(input),
);

server.registerTool(
  "read_lesson_plan",
  {
    title: "Read a lesson's plan",
    description:
      "A lesson's approved plan, your draft if any, the plan the platform proposes (the student's next book lesson, " +
      "after the one passed) and the lessons of the student's textbook with their ids.",
    inputSchema: lessonIdInput,
  },
  (input) => tools.readLessonPlan(input),
);

server.registerTool(
  "list_lesson_materials",
  {
    title: "Library materials for a lesson",
    description: "The teacher's warm-ups, games and videos with their level and topic, to add as stages of a plan.",
    inputSchema: lessonIdInput,
  },
  (input) => tools.listLessonMaterials(input),
);

server.registerTool(
  "save_lesson_plan",
  {
    title: "Save a lesson plan",
    description:
      "Saves a lesson's plan as a draft «от ассистента» in «Подготовка»: stages in order with minutes — the book lesson " +
      "with the exercises to skip, and warm-ups, games or videos from the library. Read get_student_context and " +
      "read_lesson_plan first. Saving again replaces your draft. Only the teacher approves.",
    inputSchema: planInput,
  },
  (input) => tools.saveLessonPlan(input),
);

await server.connect(new StdioServerTransport());
