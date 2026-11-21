// The router entry point: the only server module code outside src/server/ may
// import (AGENTS.md, rule 1). Client components import its types; server
// components and src/app/api/ use the server caller and the request handlers.
import { TRPCError } from "@trpc/server";
import { handleAuthRequest } from "../access/auth";
import { logProcedureError, serveRouter } from "./core/errors";
import { createCallerFactory, createContext, mergeRouters, router } from "./core/trpc";
import { agentHomeworkRouter } from "./agent/homework";
import { agentLibraryRouter } from "./agent/library";
import { agentPrepRouter } from "./agent/prep";
import { agentTextbooksRouter } from "./agent/textbooks";
import { agentStudentsRouter } from "./agent/students";
import { healthRouter } from "./public/health";
import { linksRouter } from "./public/links";
import { studentGamesRouter } from "./student/games";
import { studentVideosRouter } from "./student/videos";
import { studentVocabularyRouter } from "./student/vocabulary";
import { studentHomeworkRouter } from "./student/homework";
import { parentMeRouter } from "./parent/me";
import { parentProgressRouter } from "./parent/progress";
import { parentReportsRouter } from "./parent/reports";
import { studentMeRouter } from "./student/me";
import { historyRouter } from "./teacher/history";
import { homeworkRouter } from "./teacher/homework";
import { libraryRouter } from "./teacher/library";
import { paymentsRouter } from "./teacher/payments";
import { reviewRouter } from "./teacher/review";
import { scheduleRouter, settingsRouter } from "./teacher/schedule";
import { linksTeacherRouter } from "./teacher/links";
import { assistantRouter } from "./teacher/assistant";
import { notesRouter } from "./teacher/notes";
import { sessionRouter } from "./teacher/session";
import { studentsRouter } from "./teacher/students";
import { textbooksRouter } from "./teacher/textbooks";
import { goalRouter } from "./teacher/goal";
import { homeRouter } from "./teacher/home";
import { prepRouter } from "./teacher/prep";
import { reportsRouter } from "./teacher/reports";
import { progressRouter } from "./teacher/progress";
import { lessonModeRouter } from "./teacher/lesson-mode";

export const appRouter = router({
  health: healthRouter,
  links: linksRouter,
  student: mergeRouters(
    studentMeRouter,
    router({ homework: studentHomeworkRouter, games: studentGamesRouter, videos: studentVideosRouter, vocabulary: studentVocabularyRouter }),
  ),
  parent: mergeRouters(parentMeRouter, parentProgressRouter, parentReportsRouter),
  agent: mergeRouters(agentStudentsRouter, agentHomeworkRouter, agentLibraryRouter, agentTextbooksRouter, agentPrepRouter),
  teacher: router({
    session: sessionRouter,
    home: homeRouter,
    students: studentsRouter,
    assistant: assistantRouter,
    notes: notesRouter,
    progress: progressRouter,
    goal: goalRouter,
    reports: reportsRouter,
    links: linksTeacherRouter,
    homework: homeworkRouter,
    review: reviewRouter,
    library: libraryRouter,
    textbooks: textbooksRouter,
    prep: prepRouter,
    lessonMode: lessonModeRouter,
    history: historyRouter,
    schedule: scheduleRouter,
    payments: paymentsRouter,
    settings: settingsRouter,
  }),
});

export type AppRouter = typeof appRouter;

export const ROUTER_ENDPOINT = "/api/trpc";

const createCaller = createCallerFactory(appRouter);

/** Calls procedures in-process with the permissions of the given request headers. */
export function createServerCaller(headers: Headers) {
  return createCaller(createContext(headers), {
    onError: ({ error, path }) => logProcedureError(error, path),
  });
}

/** HTTP entry point for the router. */
export function handleRouterRequest(request: Request): Promise<Response> {
  return serveRouter(appRouter, ROUTER_ENDPOINT, request);
}

export { handleAuthRequest };

/** Pictures of homework tasks, served after a permission check (#33). */
export { handleHomeworkImageRequest } from "../homework/images";

/** A student's recordings and files for homework tasks: uploaded by the student, served to them and their teacher (#35). */
export { handleAnswerFileRequest, handleAnswerFileUpload } from "../homework/answer-files";
export { handleLibraryFileRequest, handleLibraryVideoUpload } from "../library/files";
export { handleTextbookFileRequest, handleTextbookUpload } from "../library/textbook-files";
/** Pictures and recordings of the task bank's tasks, served to their teacher only (#224). */
export { handleBankFileRequest } from "../library/task-bank";

/** True when a procedure refused because there is no valid session. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "UNAUTHORIZED";
}

/** True when a procedure answered "not found" — which also covers "not yours". */
export function isNotFound(error: unknown): boolean {
  return error instanceof TRPCError && error.code === "NOT_FOUND";
}
