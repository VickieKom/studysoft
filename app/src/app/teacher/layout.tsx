import type { ReactNode } from "react";
import { teacherCaller } from "./caller";

// The whole workspace requires a teacher session; without one, sign in first.
export default async function TeacherLayout({ children }: { children: ReactNode }) {
  await teacherCaller();
  return <div className="mx-auto min-h-screen max-w-5xl px-8 py-10">{children}</div>;
}
