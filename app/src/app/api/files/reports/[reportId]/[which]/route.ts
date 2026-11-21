import { handleReportRecordingRemove, handleReportRecordingRequest, handleReportRecordingUpload } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ reportId: string; which: string }> };

/** A report's recording «было» or «стало» (#269): the teacher's and, once published, the parent's. */
export async function GET(request: Request, { params }: Context) {
  const { reportId, which } = await params;
  return handleReportRecordingRequest(request, reportId, which);
}

export async function PUT(request: Request, { params }: Context) {
  const { reportId, which } = await params;
  return handleReportRecordingUpload(request, reportId, which);
}

export async function DELETE(request: Request, { params }: Context) {
  const { reportId, which } = await params;
  return handleReportRecordingRemove(request, reportId, which);
}
