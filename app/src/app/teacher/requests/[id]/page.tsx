import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestBrief } from "@/components/request-brief";
import { REQUEST_SOURCE_LABELS, REQUEST_STAGE_LABELS } from "@/domain/requests";
import { isNotFound } from "@/server/router";
import { teacherCaller } from "../../caller";

export const metadata = { title: "Заявка — StudySoft" };

type Props = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A request's page (#339): who, from where, at what stage, and «Бриф»,
 * filled in during the intro. Another teacher's request and a missing one
 * end in the same 404.
 */
export default async function RequestPage({ params }: Props) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { caller } = await teacherCaller();
  let request;
  let brief;
  try {
    request = await caller.teacher.requests.get({ id });
    brief = await caller.teacher.requests.brief({ id });
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
  return (
    <main className="flex flex-col gap-4">
      <p>
        <Link href="/teacher/requests" className="text-small text-green-600 hover:text-green-700">
          ← Привлечение клиентов
        </Link>
      </p>
      <h1 className="text-h1 font-bold">{request.firstName}</h1>
      <p className="flex flex-wrap gap-3 text-small text-text-secondary">
        <span>{REQUEST_STAGE_LABELS[request.stage]}</span>
        <span>{REQUEST_SOURCE_LABELS[request.source]}</span>
        {request.age !== null && <span>{request.age} лет</span>}
        {request.schoolYear && <span>{request.schoolYear} класс</span>}
        {request.contact && <span>{request.contact}</span>}
      </p>
      <RequestBrief requestId={request.id} brief={brief} />
    </main>
  );
}
