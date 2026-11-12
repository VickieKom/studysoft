import { StudentForm } from "@/components/student-form";

export const metadata = { title: "Новый ученик — StudySoft" };

export default function NewStudentPage() {
  return (
    <main>
      <h1 className="mb-6 text-h1 font-bold">Новый ученик</h1>
      <StudentForm mode="create" />
    </main>
  );
}
