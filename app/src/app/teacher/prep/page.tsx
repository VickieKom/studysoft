import Link from "next/link";
import { formatPastDate } from "@/domain/homework";
import { dateIn, timeIn } from "@/domain/schedule";
import { teacherCaller } from "../caller";

export const metadata = { title: "Подготовка — StudySoft" };

/** «Подготовка» (#151): the lessons of the next two weeks by date, each «подготовлен» or not. */
export default async function PrepPage() {
  const { caller } = await teacherCaller();
  const [lessons, { timeZone }] = await Promise.all([caller.teacher.prep.list({}), caller.teacher.settings.get()]);
  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1 font-bold">Подготовка</h1>
        <p className="text-text-secondary">Уроки на две недели вперёд. План урока, материалы и домашка к нему</p>
      </header>
      {lessons.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-6 py-12 text-center text-text-secondary">
          В ближайшие две недели уроков нет
        </div>
      ) : (
        <ul aria-label="Предстоящие уроки" className="flex flex-col gap-2">
          {lessons.map((l) => {
            const moment = new Date(l.startsAt);
            return (
              <li key={l.id}>
                <Link
                  href={`/teacher/prep/${l.id}`}
                  className="flex flex-wrap items-center gap-3 rounded-card border border-border p-4 hover:bg-surface"
                >
                  <span className="font-semibold">{l.firstName}</span>
                  <span className="text-text-secondary">
                    {formatPastDate(dateIn(moment, timeZone))}, {timeIn(moment, timeZone)}
                  </span>
                  <span className={`text-small ${l.prepared ? "text-green-700" : "text-text-secondary"}`}>
                    {l.prepared ? "подготовлен" : "не подготовлен"}
                  </span>
                  {l.draft && <span className="text-small text-accent-700">план от ассистента</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
