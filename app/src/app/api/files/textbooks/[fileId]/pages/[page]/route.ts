import { handleTextbookFileRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ fileId: string; page: string }> };

/** A rendered page of a textbook's book, for its teacher only (#156). */
export async function GET(request: Request, { params }: Context) {
  const { fileId, page } = await params;
  return handleTextbookFileRequest(request, fileId, page);
}
