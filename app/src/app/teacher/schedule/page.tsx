import { AddLessonForm } from "@/components/schedule-controls";
import { WeekNav } from "@/components/week-nav";
import { addDays, dateIn, dayLabel, mondayOf, timeIn } from "@/domain/schedule";
import { timeZoneLabel } from "@/domain/student";
import { teacherCaller } from "../caller";

export const metadata = { title: "Расписание — StudySoft" };

type Props = { searchParams: Promise<{ week?: string }> };

/**
 * «Расписание» (#80): the week in the teacher's time zone — days and order by
 * her time — with each lesson's time for the student next to hers.
 */
export default async function SchedulePage({ searchParams }: Props) {
  const { caller } = await teacherCaller();
  const { timeZone } = await caller.teacher.settings.get();
  const requested = (await searchParams).week;
  const monday = mondayOf(
    requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : dateIn(new Date(), timeZone),
  );
  const week = await caller.teacher.schedule.week({ monday });
  const students = await caller.teacher.students.list();
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h1 font-bold">Расписание</h1>
        <WeekNav monday={monday} />
      </header>
      <AddLessonForm
        students={students.map((s) => ({ id: s.id, name: [s.firstName, s.lastName].filter(Boolean).join(" ") }))}
      />
      <p className="text-small text-text-secondary">Время — ваше ({timeZoneLabel(week.timeZone)}).</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
        {days.map((date) => {
          const lessons = week.lessons.filter((l) => dateIn(new Date(l.startsAt), week.timeZone) === date);
          return (
            <section key={date} aria-label={dayLabel(date)} className="flex flex-col gap-2 rounded-card border border-border p-2">
              <h2 className="text-small font-semibold">{dayLabel(date)}</h2>
              {lessons.map((l) => {
                const moment = new Date(l.startsAt);
                const sameZone = l.studentTimeZone === week.timeZone;
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`flex flex-col items-start rounded-control px-2 py-1 text-left text-small ${
                      l.kind === "intro" ? "border border-dashed border-green-600 bg-green-50" : "bg-accent-50"
                    }`}
                  >
                    <span className="font-semibold">
                      {timeIn(moment, week.timeZone)} {l.studentName}
                    </span>
                    {!sameZone && (
                      <span className="text-text-secondary">
                        у ученика {timeIn(moment, l.studentTimeZone)} ({timeZoneLabel(l.studentTimeZone)})
                      </span>
                    )}
                    <span className="text-text-muted">
                      {l.durationMinutes} мин{l.kind === "intro" && " · вводный"}
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </main>
  );
}
