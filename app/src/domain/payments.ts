// Prices, payments and the balance (#83). Plain data and pure functions:
// the balance is computed from payments and charged lessons, never stored
// (architecture: derived values are not stored).

export const PAYMENT_FORMATS = [
  { id: "prepaid", label: "Предоплата" },
  { id: "postpaid", label: "Постоплата" },
  { id: "free", label: "Бесплатно" },
] as const;
export type PaymentFormat = (typeof PAYMENT_FORMATS)[number]["id"];
export const PAYMENT_FORMAT_IDS = PAYMENT_FORMATS.map((f) => f.id) as [PaymentFormat, ...PaymentFormat[]];

/** One currency per student, for the price and every payment: ₽, $, € or ฿ (product owner, 2026-11-13). */
export const CURRENCIES = [
  { id: "RUB", symbol: "₽" },
  { id: "USD", symbol: "$" },
  { id: "EUR", symbol: "€" },
  { id: "THB", symbol: "฿" },
] as const;
export type Currency = (typeof CURRENCIES)[number]["id"];
export const CURRENCY_IDS = CURRENCIES.map((c) => c.id) as [Currency, ...Currency[]];

const symbolOf = (currency: string) => CURRENCIES.find((c) => c.id === currency)?.symbol ?? currency;

/** Money is kept in minor units (kopecks, cents, satang): «6 000 ₽», «30,50 $». */
export function formatMoney(minor: number, currency: string): string {
  const major = minor / 100;
  const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(major);
  return `${number} ${symbolOf(currency)}`;
}

/** «1 урок», «3 урока», «5 уроков». */
export function lessonsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word =
    mod10 === 1 && mod100 !== 11 ? "урок" : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "урока" : "уроков";
  return `${count} ${word}`;
}

/** A row of the price history: terms in force from a date (the student's). */
export type Terms = { format: PaymentFormat; priceMinor: number; currency: Currency; validFrom: string };

/** The terms in force on a date: the latest that started on or before it. */
export function termsOn(history: readonly Terms[], date: string): Terms | null {
  let found: Terms | null = null;
  for (const terms of history) if (terms.validFrom <= date && (!found || terms.validFrom >= found.validFrom)) found = terms;
  return found;
}

const earliest = (history: readonly Terms[]) =>
  history.reduce<Terms | null>((first, t) => (!first || t.validFrom < first.validFrom ? t : first), null);

export type Balance = {
  /** Payments minus charges, in minor units; negative is a debt. */
  amountMinor: number;
  /** Whole lessons at the current price: left when ≥ 0, owed when negative. */
  lessons: number;
  currency: Currency;
  /** Prepaid with one lesson or less left. */
  runningOut: boolean;
};

/**
 * The balance from payments and charged lessons (by the student's date of
 * each lesson, at the price in force then). Null for a student without terms
 * or on «Бесплатно» now: there is no balance to show.
 */
export function computeBalance(
  history: readonly Terms[],
  payments: readonly { amountMinor: number }[],
  chargedLessonDates: readonly string[],
  today: string,
): Balance | null {
  const now = termsOn(history, today);
  if (!now || now.format === "free") return null;
  const paid = payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const charged = chargedLessonDates.reduce((sum, date) => {
    // A lesson before the first terms is charged at the earliest ones: terms
    // set for the first time cover the lessons already held.
    const terms = termsOn(history, date) ?? earliest(history) ?? now;
    return sum + (terms.format === "free" ? 0 : terms.priceMinor);
  }, 0);
  const amountMinor = paid - charged;
  const lessons =
    now.priceMinor > 0
      ? amountMinor >= 0
        ? Math.floor(amountMinor / now.priceMinor)
        : -Math.ceil(-amountMinor / now.priceMinor)
      : 0;
  return { amountMinor, lessons, currency: now.currency, runningOut: now.format === "prepaid" && lessons <= 1 };
}

/** «Осталось 3 урока · 4 500 ₽» or «Долг 1 урок · 1 500 ₽». */
export function balanceLabel(balance: Balance): string {
  return balance.amountMinor >= 0
    ? `Осталось ${lessonsLabel(balance.lessons)} · ${formatMoney(balance.amountMinor, balance.currency)}`
    : `Долг ${lessonsLabel(-balance.lessons)} · ${formatMoney(-balance.amountMinor, balance.currency)}`;
}

/**
 * What the card says about money: the balance for a prepaid student, only a
 * debt for a postpaid one, nothing for a free one (product owner,
 * 2026-11-13). Null when there is nothing to say.
 */
export function balanceShown(balance: Balance | null, format: PaymentFormat | null): string | null {
  if (!balance || format === "free" || format === null) return null;
  if (format === "postpaid" && balance.amountMinor >= 0) return null;
  return balanceLabel(balance);
}
