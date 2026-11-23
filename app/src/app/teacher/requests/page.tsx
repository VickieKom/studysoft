import { ClientRequests } from "@/components/client-requests";
import { teacherCaller } from "../caller";

export const metadata = { title: "Привлечение клиентов — StudySoft" };

/**
 * «Привлечение клиентов» (#337): the requests of families who may become
 * students, by stage, from «Заявка» to «Отказ». The intro lesson (#338), the
 * brief (#339), the offer (#340) and the metrics (#341) come later.
 */
export default async function RequestsPage() {
  const { caller } = await teacherCaller();
  const { requests, today } = await caller.teacher.requests.list();
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">Привлечение клиентов</h1>
      <ClientRequests requests={requests} today={today} />
    </main>
  );
}
