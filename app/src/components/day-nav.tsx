import { addDays } from "@/domain/schedule";

const button = "h-10 rounded-control border border-border bg-bg px-3 font-semibold";

/** «‹ ›» between days (#85): a plain GET form, like the week's. */
export function DayNav({ day }: { day: string }) {
  return (
    <form method="get" action="/teacher/schedule" className="flex gap-2">
      <input type="hidden" name="view" value="day" />
      <button type="submit" name="day" value={addDays(day, -1)} aria-label="Предыдущий день" className={button}>
        ‹
      </button>
      <button type="submit" name="day" value={addDays(day, 1)} aria-label="Следующий день" className={button}>
        ›
      </button>
    </form>
  );
}
