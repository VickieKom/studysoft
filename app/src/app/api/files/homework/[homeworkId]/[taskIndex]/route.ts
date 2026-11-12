import { handleHomeworkImageRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ homeworkId: string; taskIndex: string }> };

export async function GET(request: Request, { params }: Context) {
  const { homeworkId, taskIndex } = await params;
  return handleHomeworkImageRequest(request, homeworkId, taskIndex);
}
