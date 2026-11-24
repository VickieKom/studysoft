import Link from "next/link";
import { likedMost } from "@/domain/feedback-rating";
import { formatPastDate, HOMEWORK_STATUS_LABELS } from "@/domain/homework";
import { SKILL_LABELS, trendLabel } from "@/domain/progress";
import { dateIn, timeIn } from "@/domain/schedule";
import { STATUS_LABELS } from "@/domain/student";
import { teacherCaller } from "./caller";

export const metadata = { title: "Главная — StudySoft" };

const card = "rounded-card border border-border p-4";
const cell = "px-4 py-3 text-left align-top";

/** «Главная» (#257): the lessons ahead, what needs the teacher, and every student with their numbers. */
export default async function TeacherHome() {
  const { caller } = await teacherCaller();
  const { timeZone, lessons, students } = await caller.teacher.home.get();
  const attention = students.filter((s) => s.slips.length > 0 || s.homeworkNotSubmitted || s.runningOut);
  const feedback = await caller.teacher.home.feedback();
  const liked = likedMost(feedback.across.materials, feedback.across.tasks);

  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-h1 font-bold">Главная</h1>

      <section aria-labelledby="upcoming" className="flex flex-col gap-3">
        <h2 id="upcoming" className="text-h2 font-semibold">
          Ближайшие уроки
        </h2>
        {lessons.length === 0 ? (
          <p className="text-text-secondary">В ближайшие две недели уроков нет</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {lessons.map((l) => {
              const moment = new Date(l.startsAt);
              const mine = timeIn(moment, timeZone);
              const theirs = timeIn(moment, l.studentTimeZone);
              return (
                <li key={l.id} className={`${card} flex flex-wrap items-center gap-3`}>
                  <Link href={`/teacher/prep/${l.id}`} className="font-semibold text-green-700 hover:text-green-800">
                    {l.firstName}
                  </Link>
                  <span>
                    {formatPastDate(dateIn(moment, timeZone))}, {mine}
                    {theirs !== mine && <span className="text-text-secondary"> (у ученика {theirs})</span>}
                  </span>
                  {l.book && <span className="text-small text-text-secondary">{l.book}</span>}
                  <span className="text-small text-text-secondary">
                    Домашка: {l.homework ? HOMEWORK_STATUS_LABELS[l.homework].toLowerCase() : "нет"}
                  </span>
                  <span className={`text-small ${l.prepared ? "text-green-700" : "text-text-secondary"}`}>
                    {l.prepared ? "подготовлен" : "не подготовлен"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(feedback.newFeedback.length > 0 || liked) && (
        <section aria-labelledby="new-feedback" className="flex flex-col gap-3">
          <h2 id="new-feedback" className="text-h2 font-semibold">
            Новый фидбэк
          </h2>
          {feedback.newFeedback.length === 0 ? (
            <p className="text-text-secondary">Все ответы детей просмотрены</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {feedback.newFeedback.map((s) => (
                <li key={s.id} className={card}>
                  <Link href={`/teacher/students/${s.id}`} className="font-semibold text-green-700 hover:text-green-800">
                    {s.firstName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {liked && <p className="text-small text-text-secondary">Детям больше всего нравится: {liked}</p>}
        </section>
      )}

      <section aria-labelledby="attention" className="flex flex-col gap-3">
        <h2 id="attention" className="text-h2 font-semibold">
          Требует внимания
        </h2>
        {attention.length === 0 ? (
          <p className="text-text-secondary">Всё спокойно</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attention.map((s) => {
              const reasons = [
                ...s.slips.map((slip) => `${SKILL_LABELS[slip.skill]}: ${trendLabel(slip.trend)}`),
                ...(s.homeworkNotSubmitted ? ["домашка не сдана"] : []),
                ...(s.runningOut ? [`оплаченные уроки заканчиваются (${s.runningOut})`] : []),
              ];
              return (
                <li key={s.id} className={`${card} flex flex-wrap items-center gap-3`}>
                  <Link href={`/teacher/students/${s.id}`} className="font-semibold text-green-700 hover:text-green-800">
                    {s.firstName}
                  </Link>
                  <span>{reasons.join("; ")}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {students.length === 0 ? (
          <>
            <h2 className="text-h2 font-semibold">Ученики</h2>
            <p className="text-text-secondary">Пока нет учеников</p>
          </>
        ) : (
          <table className="w-full border-collapse">
            <caption className="mb-3 text-left text-h2 font-semibold">Ученики</caption>
            <thead className="border-b border-border text-small text-text-secondary">
              <tr>
                <th scope="col" className={cell}>
                  Ученик
                </th>
                <th scope="col" className={cell}>
                  Учебник
                </th>
                <th scope="col" className={cell}>
                  Домашки сданы
                </th>
                <th scope="col" className={cell}>
                  Навыки
                </th>
                <th scope="col" className={cell}>
                  Статус
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {students.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className={`${cell} font-semibold`}>
                    <Link href={`/teacher/students/${s.id}`} className="text-green-700 hover:text-green-800">
                      {s.firstName}
                    </Link>
                  </th>
                  <td className={cell}>
                    {s.textbook ? `${s.textbook.title}, юнитов ${s.textbook.unitsPassed} из ${s.textbook.units}` : "—"}
                  </td>
                  <td className={cell}>
                    {s.homework.due > 0 ? `${Math.round((s.homework.submitted / s.homework.due) * 100)}%` : "—"}
                  </td>
                  <td className={cell}>
                    {s.trends.length === 0
                      ? "—"
                      : s.trends.map((t) => (
                          <p key={t.skill}>
                            {SKILL_LABELS[t.skill]} {trendLabel(t.trend)}
                          </p>
                        ))}
                  </td>
                  <td className={cell}>{STATUS_LABELS[s.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
