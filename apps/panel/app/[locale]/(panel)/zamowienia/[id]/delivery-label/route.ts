/**
 * Etykieta przewozowa PDF na żądanie (ADR-031): panel NIE przechowuje
 * etykiet — pobiera je z API dostawcy po provider_order_hash, który nigdy
 * nie wychodzi do przeglądarki (klucz-uprawnienie zostaje server-side).
 * Route handler zamiast server action, bo akcja nie umie odpowiedzieć
 * strumieniem application/pdf.
 *
 * GET /{locale}/zamowienia/{id}/delivery-label?shipment={uuid}
 */
import { GlobKurierAPIError } from "@avably/core";

import { AuthError } from "@/lib/auth";
import { assertClosableOrder } from "@/lib/closing";
import { uuidSchema } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";

import { loadCourierApi } from "../delivery";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; locale: string }> },
): Promise<Response> {
  const { id: orderId } = await params;
  const shipmentId = new URL(request.url).searchParams.get("shipment") ?? "";
  if (!uuidSchema.safeParse(orderId).success || !uuidSchema.safeParse(shipmentId).success) {
    return new Response("Nieprawidłowy identyfikator.", { status: 400 });
  }

  // Opt-in okna domykania (ADR-138): etykieta PDF należy do kompletu
  // kurierskiego z allowlisty; zbiór pilnowany predykatem na argumencie.
  let ctx;
  try {
    ctx = await requireMember(undefined, { closing: true });
    await assertClosableOrder(ctx, orderId);
  } catch (err) {
    // Status z AuthError (401/403) — jak w route umowy; wcześniejsze gołe 401
    // maskowałoby odmowę okna domykania jako brak sesji.
    if (err instanceof AuthError) return new Response(null, { status: err.status });
    throw err;
  }

  // Filtr po order_id ORAZ id przesyłki: etykieta jest osiągalna wyłącznie
  // spod zamówienia, do którego należy (spójność z linkiem sekcji dostawy).
  const { data: shipment } = await ctx.supabase
    .from("courier_shipments")
    .select("id, provider_order_number, provider_order_hash")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", orderId)
    .eq("id", shipmentId)
    .maybeSingle();
  if (!shipment) return new Response("Przesyłka nie istnieje.", { status: 404 });
  if (!shipment.provider_order_hash) {
    return new Response("Dostawca nie udostępnił jeszcze etykiety tej przesyłki.", {
      status: 409,
    });
  }

  const courier = await loadCourierApi(ctx.supabase, ctx.tenantId!);
  if (courier.configError !== undefined) {
    return new Response(courier.configError, { status: 409 });
  }

  let bytes: Uint8Array;
  try {
    bytes = await courier.api.getLabelsByHashes([shipment.provider_order_hash as string], "A4");
  } catch (err) {
    if (err instanceof GlobKurierAPIError) {
      return new Response(`Pobranie etykiety nie powiodło się: ${err.message}`, {
        status: 502,
      });
    }
    throw err;
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="etykieta-${shipment.provider_order_number}.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
