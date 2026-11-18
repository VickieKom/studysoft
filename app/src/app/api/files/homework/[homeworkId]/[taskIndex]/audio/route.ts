import { handleHomeworkImageRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ homeworkId: string; taskIndex: string }> };

/** A task's recording (#127), after the same permission check as its picture. */
export async function GET(request: Request, { params }: Context) {
  const { homeworkId, taskIndex } = await params;
  return handleHomeworkImageRequest(request, homeworkId, taskIndex, "audio");
}
