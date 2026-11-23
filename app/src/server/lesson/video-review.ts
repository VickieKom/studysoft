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
import { libraryMaterial, videoAnswer, videoTasks } from "../db/schema";

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
  return videos.flatMap((video) => {
    const answered = byVideo.get(video.id);
    // The tasks as answered, once answered: a confirmation since does not rewrite what the child saw.
    const tasks = ((answered?.tasks ?? video.tasks) as Task[] | null) ?? [];
    if (tasks.length === 0) return [];
    const given = (answered?.answers as (Answer | null)[] | undefined) ?? [];
    const verdicts = (answered?.verdicts as (boolean | null)[] | undefined) ?? [];
    return [
      {
        id: video.id,
        title: video.title,
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
  });
}
