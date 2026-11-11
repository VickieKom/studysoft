// Helpers for integration tests that go through the real HTTP entry points.
import students from "../../../../deploy/seed/students.json";
import teachers from "../../../../deploy/seed/teachers.json";
import { env } from "../env";
import { handleAuthRequest } from "../router";

export const seedTeachers = teachers;
export const seedStudents = students;

export function authRequest(path: string, body: unknown): Promise<Response> {
  const { APP_URL } = env();
  return handleAuthRequest(
    new Request(`${APP_URL}/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: APP_URL },
      body: JSON.stringify(body),
    }),
  );
}

/** Signs a seeded teacher in and returns request headers carrying the session. */
export async function signedInHeaders(teacher: { email: string; password: string }): Promise<Headers> {
  const response = await authRequest("/sign-in/email", { email: teacher.email, password: teacher.password });
  if (!response.ok) {
    throw new Error(`sign-in failed with ${response.status}`);
  }
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}
