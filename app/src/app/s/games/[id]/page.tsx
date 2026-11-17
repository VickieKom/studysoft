import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GAME_SANDBOX } from "@/domain/library";
import { createServerCaller, isNotFound, isUnauthorized } from "@/server/router";

export const metadata = { title: "Игра — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A game the teacher opened to the student (#118), in the same sandboxed
 * frame as hers. A game not open to this student, a closed one, a missing
 * one and no session all end in the same 404 page.
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
        <Link href="/s" className="text-small text-accent-900">
          ← На главную
        </Link>
      </p>
      <h1 className="text-task-title font-bold">{game.title}</h1>
      <iframe
        title={game.title}
        src={game.fileUrl}
        sandbox={GAME_SANDBOX}
        referrerPolicy="no-referrer"
        className="h-[75vh] w-full rounded-task border border-border bg-bg"
      />
    </main>
  );
}
