import { handleLibraryFileRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ materialId: string }> };

/** A library material's file, for its teacher (#115). */
export async function GET(request: Request, { params }: Context) {
  const { materialId } = await params;
  return handleLibraryFileRequest(request, materialId);
}
