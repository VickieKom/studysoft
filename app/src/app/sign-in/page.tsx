import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createServerCaller, isUnauthorized } from "@/server/router";
import { SignInForm } from "./sign-in-form";

export const metadata = { title: "Вход — StudySoft" };

async function isSignedIn(): Promise<boolean> {
  try {
    await createServerCaller(await headers()).teacher.session.me();
    return true;
  } catch (error) {
    if (isUnauthorized(error)) return false;
    throw error;
  }
}

export default async function SignInPage() {
  if (await isSignedIn()) {
    redirect("/teacher/students");
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-bg p-8">
        <h1 className="mb-6 text-h1 font-bold">Вход</h1>
        <SignInForm />
      </div>
    </main>
  );
}
