import { StudentForm } from "@/components/student-form";
import { studentOrNotFound } from "../../student";

export const metadata = { title: "Изменить ученика — StudySoft" };

type Props = { params: Promise<{ id: string }> };

export default async function EditStudentPage({ params }: Props) {
  const student = await studentOrNotFound((await params).id);

  return (
    <main>
      <h1 className="mb-6 text-h1 font-bold">Изменить ученика</h1>
      <StudentForm
        mode="edit"
        studentId={student.id}
        initial={{
          firstName: student.firstName,
          lastName: student.lastName ?? "",
          level: student.level,
          timeZone: student.timeZone,
          status: student.status,
        }}
      />
    </main>
  );
}
