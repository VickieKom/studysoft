// Time for the schedule (#80; architecture 8.6). A slot keeps a local time in
// the student's time zone; a lesson keeps a moment in UTC. These helpers turn
// one into the other and back. Plain functions, no server code.

export const DURATIONS = [45, 60, 90] as const;
export type Duration = (typeof DURATIONS)[number];
export const DEFAULT_DURATION: Duration = 60;

/** Monday first, as the week is shown; values are JavaScript's getUTCDay(). */
export const WEEKDAYS = [
  { day: 1, label: "Понедельник" },
  { day: 2, label: "Вторник" },
  { day: 3, label: "Среда" },
  { day: 4, label: "Четверг" },
  { day: 5, label: "Пятница" },
  { day: 6, label: "Суббота" },
  { day: 0, label: "Воскресенье" },
] as const;

export const weekdayLabel = (day: number) => WEEKDAYS.find((w) => w.day === day)?.label ?? "";

/** How far ahead lessons are created from slots: 4 weeks (product requirements). */
export const LESSONS_AHEAD_DAYS = 28;

/** The wall-clock parts of a moment in a time zone. */
function partsIn(moment: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(moment);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** The calendar date of a moment in a time zone, as YYYY-MM-DD. */
export function dateIn(moment: Date, timeZone: string): string {
  const p = partsIn(moment, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** The wall-clock time of a moment in a time zone, as HH:MM. */
export function timeIn(moment: Date, timeZone: string): string {
  const p = partsIn(moment, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * The moment of a local date and time in a time zone. Around a clock change
 * a time that does not exist moves forward by the gap; a time that exists
 * twice takes the first.
 */
export function zonedMoment(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (moment: number) => {
    const p = partsIn(new Date(moment), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - moment;
  };
  // The offsets a day before and after cover any clock change that night.
  const DAY = 86_400_000;
  const before = wanted - offsetAt(wanted - DAY);
  const after = wanted - offsetAt(wanted + DAY);
  const shows = (moment: number) => moment + offsetAt(moment) === wanted;
  const valid = [before, after].filter(shows);
  // Repeated: the earlier one. Missing: the old offset, which lands past the gap.
  return new Date(valid.length > 0 ? Math.min(...valid) : before);
}

/** A date plus some days, as YYYY-MM-DD. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The weekday of a date (0 Sunday … 6 Saturday). */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The Monday of the week a date is in. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/**
 * The dates on which a weekly slot falls, from `from` for `days` days. The
 * dates are the student's (the slot's time zone).
 */
export function slotDates(weekday: number, from: string, days: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    if (weekdayOf(date) === weekday) dates.push(date);
  }
  return dates;
}

/** «вторник, 17 ноября»: how the week names a day. */
export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
