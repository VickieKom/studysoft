import { handleAssessmentFileRemove, handleAssessmentFileRequest, handleAssessmentFileUpload } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ assessmentId: string; which: string }> };

/** An assessment's recording for «Аудирование» or picture for «Говорение» (#252): the teacher's. */
export async function GET(request: Request, { params }: Context) {
  const { assessmentId, which } = await params;
  return handleAssessmentFileRequest(request, assessmentId, which);
}

export async function PUT(request: Request, { params }: Context) {
  const { assessmentId, which } = await params;
  return handleAssessmentFileUpload(request, assessmentId, which);
}

export async function DELETE(request: Request, { params }: Context) {
  const { assessmentId, which } = await params;
  return handleAssessmentFileRemove(request, assessmentId, which);
}
