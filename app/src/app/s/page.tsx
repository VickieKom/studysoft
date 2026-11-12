import { headers } from "next/headers";
import { createServerCaller, isUnauthorized } from "@/server/router";
import { LinkExchange } from "@/components/link-exchange";

export const metadata = { title: "Домашка — StudySoft" };

export default async function StudentPage() {
  let firstName: string;
  try {
    ({ firstName } = await createServerCaller(await headers()).student.me());
  } catch (error) {
    if (isUnauthorized(error)) return <LinkExchange />;
    throw error;
  }

  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-task-title font-bold">Привет, {firstName}!</h1>
      <div className="rounded-task border border-border bg-accent-50 px-6 py-10 text-center">
        <p className="text-answer font-semibold text-accent-900">Домашних заданий пока нет</p>
      </div>
    </main>
  );
}
