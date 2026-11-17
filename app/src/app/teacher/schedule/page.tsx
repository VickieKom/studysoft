import { cookies } from "next/headers";
import { DayNav } from "@/components/day-nav";
import { LessonCard } from "@/components/lesson-card";
import { AddLessonForm } from "@/components/schedule-controls";
import { ScheduleViewSwitch } from "@/components/schedule-view-switch";
import { WeekNav } from "@/components/week-nav";
import { addDays, dateIn, dayLabel, mondayOf, SCHEDULE_VIEW_COOKIE, scheduleView } from "@/domain/schedule";
import { TIME_ZONES, timeZoneLabel } from "@/domain/student";
import { teacherCaller } from "../caller";

export const metadata = { title: "Расписание — StudySoft" };

type Props = { searchParams: Promise<{ view?: string; week?: string; day?: string }> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * «Расписание» (#80): the week in the teacher's time zone — days and order by
 * her time — with each lesson's time for the student next to hers. «День» is
 * one day of it and «Список» the lessons from now on by date (#85); the view
 * comes from the address, else from the one this browser last showed.
 */
export default async function SchedulePage({ searchParams }: Props) {
  const { caller } = await teacherCaller();
  const params = await searchParams;
  const view = scheduleView(params.view) ?? scheduleView((await cookies()).get(SCHEDULE_VIEW_COOKIE)?.value) ?? "week";
  const { timeZone } = await caller.teacher.settings.get();
  const today = dateIn(new Date(), timeZone);
  const day = params.day && ISO_DATE.test(params.day) ? params.day : today;
  const monday = mondayOf(
    view === "day" ? day : params.week && ISO_DATE.test(params.week) ? params.week : today,
  );
  const found =
    view === "list" ? await caller.teacher.schedule.upcoming() : await caller.teacher.schedule.week({ monday });
  const students = await caller.teacher.students.list();
  const dayOf = (startsAt: string) => dateIn(new Date(startsAt), found.timeZone);
  const days =
    view === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(monday, i))
      : view === "day"
        ? [day]
        : [...new Set(found.lessons.map((l) => dayOf(l.startsAt)))];
  const now = new Date();
  const zoneLabels = Object.fromEntries(TIME_ZONES.map((z) => [z.id, z.label]));

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-h1 font-bold">Расписание</h1>
        <div className="flex flex-wrap items-center gap-3">
          <ScheduleViewSwitch view={view} />
          {view === "week" && <WeekNav monday={monday} />}
          {view === "day" && <DayNav day={day} />}
        </div>
      </header>
      <AddLessonForm
        students={students.map((s) => ({ id: s.id, name: [s.firstName, s.lastName].filter(Boolean).join(" ") }))}
      />
      <p className="text-small text-text-secondary">Время — ваше ({timeZoneLabel(found.timeZone)}).</p>
      {view === "list" && days.length === 0 && <p>Ближайших уроков нет.</p>}
      <div className={view === "week" ? "grid grid-cols-1 gap-3 md:grid-cols-7" : "flex max-w-xl flex-col gap-3"}>
        {days.map((date) => {
          const lessons = found.lessons.filter((l) => dayOf(l.startsAt) === date);
          return (
            <section key={date} aria-label={dayLabel(date)} className="flex flex-col gap-2 rounded-card border border-border p-2">
              <h2 className="text-small font-semibold">{dayLabel(date)}</h2>
              {view === "day" && lessons.length === 0 && <p className="text-small text-text-muted">Уроков нет</p>}
              {lessons.map((l) => (
                <div key={l.id} className="flex flex-col gap-1">
                  <LessonCard lesson={l} started={new Date(l.startsAt) <= now} timeZone={found.timeZone} zoneLabels={zoneLabels} />
                  {view === "list" && l.meetingLink && (
                    <a
                      href={l.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 text-small text-green-600 hover:text-green-700"
                    >
                      Ссылка на встречу
                    </a>
                  )}
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </main>
  );
}
