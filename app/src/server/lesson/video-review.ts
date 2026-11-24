// A video's tasks on the lesson stage (#328): the confirmed tasks of a video
// stage of the plan, with the student's answers given under the video in
// this lesson (#327), right or wrong, and the keys the stage shows only when
// the teacher says. Before the student answers, the tasks without answers.
// The stage and the panel are the teacher's windows.
import { and, eq, inArray } from "drizzle-orm";
import { answerKey, answerText } from "../../domain/homework";
import type { Answer, Task } from "../../domain/homework-format";
import type { StageVideo } from "../../domain/lesson-state";
import type { Database } from "../db/client";
import { tasksRevision } from "../library/task-bank";
import { EMPTY_BANK } from "../library/textbook-videos";
import { videoTaskError } from "../library/video-tasks";
import { libraryMaterial, textbookFile, textbookLessonTasks, textbookVideoAccess, videoAnswer, videoTasks } from "../db/schema";

/** The videos with these ids that have confirmed tasks, as their stages show them for this student and lesson. */
export async function stageVideos(database: Database, teacherId: string, studentId: string, lessonId: string, ids: string[]): Promise<StageVideo[]> {
  if (ids.length === 0) return [];
  const videos = await database
    .select({ id: libraryMaterial.id, title: libraryMaterial.title, tasks: videoTasks.tasks })
    .from(libraryMaterial)
    .innerJoin(videoTasks, and(eq(videoTasks.materialId, libraryMaterial.id), eq(videoTasks.teacherId, teacherId)))
    .where(and(eq(libraryMaterial.teacherId, teacherId), eq(libraryMaterial.kind, "video"), inArray(libraryMaterial.id, ids)));
  const answers = await database
    .select({ materialId: videoAnswer.materialId, tasks: videoAnswer.tasks, answers: videoAnswer.answers, verdicts: videoAnswer.verdicts })
    .from(videoAnswer)
    .where(and(eq(videoAnswer.teacherId, teacherId), eq(videoAnswer.studentId, studentId), eq(videoAnswer.lessonId, lessonId), inArray(videoAnswer.materialId, ids)));
  const byVideo = new Map(answers.map((a) => [a.materialId, a]));
  return videos.flatMap((video) => reviewed(video.id, video.title, (video.tasks as Task[] | null) ?? [], byVideo.get(video.id)));
}

type Answered = { tasks: unknown; answers: unknown; verdicts: unknown };

/** One video's tasks as its stage shows them: as answered, once answered — a confirmation since does not rewrite what the child saw. */
function reviewed(id: string, title: string, confirmed: Task[], answered: Answered | undefined): StageVideo[] {
  const tasks = ((answered?.tasks as Task[] | undefined) ?? confirmed) ?? [];
  if (tasks.length === 0) return [];
  const given = (answered?.answers as (Answer | null)[] | undefined) ?? [];
  const verdicts = (answered?.verdicts as (boolean | null)[] | undefined) ?? [];
  return [
    {
      id,
      title,
      answered: answered !== undefined,
      tasks: tasks.map((task, index) => ({
        index,
        prompt: task.prompt,
        passage: task.passage ?? null,
        answer: answered ? answerText(task, given[index] ?? null) : null,
        verdict: answered ? (verdicts[index] ?? null) : null,
        key: answerKey(task),
        sentences: null,
        file: null,
      })),
    },
  ];
}

/**
 * The textbook video stages' tasks (#329), by file: the tasks opened to the
 * student from the preparation, or before that the bank tasks the stage
 * picked — none once the bank changed since the plan was saved (#381) —
 * with the student's answers from this lesson.
 */
export async function textbookStageVideos(
  database: Database,
  teacherId: string,
  studentId: string,
  lessonId: string,
  stages: { fileId: string; lessonId: string; tasks: number[]; revision: string }[],
): Promise<StageVideo[]> {
  if (stages.length === 0) return [];
  const fileIds = [...new Set(stages.map((s) => s.fileId))];
  const names = await database
    .select({ id: textbookFile.id, name: textbookFile.name })
    .from(textbookFile)
    .where(inArray(textbookFile.id, fileIds));
  const opened = await database
    .select({ fileId: textbookVideoAccess.fileId, tasks: textbookVideoAccess.tasks })
    .from(textbookVideoAccess)
    .where(and(eq(textbookVideoAccess.teacherId, teacherId), eq(textbookVideoAccess.lessonId, lessonId), inArray(textbookVideoAccess.fileId, fileIds)));
  const banks = await database
    .select({ lessonId: textbookLessonTasks.lessonId, tasks: textbookLessonTasks.tasks, revision: tasksRevision })
    .from(textbookLessonTasks)
    .where(and(eq(textbookLessonTasks.teacherId, teacherId), inArray(textbookLessonTasks.lessonId, [...new Set(stages.map((s) => s.lessonId))])));
  const answers = await database
    .select({ materialId: videoAnswer.materialId, tasks: videoAnswer.tasks, answers: videoAnswer.answers, verdicts: videoAnswer.verdicts })
    .from(videoAnswer)
    .where(and(eq(videoAnswer.teacherId, teacherId), eq(videoAnswer.studentId, studentId), eq(videoAnswer.lessonId, lessonId), inArray(videoAnswer.materialId, fileIds)));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const openedOf = new Map(opened.map((o) => [o.fileId, o.tasks as Task[]]));
  const bankOf = new Map(banks.map((b) => [b.lessonId, { tasks: (b.tasks as Task[] | null) ?? [], revision: b.revision }]));
  const byFile = new Map(answers.map((a) => [a.materialId, a]));
  const seen = new Set<string>();
  return stages.flatMap((stage) => {
    if (seen.has(stage.fileId) || !nameOf.has(stage.fileId)) return [];
    seen.add(stage.fileId);
    // Not opened yet: the bank's tasks by position, only while the bank is as the plan saw it and only those fit for a video (#381).
    const bank = bankOf.get(stage.lessonId) ?? { tasks: [], revision: EMPTY_BANK };
    const fresh = bank.revision === stage.revision;
    const picked = openedOf.get(stage.fileId) ?? (fresh ? stage.tasks.flatMap((i) => (bank.tasks[i] && videoTaskError(bank.tasks[i]) === null ? [bank.tasks[i]] : [])) : []);
    return reviewed(stage.fileId, nameOf.get(stage.fileId)!, picked, byFile.get(stage.fileId));
  });
}
