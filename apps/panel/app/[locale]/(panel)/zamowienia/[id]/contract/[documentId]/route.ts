import { AuthError } from "@/lib/auth";
import { assertClosableOrder } from "@/lib/closing";
import { uuidSchema } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";

import { contractServiceDeps } from "../../contract-adapters";
import { downloadContract } from "../../contract-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> },
): Promise<Response> {
  const { id: orderId, documentId } = await params;
  if (!uuidSchema.safeParse(orderId).success || !uuidSchema.safeParse(documentId).success) {
    return new Response("Nieprawidłowy identyfikator.", { status: 400 });
  }
  // Opt-in okna domykania (ADR-138): PDF umowy jest częścią kompletu
  // umownego z allowlisty; zbiór pilnowany predykatem na argumencie.
  let context;
  try {
    context = await requireMember(undefined, { closing: true });
    await assertClosableOrder(context, orderId);
  } catch (error) {
    if (error instanceof AuthError) return new Response(null, { status: error.status });
    throw error;
  }
  try {
    const result = await downloadContract(contractServiceDeps(context.supabase), {
      tenantId: context.tenantId!, orderId, documentId,
    });
    return new Response(result.bytes as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${result.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Nie udało się pobrać umowy.", { status: 404 });
  }
}
