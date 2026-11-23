import Link from "next/link";

/** «Замер» in the student's «Материалы урока» (#253): the assessment the teacher opened in the lesson; nothing when there is none. */
export function StudentAssessmentList({ assessments }: { assessments: { id: string; title: string }[] }) {
  if (assessments.length === 0) return null;
  return (
    <section aria-labelledby="student-assessments" className="flex flex-col gap-3">
      <h2 id="student-assessments" className="text-answer font-bold">
        Замер
      </h2>
      <ul className="flex flex-col gap-2">
        {assessments.map((assessment) => (
          <li key={assessment.id}>
            <Link
              href={`/s/assessments/${assessment.id}`}
              className="flex rounded-task border border-border bg-accent-50 px-4 py-3 text-answer font-semibold text-accent-900"
            >
              {assessment.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
