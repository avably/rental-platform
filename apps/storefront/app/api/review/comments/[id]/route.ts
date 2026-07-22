/**
 * Zmiana uwagi przeglądu — droga storefrontowa (ADR-071). Ta sama podwójna
 * bramka co w route.ts obok (REVIEW_MODE + hasło site'u w proxy); uzasadnienie
 * wyjątku service_role — patrz nagłówek tamtego pliku.
 */
import { handlePatchRequest } from "@avably/review";
import { createServiceClient } from "@avably/db/service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (process.env.REVIEW_MODE !== "1") return new Response("Not Found", { status: 404 });
  const { id } = await params;
  return handlePatchRequest(createServiceClient(), request, id);
}
