import Link from "next/link";
import { Fragment } from "react";
import { CopyLinkButton } from "@/components/copy-link-button";
import { FamilyGoal } from "@/components/family-goal";
import { ReissueLinkButton } from "@/components/reissue-link-button";
import { PastSubmissions } from "@/components/past-submissions";
import { StudentHomework } from "@/components/student-homework";
import { FeedbackSeen } from "@/components/feedback-seen";
import { FeedbackRating, StudentFeedback } from "@/components/student-feedback";
import { likedMost, newestAnswer, splitFeedback } from "@/domain/feedback-rating";
import { StudentMistakes } from "@/components/student-mistakes";
import { StudentAssessments } from "@/components/student-assessments";
import { StudentProgress } from "@/components/student-progress";
import { StudentReports } from "@/components/student-reports";
import { StudentVocabulary } from "@/components/student-vocabulary";
import { StudentSlots } from "@/components/schedule-controls";
import { StudentTextbook } from "@/components/student-textbook";
import { dateIn, dayMonthIn, LESSON_STATUS_LABELS } from "@/domain/schedule";
import { StudentNotes } from "@/components/student-notes";
import { StudentPayments } from "@/components/student-payments";
import { CONTACT_FIELDS, PROFILE_FIELDS, STATUS_LABELS, timeZoneLabel } from "@/domain/student";
import { teacherCaller } from "../../caller";
import { studentOrNotFound } from "../student";

export const metadata = { title: "Ученик — StudySoft" };

type Props = { params: Promise<{ id: string }> };

export default async function StudentCardPage({ params }: Props) {
  const student = await studentOrNotFound((await params).id);
  const { caller } = await teacherCaller();
  const notes = await caller.teacher.notes.list({ studentId: student.id });
  const slots = await caller.teacher.schedule.slots({ studentId: student.id });
  const history = await caller.teacher.schedule.history({ studentId: student.id });
  const { timeZone } = await caller.teacher.settings.get();
  const money = await caller.teacher.payments.get({ studentId: student.id });
  const homework = await caller.teacher.homework.list({ studentId: student.id });
  const past = await caller.teacher.history.list({ studentId: student.id });
  const mistakes = await caller.teacher.students.mistakes({ studentId: student.id });
  const feedback = await caller.teacher.students.feedback({ studentId: student.id });
  const surveys = await caller.teacher.students.surveyFeedback({ studentId: student.id });
  const rating = await caller.teacher.students.feedbackRating({ studentId: student.id });
  // «Фидбэк» lists the week's answers and those not seen yet (#333), the rest under «Все ответы»; the ratings count them all.
  const { seenAt } = await caller.teacher.students.feedbackSeen({ studentId: student.id });
  const now = Date.now();
  const answers = splitFeedback(feedback, seenAt, now);
  const surveyAnswers = splitFeedback(surveys, seenAt, now);
  const vocabulary = await caller.teacher.students.vocabulary({ studentId: student.id });
  const { results, ...totals } = await caller.teacher.progress.get({ studentId: student.id });
  const book = await caller.teacher.prep.studentTextbook({ studentId: student.id });
  const [nextLesson] = await caller.teacher.prep.list({ studentId: student.id });
  const { values: measureValues, ...goal } = await caller.teacher.goal.get({ studentId: student.id });
  const reports = await caller.teacher.reports.list({ studentId: student.id });
  const assessments = await caller.teacher.assessments.list({ studentId: student.id });

  return (
    <main>
      <p className="mb-4">
        <Link href="/teacher/students" className="text-small text-green-600 hover:text-green-700">
          ← Ученики
        </Link>
      </p>
      <div className="rounded-card border border-border p-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-h1 font-bold">{student.firstName}</h1>
            {student.lastName && <p className="text-h3 text-text-secondary">{student.lastName}</p>}
          </div>
          <div className="flex items-start gap-2">
            <Link
              href={`/teacher/students/${student.id}/edit`}
              className="inline-flex h-10 items-center rounded-control border border-border px-4 text-button font-semibold hover:bg-surface"
            >
              Изменить
            </Link>
          </div>
        </header>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
          <dt className="text-text-secondary">Статус</dt>
          <dd>{STATUS_LABELS[student.status]}</dd>
          <dt className="text-text-secondary">Уровень</dt>
          <dd>{student.level}</dd>
          <dt className="text-text-secondary">Часовой пояс</dt>
          <dd>{timeZoneLabel(student.timeZone)}</dd>
          {PROFILE_FIELDS.filter((field) => student[field.key]).map((field) => (
            <Fragment key={field.key}>
              <dt className="text-text-secondary">{field.label}</dt>
              <dd className="whitespace-pre-line">{student[field.key]}</dd>
            </Fragment>
          ))}
          {/* Contacts (#84): the teacher's only; empty ones leave no label. */}
          {CONTACT_FIELDS.filter((field) => student.contacts[field.key]).map((field) => (
            <Fragment key={field.key}>
              <dt className="text-text-secondary">{field.label}</dt>
              <dd>{student.contacts[field.key]}</dd>
            </Fragment>
          ))}
        </dl>
        <FamilyGoal studentId={student.id} goal={goal} values={measureValues} />
        <section aria-label="Учебник ученика" className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <h2 className="text-small font-semibold text-text-secondary">Учебник ученика</h2>
          <StudentTextbook studentId={student.id} textbookId={book.textbookId} passedLessonId={book.passedLessonId} textbooks={book.textbooks} />
          {nextLesson && (
            <Link href={`/teacher/prep/${nextLesson.id}`} className="self-start text-small text-green-600 hover:text-green-700">
              Подготовка к уроку {dayMonthIn(new Date(nextLesson.startsAt), timeZone)}
              {nextLesson.prepared ? " · подготовлен" : ""}
            </Link>
          )}
        </section>
        <StudentSlots studentId={student.id} slots={slots} today={dateIn(new Date(), student.timeZone)} />
        <section aria-label="История уроков" className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          <h2 className="text-small font-semibold text-text-secondary">История уроков</h2>
          {history.length === 0 ? (
            <p className="text-small text-text-secondary">Прошедших уроков пока нет</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.map((lesson) => (
                <li key={lesson.id} className="flex flex-wrap gap-x-3 text-small">
                  <span className="font-semibold">{dayMonthIn(new Date(lesson.startsAt), timeZone)}</span>
                  {lesson.needsMark ? (
                    <span className="text-danger">отметьте урок</span>
                  ) : (
                    lesson.status !== "scheduled" && <span>{LESSON_STATUS_LABELS[lesson.status]}</span>
                  )}
                  {lesson.movedFrom && (
                    <span className="text-text-secondary">перенесён с {dayMonthIn(new Date(lesson.movedFrom), timeZone)}</span>
                  )}
                  {lesson.kind === "intro" && <span>вводный</span>}
                  {lesson.status !== "scheduled" && lesson.kind !== "intro" && (
                    <span className="text-text-secondary">{lesson.charged ? "списан" : "не списан"}</span>
                  )}
                  {lesson.unit && <span>{lesson.unit}</span>}
                  {lesson.note && <span className="w-full whitespace-pre-line text-text-secondary">{lesson.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <StudentPayments studentId={student.id} {...money} />
        <section aria-label="Ссылки" className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
          {student.status === "finished" ? (
            // "Завершили" closes both links (#21); coming back gives new ones.
            <p className="text-small text-text-secondary">Ссылки закрыты, пока ученик в статусе «Завершили»</p>
          ) : (
            (["student", "parent"] as const).map((role) => (
              <div key={role} className="flex flex-wrap items-center gap-2">
                <CopyLinkButton studentId={student.id} role={role} />
                <ReissueLinkButton studentId={student.id} role={role} />
              </div>
            ))
          )}
        </section>
      </div>
      <StudentProgress studentId={student.id} results={results} totals={totals} likedMost={likedMost(rating.materials, rating.tasks)} />
      <StudentAssessments studentId={student.id} assessments={assessments} />
      <StudentHomework studentId={student.id} homework={homework} />
      <StudentMistakes topics={mistakes} timeZone={timeZone} />
      <FeedbackSeen studentId={student.id} upTo={newestAnswer([...answers.shown, ...surveyAnswers.shown])}>
        <StudentFeedback
          entries={answers.shown}
          surveys={surveyAnswers.shown}
          olderEntries={answers.older}
          olderSurveys={surveyAnswers.older}
          timeZone={timeZone}
        />
      </FeedbackSeen>
      <FeedbackRating rating={rating} />
      <StudentVocabulary studentId={student.id} words={vocabulary} timeZone={timeZone} />
      <PastSubmissions submissions={past} />
      <StudentNotes studentId={student.id} notes={notes} />
      {/* Last on the card: scenarios read the notes' first list item (#267). */}
      <StudentReports studentId={student.id} reports={reports} />
    </main>
  );
}
