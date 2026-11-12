// Signs both seeded teachers in once per run and saves their sessions for the
// scenarios (sessions.ts). Runs after teacher-sign-in.spec.ts, which needs the
// sign-in attempts of its own (playwright.config.ts).
import { expect, request, test as setup } from "@playwright/test";
import teachers from "../../deploy/seed/teachers.json" with { type: "json" };
import { SECOND_TEACHER_SESSION, TEACHER_SESSION } from "./sessions";

async function signIn(baseURL: string, account: { email: string; password: string }, path: string) {
  const context = await request.newContext({ baseURL });
  // The sign-in scenario has just used up the attempt limit. The library says
  // when the next attempt is allowed; wait for it once instead of lifting the
  // limit for tests.
  for (let attempt = 1; ; attempt++) {
    const response = await context.post("/api/auth/sign-in/email", {
      data: { email: account.email, password: account.password },
      headers: { origin: baseURL },
    });
    if (response.status() === 429 && attempt === 1) {
      const seconds = Number(response.headers()["x-retry-after"] ?? "10");
      await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
      continue;
    }
    expect(response.status(), `sign-in of ${account.email}`).toBe(200);
    break;
  }
  await context.storageState({ path });
  await context.dispose();
}

setup("both teachers sign in once", async ({ baseURL }) => {
  setup.setTimeout(60_000);
  await signIn(baseURL!, teachers[0], TEACHER_SESSION);
  await signIn(baseURL!, teachers[1], SECOND_TEACHER_SESSION);
});
