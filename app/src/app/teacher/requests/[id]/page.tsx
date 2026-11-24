import Link from "next/link";
import { notFound } from "next/navigation";
import { IntroBooking, IntroOutcome } from "@/components/intro-lesson";
import { RequestBrief } from "@/components/request-brief";
import { todayIn } from "@/domain/homework";
import { REQUEST_SOURCE_LABELS, REQUEST_STAGE_LABELS } from "@/domain/requests";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Заявка — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A request's page (#339): who, from where, at what stage, and «Бриф»,
 * filled in during the intro. «Записать на вводный», the games played on the
 * intro's stage and «Итог вводного» (#338). Another teacher's request and a
 * missing one end in the same 404.
 */
export default async function RequestPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  let request;
  let brief;
  let games;
  try {
    request = await caller.teacher.requests.get({ id });
    brief = await caller.teacher.requests.brief({ id });
    games = await caller.teacher.requests.introGames({ id });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  return (
    <main className="flex flex-col gap-4">
      <p>
        <Link href="/teacher/requests" className="text-small text-green-600 hover:text-green-700">
          ← Привлечение клиентов
        </Link>
      </p>
      <h1 className="text-h1 font-bold">{request.firstName}</h1>
      <p className="flex flex-wrap gap-3 text-small text-text-secondary">
        <span>{REQUEST_STAGE_LABELS[request.stage]}</span>
        <span>{REQUEST_SOURCE_LABELS[request.source]}</span>
        {request.age !== null && <span>{request.age} лет</span>}
        {request.schoolYear && <span>{request.schoolYear} класс</span>}
        {request.contact && <span>{request.contact}</span>}
      </p>
      {/* Booked from «Заявка» only (#338): later stages have their intro, or are past it. */}
      {request.stage === "request" && <IntroBooking requestId={request.id} today={todayIn((await caller.teacher.settings.get()).timeZone)} />}
      {games.length > 0 && (
        <section aria-label="Игры на вводном" className="flex flex-col gap-3 rounded-card border border-border p-4">
          <h2 className="text-h3 font-semibold">Игры на вводном</h2>
          {games.map((game) => (
            <div key={game.id} className="flex flex-col gap-1 text-small">
              <span className="font-semibold">{game.title}</span>
              <ul className="flex flex-col gap-1">
                {game.answers.map((answer, index) => (
                  <li key={index}>
                    {answer.correct ? "✓" : "✗"} {answer.task} — «{answer.answer}»
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
      <IntroOutcome requestId={request.id} level={request.introLevel} notes={request.introNotes} />
      <RequestBrief requestId={request.id} brief={brief} />
    </main>
  );
}
