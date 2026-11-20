import { monthLabel, type ProgressView as View, SKILL_LABELS, skillsByMonth, trendLabel } from "@/domain/progress";

/**
 * The dashboard (#255): the homework submitted, the textbook covered, the
 * words, and each assessed skill by month with growth or slip. The same on
 * the teacher's card and the parent's page (#256); it changes nothing.
 */
export function ProgressView({ view }: { view: View }) {
  const { homework, textbook, words, results } = view;
  const { months, rows } = skillsByMonth(results);
  return (
    <>
      <div className="flex flex-col gap-1 text-small">
          <p>
            {homework.due > 0
              ? `Домашки: сдано ${homework.submitted} из ${homework.due} (${Math.round((homework.submitted / homework.due) * 100)}%)`
              : "Домашек со сроком ещё не было"}
          </p>
          <p>{textbook ? `Учебник «${textbook.title}»: пройдено юнитов ${textbook.unitsPassed} из ${textbook.units}` : "Учебник не выбран"}</p>
          <p>{`Слов: ${words.total}, закрепилось ${words.learnt}`}</p>
        </div>
      {rows.length === 0 ? (
          <p className="text-small text-text-secondary">Результатов по навыкам пока нет</p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="Навыки по месяцам" className="w-full text-small">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">Навык</th>
                  {months.map((m) => (
                    <th key={m} className="px-2 py-1 text-right font-semibold">
                      {monthLabel(m)}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right font-semibold">Изменение</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.skill} className="border-t border-border">
                    <th scope="row" className="px-2 py-1 text-left font-normal">
                      {SKILL_LABELS[row.skill]}
                    </th>
                    {months.map((m) => (
                      <td key={m} className="px-2 py-1 text-right">
                        {m in row.byMonth ? `${row.byMonth[m]}%` : "—"}
                      </td>
                    ))}
                    <td className={`px-2 py-1 text-right ${row.trend === null ? "" : row.trend > 0 ? "text-green-700" : row.trend < 0 ? "text-danger" : ""}`}>
                      {row.trend === null ? "—" : trendLabel(row.trend)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </>
  );
}
