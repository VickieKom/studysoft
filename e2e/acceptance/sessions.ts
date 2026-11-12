// Where the setup project keeps the teachers' signed-in sessions. Scenarios
// that start inside the workspace reuse them instead of signing in again: the
// sign-in endpoint allows three attempts per ten seconds from one client, and
// teacher-sign-in.spec.ts already spends all three.
//
// The files live under test-results/, which git ignores and Playwright clears
// at the start of every run.
export const TEACHER_SESSION = "test-results/.auth/teacher.json";
export const SECOND_TEACHER_SESSION = "test-results/.auth/second-teacher.json";
