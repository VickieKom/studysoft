import Link from "next/link";
import { Fragment } from "react";
import { CopyLinkButton } from "@/components/copy-link-button";
import { StudentNotes } from "@/components/student-notes";
import { PROFILE_FIELDS, STATUS_LABELS, timeZoneLabel } from "@/domain/student";
import { teacherCaller } from "../../caller";
import { studentOrNotFound } from "../student";

export const metadata = { title: "Ученик — StudySoft" };

type Props = { params: Promise<{ id: string }> };

export default async function StudentCardPage({ params }: Props) {
  const student = await studentOrNotFound((await params).id);
  const { caller } = await teacherCaller();
  const notes = await caller.teacher.notes.list({ studentId: student.id });

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
            <CopyLinkButton studentId={student.id} role="student" />
            <CopyLinkButton studentId={student.id} role="parent" />
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
        </dl>
      </div>
      <StudentNotes studentId={student.id} notes={notes} />
    </main>
  );
}
