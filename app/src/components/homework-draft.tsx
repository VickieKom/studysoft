"use client";

import { type ReactNode, useState } from "react";
import type { Task } from "@/domain/homework-format";
import { HomeworkDraftEditor } from "./homework-draft-editor";
import { HomeworkPublish } from "./homework-publish";
import type { DraftSurveyView } from "./homework-survey-box";

/**
 * A draft's page (#99): the publish form and the editor share the version of
 * the draft the teacher has seen. Her own saves move it on, so she can edit
 * and then publish; a draft the assistant replaced after the page loaded is
 * refused by both until she reloads.
 */
export function HomeworkDraft({
  homeworkId,
  tasks,
  revision: loaded,
  askFeedback,
  survey,
  children,
}: {
  homeworkId: string;
  tasks: Task[];
  revision: string;
  /** «Мини-вопрос после домашки» (#331). */
  askFeedback: boolean;
  /** «Опрос по урокам» (#332). */
  survey: DraftSurveyView;
  /** The heading: the title and the status. */
  children: ReactNode;
}) {
  const [revision, setRevision] = useState(loaded);
  return (
    <>
      <header className="mb-6 flex flex-col gap-3">
        {children}
        <HomeworkPublish
          homeworkId={homeworkId}
          status="draft"
          dueDate={null}
          revision={revision}
          askFeedback={askFeedback}
          survey={survey}
          oneKind={new Set(tasks.map((task) => task.type)).size < 2}
        />
      </header>
      <HomeworkDraftEditor homeworkId={homeworkId} tasks={tasks} revision={revision} onSaved={setRevision} />
    </>
  );
}
