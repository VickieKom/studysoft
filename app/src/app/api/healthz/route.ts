import { createServerCaller } from "@/server/router";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const health = await createServerCaller(request.headers).health.check();
  return Response.json(health, {
    status: health.database === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
