import { handleBankFileRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ entryId: string; list: string; taskIndex: string }> };

/** A bank task's picture (#224), to the teacher whose bank it is. */
export async function GET(request: Request, { params }: Context) {
  const { entryId, list, taskIndex } = await params;
  return handleBankFileRequest(request, entryId, list, taskIndex);
}
