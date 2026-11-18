import Link from "next/link";
import { LibraryMaterialForm } from "@/components/library-material-form";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Загрузить в библиотеку — StudySoft" };

/** «Загрузить» (#115, #116): a game or a warm-up; videos come next. */
export default async function NewMaterialPage() {
  // Only to require the teacher's session: the layout alone does not protect a page.
  await teacherCaller();
  return (
    <main className="flex flex-col gap-6">
      <p>
        <Link href="/teacher/library" className="text-small text-green-600 hover:text-green-700">
          ← Библиотека
        </Link>
      </p>
      <h1 className="text-h1 font-bold">Загрузить в библиотеку</h1>
      <LibraryMaterialForm />
    </main>
  );
}
