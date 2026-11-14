import { describe, expect, it } from "vitest";
import { addDays, dateIn, dayLabel, mondayOf, slotDates, timeIn, zonedMoment } from "./schedule";

describe("schedule time", () => {
  it("turns a student's local time into a moment and shows it in both zones", () => {
    const moment = zonedMoment("2026-11-17", "17:00", "Europe/Moscow");
    expect(moment.toISOString()).toBe("2026-11-17T14:00:00.000Z");
    expect(timeIn(moment, "Asia/Bangkok")).toBe("21:00");
    expect(dateIn(moment, "Asia/Bangkok")).toBe("2026-11-17");
  });

  it("keeps the student's wall-clock time across a clock change", () => {
    // Berlin moves from summer to winter time on 25 October 2026.
    expect(zonedMoment("2026-10-20", "17:00", "Europe/Berlin").toISOString()).toBe("2026-10-20T15:00:00.000Z");
    expect(zonedMoment("2026-10-27", "17:00", "Europe/Berlin").toISOString()).toBe("2026-10-27T16:00:00.000Z");
    // A time that does not exist on the spring-forward night moves on by the gap.
    expect(timeIn(zonedMoment("2027-03-28", "02:30", "Europe/Berlin"), "Europe/Berlin")).toBe("03:30");
    // A time that happens twice on the fall-back night takes the first, still summer time.
    expect(zonedMoment("2026-10-25", "02:30", "Europe/Berlin").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("finds a weekly slot's dates in a window, and the week's Monday", () => {
    // 12 November 2026 is a Thursday.
    expect(slotDates(2, "2026-11-12", 28)).toEqual(["2026-11-17", "2026-11-24", "2026-12-01", "2026-12-08"]);
    expect(mondayOf("2026-11-12")).toBe("2026-11-09");
    expect(mondayOf("2026-11-15")).toBe("2026-11-09");
    expect(mondayOf("2026-11-16")).toBe("2026-11-16");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("names a day as the week shows it", () => {
    expect(dayLabel("2026-11-17")).toBe("вторник, 17 ноября");
  });
});
