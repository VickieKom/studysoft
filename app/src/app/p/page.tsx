import { headers } from "next/headers";
import { LinkExchange } from "@/components/link-exchange";
import { ProgressView } from "@/components/progress-view";
import { createServerCaller, isUnauthorized } from "@/server/router";

export const metadata = { title: "Успехи — StudySoft" };

/** The parent's page: view only, no actions (#20): the child's dashboard (#256); reports arrive later. */
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
      <div className="rounded-card border border-border bg-surface px-6 py-10 text-center">
        <p className="font-semibold text-text-secondary">Отчётов пока нет</p>
      </div>
    </main>
  );
}
