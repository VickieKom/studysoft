import { handleTextbookFileRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ fileId: string }> };

/** A textbook's book or track, for its teacher only (#156). */
export async function GET(request: Request, { params }: Context) {
  const { fileId } = await params;
  return handleTextbookFileRequest(request, fileId, null);
}
