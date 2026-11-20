import { handleBankFileRequest } from "@/server/router";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ entryId: string; list: string; taskIndex: string; picture: string }> };

/** A picture of a bank task's part, such as an answer option (#224), after the same check as the task's picture. */
export async function GET(request: Request, { params }: Context) {
  const { entryId, list, taskIndex, picture } = await params;
  return handleBankFileRequest(request, entryId, list, taskIndex, { picture });
}
