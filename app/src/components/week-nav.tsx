import { addDays } from "@/domain/schedule";

const button = "h-10 rounded-control border border-border bg-bg px-3 font-semibold";

/**
 * «‹ ›» between weeks (#80): a plain GET form, so the other week is a full
 * load of the server's page and works without scripts.
 */
export function WeekNav({ monday }: { monday: string }) {
  return (
    <form method="get" action="/teacher/schedule" className="flex gap-2">
      <button type="submit" name="week" value={addDays(monday, -7)} aria-label="Предыдущая неделя" className={button}>
        ‹
      </button>
      <button type="submit" name="week" value={addDays(monday, 7)} aria-label="Следующая неделя" className={button}>
        ›
      </button>
    </form>
  );
}
