import { handleEmbedReservationRequest } from "@/lib/embed/handlers";
import { embedReservationDeps } from "@/lib/embed/deps";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleEmbedReservationRequest(request, embedReservationDeps(request));
}
