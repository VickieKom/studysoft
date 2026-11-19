import { handleLibraryVideoUpload } from "@/server/router";

export const dynamic = "force-dynamic";

/** An own video's file, uploaded before its material is saved (#117). */
export async function PUT(request: Request) {
  return handleLibraryVideoUpload(request);
}
