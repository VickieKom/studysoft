import { headers } from "next/headers";
import { LinkExchange } from "@/components/link-exchange";
import { ProgressView } from "@/components/progress-view";
import { numberLines, periodLabel } from "@/domain/report";
import { createServerCaller, isUnauthorized } from "@/server/router";

export const metadata = { title: "Успехи — StudySoft" };

/** The parent's page: view only, no actions (#20): the child's dashboard (#256) and the published reports, newest first (#268). */
export default async function ParentPage() {
  let firstName: string;
  const caller = createServerCaller(await headers());
  try {
    ({ firstName } = await caller.parent.me());
  } catch (error) {
    if (isUnauthorized(error)) return <LinkExchange />;
    throw error;
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">Успехи {firstName}</h1>
      <section aria-labelledby="progress-heading" className="flex flex-col gap-4 rounded-card border border-border p-6">
        <h2 id="progress-heading" className="text-h3 font-semibold">
          Прогресс
        </h2>
        <ProgressView view={await caller.parent.progress()} />
      </section>
      <ParentReports reports={await caller.parent.reports()} />
    </main>
  );
}

type Published = Awaited<ReturnType<ReturnType<typeof createServerCaller>["parent"]["reports"]>>;

function ParentReports({ reports }: { reports: Published }) {
  return (
    <section aria-labelledby="reports-heading" className="flex flex-col gap-4">
      <h2 id="reports-heading" className="text-h3 font-semibold">
        Отчёты
      </h2>
      {reports.length === 0 ? (
        <div className="rounded-card border border-border bg-surface px-6 py-10 text-center">
          <p className="font-semibold text-text-secondary">Отчётов пока нет</p>
        </div>
      ) : (
        reports.map((r) => {
          const lines = numberLines(r.numbers);
          return (
            <article key={r.id} aria-label={`Отчёт за ${periodLabel(r.periodFrom, r.periodTo)}`} className="flex flex-col gap-3 rounded-card border border-border p-6">
              <h3 className="font-semibold">Отчёт за {periodLabel(r.periodFrom, r.periodTo)}</h3>
              {lines.length > 0 && (
                <div className="flex flex-col gap-1 text-small">
                  {lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              )}
              {r.blocks.map((b, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <h4 className="font-semibold">{b.title}</h4>
                  <p className="whitespace-pre-line">{b.text.trim()}</p>
                </div>
              ))}
            </article>
          );
        })
      )}
    </section>
  );
}
