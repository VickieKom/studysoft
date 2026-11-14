import { describe, expect, it } from "vitest";
import { balanceLabel, balanceShown, computeBalance, formatMoney, lessonsLabel, type Terms, termsOn } from "./payments";

const rub = (priceMinor: number, validFrom: string, format: Terms["format"] = "prepaid"): Terms => ({
  format,
  priceMinor,
  currency: "RUB",
  validFrom,
});

describe("payments", () => {
  it("formats money the Russian way and counts lessons", () => {
    expect(formatMoney(600_000, "RUB")).toBe("6 000 ₽");
    expect(formatMoney(3_050, "USD")).toBe("30,5 $");
    expect([1, 2, 5, 11, 21, 22].map(lessonsLabel)).toEqual([
      "1 урок",
      "2 урока",
      "5 уроков",
      "11 уроков",
      "21 урок",
      "22 урока",
    ]);
  });

  it("finds the terms in force on a date", () => {
    const history = [rub(150_000, "2026-11-01"), rub(200_000, "2026-11-13")];
    expect(termsOn(history, "2026-10-31")).toBeNull();
    expect(termsOn(history, "2026-11-12")?.priceMinor).toBe(150_000);
    expect(termsOn(history, "2026-11-13")?.priceMinor).toBe(200_000);
  });

  it("charges each lesson at the price of its date and counts whole lessons at today's", () => {
    const history = [rub(150_000, "2026-11-01"), rub(200_000, "2026-11-13")];
    const balance = computeBalance(history, [{ amountMinor: 600_000 }], ["2026-11-12", "2026-11-13"], "2026-11-13")!;
    expect(balance).toMatchObject({ amountMinor: 250_000, lessons: 1, runningOut: true });
    expect(balanceLabel(balance)).toBe("Осталось 1 урок · 2 500 ₽");
  });

  it("shows a debt for postpaid lessons, and nothing for a free student", () => {
    const postpaid = [rub(150_000, "2026-11-01", "postpaid")];
    const debt = computeBalance(postpaid, [], ["2026-11-10", "2026-11-11"], "2026-11-13")!;
    expect(debt).toMatchObject({ amountMinor: -300_000, lessons: -2, runningOut: false });
    expect(balanceLabel(debt)).toBe("Долг 2 урока · 3 000 ₽");
    expect(computeBalance([rub(0, "2026-11-01", "free")], [], ["2026-11-10"], "2026-11-13")).toBeNull();
    expect(computeBalance([], [{ amountMinor: 100 }], [], "2026-11-13")).toBeNull();
  });

  it("charges nothing for a lesson held while the student was free", () => {
    const history = [rub(0, "2026-11-01", "free"), rub(100_000, "2026-11-12")];
    expect(computeBalance(history, [], ["2026-11-05"], "2026-11-13")?.amountMinor).toBe(0);
  });

  it("shows a balance for prepaid, only a debt for postpaid", () => {
    const prepaid = computeBalance([rub(100_000, "2026-11-01")], [{ amountMinor: 300_000 }], [], "2026-11-13");
    expect(balanceShown(prepaid, "prepaid")).toBe("Осталось 3 урока · 3\u00a0000\u00a0₽");
    const paid = computeBalance([rub(100_000, "2026-11-01", "postpaid")], [{ amountMinor: 100_000 }], ["2026-11-10"], "2026-11-13");
    expect(balanceShown(paid, "postpaid")).toBeNull();
    const owed = computeBalance([rub(100_000, "2026-11-01", "postpaid")], [], ["2026-11-10"], "2026-11-13");
    expect(balanceShown(owed, "postpaid")).toBe("Долг 1 урок · 1\u00a0000\u00a0₽");
    expect(balanceShown(null, "free")).toBeNull();
  });

  it("charges a lesson before the first terms at the earliest ones", () => {
    const history = [rub(150_000, "2026-11-13")];
    expect(computeBalance(history, [{ amountMinor: 600_000 }], ["2026-11-12"], "2026-11-13")?.amountMinor).toBe(450_000);
  });
});
