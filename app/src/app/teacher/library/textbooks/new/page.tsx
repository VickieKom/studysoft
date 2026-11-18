import Link from "next/link";
import { TextbookUploadForm } from "@/components/textbook-upload-form";
import { teacherCaller } from "../../../caller";

export const metadata = { title: "Загрузить учебник — StudySoft" };

/** «Загрузить учебник» (#156). */
export default async function NewTextbookPage() {
  // Only to require the teacher's session: the layout alone does not protect a page.
  await teacherCaller();
  return (
    <main className="flex flex-col gap-6">
      <p>
        <Link href="/teacher/library/textbooks" className="text-small text-green-600 hover:text-green-700">
          ← Учебники
        </Link>
      </p>
      <h1 className="text-h1 font-bold">Загрузить учебник</h1>
      <TextbookUploadForm />
    </main>
  );
}
