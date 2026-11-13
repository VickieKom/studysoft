import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_SESSION_COOKIES, type LinkRole } from "../../access/links";
import { saveContacts } from "../../crm/students";
import { closeDb, db } from "../../db/client";
import { contact, teacher as teacherTable } from "../../db/schema";
import { env } from "../../env";
import { seedTeachers, signedInHeaders } from "../../testing/requests";
import { createServerCaller, handleRouterRequest } from "../index";

// Contacts (#84): the teacher's only.

const [teacherA, teacherB] = seedTeachers as [(typeof seedTeachers)[number], (typeof seedTeachers)[number]];

const CONTACTS = {
  parentName: "Мама Синтетическая",
  parentEmail: "parent-synthetic@example.test",
  parentMessenger: "@parent_synthetic",
  studentEmail: "student-synthetic@example.test",
  studentMessenger: "@student_synthetic",
};

let teacher: ReturnType<typeof createServerCaller>;
let otherTeacher: ReturnType<typeof createServerCaller>;
let studentId: string;
const base = { firstName: "Контакты", lastName: "", level: "A2" as const, timeZone: "Europe/Moscow" as const };

function routerRequest(path: string, init: RequestInit = {}) {
  return handleRouterRequest(new Request(`${env().APP_URL}/api/trpc/${path}`, init));
}

async function sessionCookie(role: LinkRole): Promise<string> {
  const url = (await teacher.teacher.links[role]({ studentId })).url;
  const response = await routerRequest("links.exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: url.split("#")[1] }),
  });
  return response.headers.getSetCookie().find((c) => c.startsWith(`${LINK_SESSION_COOKIES[role]}=`))!.split(";")[0]!;
}

beforeAll(async () => {
  teacher = createServerCaller(await signedInHeaders(teacherA));
  otherTeacher = createServerCaller(await signedInHeaders(teacherB));
  ({ id: studentId } = await teacher.teacher.students.create(base));
});

afterAll(closeDb);

describe("contacts", () => {
  it("start empty and are saved from the edit form, blank as none", async () => {
    expect((await teacher.teacher.students.get({ id: studentId })).contacts).toEqual({
      parentName: null,
      parentEmail: null,
      parentMessenger: null,
      studentEmail: null,
      studentMessenger: null,
    });
    await teacher.teacher.students.update({ ...base, id: studentId, status: "active", ...CONTACTS });
    expect((await teacher.teacher.students.get({ id: studentId })).contacts).toEqual(CONTACTS);

    await teacher.teacher.students.update({ ...base, id: studentId, status: "active", ...CONTACTS, parentEmail: "  " });
    expect((await teacher.teacher.students.get({ id: studentId })).contacts.parentEmail).toBeNull();
    // Left out of an update, they stay.
    await teacher.teacher.students.update({ ...base, id: studentId, status: "active", parentEmail: CONTACTS.parentEmail });
    expect((await teacher.teacher.students.get({ id: studentId })).contacts).toEqual(CONTACTS);
  });

  it("stay out of the student list, and another teacher cannot read or write them", async () => {
    const list = JSON.stringify(await teacher.teacher.students.list());
    for (const value of Object.values(CONTACTS)) expect(list).not.toContain(value);
    await expect(otherTeacher.teacher.students.get({ id: studentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      otherTeacher.teacher.students.update({ ...base, id: studentId, status: "active", parentName: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await teacher.teacher.students.get({ id: studentId })).contacts.parentName).toBe(CONTACTS.parentName);
  });

  it("never reach the student, the parent or the assistant", async () => {
    const studentCookie = await sessionCookie("student");
    const parentCookie = await sessionCookie("parent");
    const { token } = await teacher.teacher.assistant.createToken();
    const responses = [
      await (await routerRequest("student.me", { headers: { cookie: studentCookie } })).text(),
      await (await routerRequest("student.homework.current", { headers: { cookie: studentCookie } })).text(),
      await (await routerRequest("parent.me", { headers: { cookie: parentCookie } })).text(),
      await (await routerRequest("agent.listStudents", { headers: { authorization: `Bearer ${token}` } })).text(),
      await (
        await routerRequest(`agent.studentContext?input=${encodeURIComponent(JSON.stringify({ studentId }))}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).text(),
    ];
    for (const body of responses) {
      expect(body).toContain('"result"');
      for (const value of Object.values(CONTACTS)) expect(body).not.toContain(value);
    }
  });

  it("are not overwritten by saveContacts called with another teacher's id", async () => {
    // The procedure refuses earlier; this checks the function on its own.
    const [rowB] = await db().select({ id: teacherTable.id }).from(teacherTable).where(eq(teacherTable.email, teacherB.email));
    // The composite key refuses a row for B; an update of A's row must be refused too, quietly or not.
    await saveContacts(db(), rowB!.id, studentId, { parentName: "Чужое имя" }).catch(() => undefined);
    expect((await teacher.teacher.students.get({ id: studentId })).contacts).toEqual(CONTACTS);
    expect(await db().select().from(contact).where(eq(contact.teacherId, rowB!.id))).toEqual([]);
  });
});
