import { notFound } from "next/navigation";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../caller";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The student behind a card address. A malformed address, a missing student
 * and another teacher's student all end in the same not-found page.
 */
export async function studentOrNotFound(id: string) {
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  try {
    return await caller.teacher.students.get({ id });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
}
