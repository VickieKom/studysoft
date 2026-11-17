import { handleAnswerFileRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ homeworkId: string; attempt: string; taskIndex: string }> };

/** A recording or file of one attempt, for «Проверка домашек» (#93). */
export async function GET(request: Request, { params }: Context) {
  const { homeworkId, attempt, taskIndex } = await params;
  return handleAnswerFileRequest(request, homeworkId, taskIndex, attempt);
}
