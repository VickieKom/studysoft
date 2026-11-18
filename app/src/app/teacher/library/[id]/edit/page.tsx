import Link from "next/link";
import { notFound } from "next/navigation";
import { LibraryMaterialForm } from "@/components/library-material-form";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../../caller";

export const metadata = { title: "Изменить материал — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «Изменить» (#115, #116): the title and the tags, a game's warm-up mark, a questions warm-up's questions; a file stays. */
export default async function EditMaterialPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  let material;
  try {
    material = await caller.teacher.library.get({ id });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  return (
    <main className="flex flex-col gap-6">
      <p>
        <Link href={`/teacher/library/${material.id}`} className="text-small text-green-600 hover:text-green-700">
          ← {material.title}
        </Link>
      </p>
      <h1 className="text-h1 font-bold">Изменить материал</h1>
      <LibraryMaterialForm
        material={{
          id: material.id,
          kind: material.kind,
          title: material.title,
          level: material.level,
          topic: material.topic ?? "",
          ageGroup: material.ageGroup,
          warmup: material.warmup,
          questions: material.questions,
        }}
      />
    </main>
  );
}
