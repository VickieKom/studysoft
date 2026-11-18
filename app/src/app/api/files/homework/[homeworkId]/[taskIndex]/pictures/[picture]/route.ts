import { handleHomeworkImageRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ homeworkId: string; taskIndex: string; picture: string }> };

/** A picture of a task's part, such as an answer option (#129), after the same permission check as the task's picture. */
export async function GET(request: Request, { params }: Context) {
  const { homeworkId, taskIndex, picture } = await params;
  return handleHomeworkImageRequest(request, homeworkId, taskIndex, { picture });
}
