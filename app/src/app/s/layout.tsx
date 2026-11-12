import type { ReactNode } from "react";

// Screens behind a student link: a route tree of their own, phone first, with
// nothing of the teacher's workspace (architecture 8.7).
export default function StudentLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-md px-4 py-8">{children}</div>;
}
