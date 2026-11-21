import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StudentGameFrame } from "@/components/student-game-frame";
import { createServerCaller, isNotFound, isUnauthorized } from "@/server/router";

export const metadata = { title: "Игра — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A game the teacher opened to the student (#118), in the same sandboxed
 * frame as hers. A game not open to this student, a closed one, a missing
 * one and no session all end in the same 404 page. A result the game posts
 * is kept for the student's list of mistakes (#119).
 */
export default async function StudentGamePage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const caller = createServerCaller(await headers());
  let game;
  try {
    game = await caller.student.games.get({ id });
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
      <h1 className="text-task-title font-bold">{game.title}</h1>
      <StudentGameFrame id={game.id} title={game.title} fileUrl={game.fileUrl} />
    </main>
  );
}
