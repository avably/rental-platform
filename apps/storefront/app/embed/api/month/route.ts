import { handleEmbedMonthRequest } from "@/lib/embed/handlers";
import { embedMonthDeps } from "@/lib/embed/deps";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleEmbedMonthRequest(request, embedMonthDeps(request));
}
