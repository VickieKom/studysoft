import { headers } from "next/headers";
import { LinkExchange } from "@/components/link-exchange";
import { createServerCaller, isUnauthorized } from "@/server/router";

export const metadata = { title: "Успехи — StudySoft" };

/** The parent's page: view only, no actions (#20). Reports arrive in stage 2. */
export default async function ParentPage() {
  let firstName: string;
  try {
    ({ firstName } = await createServerCaller(await headers()).parent.me());
  } catch (error) {
    if (isUnauthorized(error)) return <LinkExchange />;
    throw error;
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">Успехи {firstName}</h1>
      <div className="rounded-card border border-border bg-surface px-6 py-10 text-center">
        <p className="font-semibold text-text-secondary">Отчётов пока нет</p>
      </div>
    </main>
  );
}
