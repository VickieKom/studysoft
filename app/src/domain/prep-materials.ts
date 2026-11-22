// The library's materials in a lesson prep (#293): «Добавить из библиотеки»
// offers the games made for the lesson's student first, then the games
// linked to a textbook lesson that is a book stage of the plan, then the
// rest, each group by title as it comes. A game in both of the first two is
// listed once, in the first. Plain data only.

export const PREP_GROUP_LABELS = { forStudent: "Для ученика", forLessons: "К урокам плана", rest: "Остальные" } as const;

export type PrepMaterial = { id: string; kind: string; title: string; forStudent: boolean; textbookLessonId: string | null };

export function prepMaterialGroups<M extends PrepMaterial>(materials: M[], planLessonIds: string[]): { forStudent: M[]; forLessons: M[]; rest: M[] } {
  const lessons = new Set(planLessonIds);
  const forStudent = materials.filter((m) => m.kind === "game" && m.forStudent);
  const forLessons = materials.filter((m) => m.kind === "game" && !m.forStudent && m.textbookLessonId !== null && lessons.has(m.textbookLessonId));
  const first = new Set([...forStudent, ...forLessons].map((m) => m.id));
  return { forStudent, forLessons, rest: materials.filter((m) => !first.has(m.id)) };
}
