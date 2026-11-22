import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssessmentRunner } from "@/components/assessment-runner";
import { createServerCaller, isNotFound, isUnauthorized } from "@/server/router";

export const metadata = { title: "Замер — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The monthly assessment the teacher opened to the student in a lesson
 * (#253), section by section. One not open to this student, a closed one, a
 * missing one and no session all end in the same 404 page.
 */
export default async function StudentAssessmentPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const caller = createServerCaller(await headers());
  let assessment;
  try {
    assessment = await caller.student.assessments.get({ id });
  } catch (error) {
    if (isNotFound(error) || isUnauthorized(error)) notFound();
    throw error;
  }

  return (
    <main className="flex flex-col gap-4">
      <p>
        <Link href="/s/materials" className="text-small text-accent-900">
          ← Материалы урока
        </Link>
      </p>
      <h1 className="text-task-title font-bold">{assessment.title}</h1>
      <AssessmentRunner assessment={assessment} />
    </main>
  );
}
