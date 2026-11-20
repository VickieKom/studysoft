import Link from "next/link";

export type StudentSection = "materials" | "homework" | "words";

const SECTIONS: { id: StudentSection; href: string; label: string }[] = [
  { id: "materials", href: "/s/materials", label: "Материалы урока" },
  { id: "homework", href: "/s", label: "Домашка" },
  { id: "words", href: "/s/words", label: "Тренировка слов" },
];

/**
 * The sections behind the student's link (#241): «Материалы урока» — the
 * games and videos the teacher opened in a lesson — «Домашка» and
 * «Тренировка слов», the student's words (#236). At the
 * bottom of the screen, as on a phone. While something from the lesson is
 * open, its item carries a mark, so the child does not miss it.
 */
export function StudentNav({ current, lessonOpen }: { current: StudentSection; lessonOpen: boolean }) {
  return (
    <nav aria-label="Разделы" className="fixed inset-x-0 bottom-0 border-t border-border bg-bg">
      <ul className="mx-auto flex max-w-md">
        {SECTIONS.map((section) => (
          <li key={section.id} className="flex-1">
            <Link
              href={section.href}
              aria-current={current === section.id ? "page" : undefined}
              className={`flex h-14 items-center justify-center gap-2 text-small font-semibold ${
                current === section.id ? "text-accent-900" : "text-text-secondary"
              }`}
            >
              {section.label}
              {section.id === "materials" && lessonOpen && (
                <span role="img" aria-label="Открыто на уроке" className="size-2.5 rounded-full bg-accent-500" />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
