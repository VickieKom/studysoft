import Link from "next/link";

/** «Игры» on the student's page (#118): the games the teacher opened during a lesson; nothing when there are none. */
export function StudentGames({ games }: { games: { id: string; title: string }[] }) {
  if (games.length === 0) return null;
  return (
    <section aria-labelledby="student-games" className="flex flex-col gap-3">
      <h2 id="student-games" className="text-answer font-bold">
        Игры
      </h2>
      <ul className="flex flex-col gap-2">
        {games.map((game) => (
          <li key={game.id}>
            <Link
              href={`/s/games/${game.id}`}
              className="flex rounded-task border border-border bg-accent-50 px-4 py-3 text-answer font-semibold text-accent-900"
            >
              {game.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
