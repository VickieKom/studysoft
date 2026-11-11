import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createServerCaller, isUnauthorized } from "@/server/router";

/**
 * The router caller for the teacher's workspace. Without a session it sends
 * the visitor to sign-in. The layout and every page call it: Next renders them
 * in parallel, so a check in the layout alone does not stop the page.
 */
export const teacherCaller = cache(async () => {
  const caller = createServerCaller(await headers());
  try {
    const teacher = await caller.teacher.session.me();
    return { caller, teacher };
  } catch (error) {
    if (isUnauthorized(error)) redirect("/sign-in");
    throw error;
  }
});
