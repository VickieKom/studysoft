"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";
import { CURRENCIES, type Currency, formatMoney, PAYMENT_FORMATS, type PaymentFormat } from "@/domain/payments";
import { Button } from "./button";
import { routerClient } from "./router-client";

type Props = {
  studentId: string;
  today: string;
  terms: { format: PaymentFormat; priceMinor: number; currency: Currency; validFrom: string } | null;
  payments: { id: string; paidOn: string; amountMinor: number; comment: string | null }[];
  balance: string | null;
  runningOut: boolean;
};

const field = "h-10 rounded-control border border-border bg-bg px-3";

function Labelled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

const major = (minor: number) => String(minor / 100).replace(".", ",");
const dayMonth = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * «Оплаты» on the card (#83): the payment format, the price and its currency
 * from a date, payments, and the balance — for a prepaid student; a postpaid
 * one shows only a debt, a free one neither. Teacher only.
 */
export function StudentPayments({ studentId, today, terms, payments, balance, runningOut }: Props) {
  const router = useRouter();
  const [format, setFormat] = useState<PaymentFormat>(terms?.format ?? "prepaid");
  const [price, setPrice] = useState(terms && terms.format !== "free" ? major(terms.priceMinor) : "");
  const [currency, setCurrency] = useState<Currency>(terms?.currency ?? "RUB");
  const [validFrom, setValidFrom] = useState(today);
  const [termsState, setTermsState] = useState<"idle" | "saved" | string>("idle");

  const [adding, setAdding] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const message = (cause: unknown, fallback: string) =>
    (cause as { data?: { code?: string } } | null)?.data?.code === "BAD_REQUEST" && cause instanceof Error
      ? cause.message.startsWith("[")
        ? "Проверьте сумму: только цифры, до двух знаков после запятой"
        : cause.message
      : fallback;

  async function onTerms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await routerClient.teacher.payments.saveTerms.mutate({
        studentId,
        format,
        ...(format === "free" || price.trim() === "" ? {} : { price }),
        currency,
        validFrom,
      });
      setTermsState("saved");
      router.refresh();
    } catch (cause) {
      setTermsState(message(cause, "Не получилось сохранить условия"));
    }
  }

  async function onPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPaymentError(null);
    try {
      await routerClient.teacher.payments.addPayment.mutate({ studentId, amount, paidOn, comment });
      setAdding(false);
      setAmount("");
      setComment("");
      router.refresh();
    } catch (cause) {
      setPaymentError(message(cause, "Не получилось сохранить оплату"));
    }
  }

  const free = terms?.format === "free";

  return (
    <section aria-label="Оплаты" className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
      <h2 className="text-small font-semibold text-text-secondary">Оплаты</h2>
      {balance && <p className="text-h3 font-semibold">{balance}</p>}
      {runningOut && (
        <p role="status" className="rounded-control bg-danger-bg px-3 py-2 text-small text-danger">
          Оплаченные уроки заканчиваются
        </p>
      )}

      <form onSubmit={onTerms} className="flex flex-wrap items-end gap-3">
        <Labelled id="terms-format" label="Формат оплаты">
          <select
            id="terms-format"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as PaymentFormat);
              setTermsState("idle");
            }}
            className={field}
          >
            {PAYMENT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Labelled>
        {format !== "free" && (
          <>
            <Labelled id="terms-price" label="Цена урока">
              <input
                id="terms-price"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`${field} w-28`}
              />
            </Labelled>
            <Labelled id="terms-currency" label="Валюта">
              <select
                id="terms-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className={field}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.symbol}
                  </option>
                ))}
              </select>
            </Labelled>
          </>
        )}
        <Labelled id="terms-from" label="С даты">
          <input id="terms-from" type="date" required value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={field} />
        </Labelled>
        <Button type="submit">Сохранить условия</Button>
        <span role="status" className="text-small text-text-secondary">
          {termsState === "saved" ? "Условия сохранены" : termsState !== "idle" ? termsState : ""}
        </span>
      </form>

      {!free &&
        (adding ? (
          <form onSubmit={onPayment} className="flex flex-wrap items-end gap-3">
            <Labelled id="payment-date" label="Дата">
              <input id="payment-date" type="date" required value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={field} />
            </Labelled>
            <Labelled id="payment-amount" label="Сумма">
              <input
                id="payment-amount"
                inputMode="decimal"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={`${field} w-28`}
              />
            </Labelled>
            <Labelled id="payment-comment" label="Комментарий">
              <input id="payment-comment" value={comment} onChange={(e) => setComment(e.target.value)} className={field} />
            </Labelled>
            <Button type="submit">Сохранить оплату</Button>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Отмена
            </Button>
            {paymentError && (
              <p role="alert" className="w-full text-small text-danger">
                {paymentError}
              </p>
            )}
          </form>
        ) : (
          <Button variant="secondary" className="self-start" onClick={() => setAdding(true)}>
            Добавить оплату
          </Button>
        ))}

      {!free && payments.length > 0 && terms && (
        <ul className="flex flex-col gap-1 text-small">
          {payments.map((p) => (
            <li key={p.id}>
              {dayMonth(p.paidOn)} · {formatMoney(p.amountMinor, terms.currency)}
              {p.comment && ` · ${p.comment}`}
            </li>
          ))}
        </ul>
      )}
      {terms && !free && (
        <p className="text-small text-text-muted">
          Сейчас: {PAYMENT_FORMATS.find((f) => f.id === terms.format)?.label}, {formatMoney(terms.priceMinor, terms.currency)}{" "}
          за урок с {dayMonth(terms.validFrom)}
        </p>
      )}
    </section>
  );
}
