import type { ReactNode } from "react";

// Screens behind a parent link: a route tree of their own, read only, with
// nothing of the teacher's workspace or the student's page (architecture 8.7).
export default function ParentLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-md px-4 py-8">{children}</div>;
}
