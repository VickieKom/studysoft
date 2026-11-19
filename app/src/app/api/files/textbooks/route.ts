import { handleTextbookUpload } from "@/server/router";

export const dynamic = "force-dynamic";

/** A textbook's book or track, uploaded before its set is saved (#156). */
export async function PUT(request: Request) {
  return handleTextbookUpload(request);
}
