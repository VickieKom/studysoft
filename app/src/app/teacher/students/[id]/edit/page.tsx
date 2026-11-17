import { StudentForm, type StudentFormValues } from "@/components/student-form";
import { CONTACT_FIELDS, PROFILE_FIELDS } from "@/domain/student";
import { teacherCaller } from "../../../caller";
import { studentOrNotFound } from "../../student";

export const metadata = { title: "Изменить ученика — StudySoft" };

type Props = { params: Promise<{ id: string }> };

export default async function EditStudentPage({ params }: Props) {
  const student = await studentOrNotFound((await params).id);
  // Whether a changed time zone needs the hint about the regular lessons (#100).
  const { caller } = await teacherCaller();
  const hasSlots = (await caller.teacher.schedule.slots({ studentId: student.id })).length > 0;

  return (
    <main>
      <h1 className="mb-6 text-h1 font-bold">Изменить ученика</h1>
      <StudentForm
        mode="edit"
        studentId={student.id}
        hasSlots={hasSlots}
        initial={{
          firstName: student.firstName,
          lastName: student.lastName ?? "",
          level: student.level,
          timeZone: student.timeZone,
          status: student.status,
          ...Object.fromEntries(PROFILE_FIELDS.map((field) => [field.key, student[field.key] ?? ""])),
          ...Object.fromEntries(CONTACT_FIELDS.map((field) => [field.key, student.contacts[field.key] ?? ""])),
        } as StudentFormValues}
      />
    </main>
  );
}
