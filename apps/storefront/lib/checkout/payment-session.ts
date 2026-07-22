import "server-only";

/**
 * Odczyt WŁASNEGO zamówienia na potrzeby kroku płatności i strony powrotu
 * (Z3, ADR-066).
 *
 * TO JEST TA STRONA GRANICY ZAUFANIA, PO KTÓREJ WOLNO COKOLWIEK TWIERDZIĆ
 * O PIENIĄDZACH. Wejście: ciasteczko `httpOnly` z uchwytem do checkoutu.
 * Wyjście: wiersz Z NASZEJ BAZY. Adres URL, z którym klient wraca od
 * dostawcy, nie jest tu użyty ani razu — `?payment_intent=…` i
 * `?redirect_status=succeeded` dopisze sobie każdy, kto umie edytować pasek
 * adresu, a przeglądarka i tak jest po złej stronie granicy.
 */
import { headers } from "next/headers";
import { cookies } from "next/headers";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";
import type { PayableOrder } from "@/lib/checkout/online-payment";
import { CHECKOUT_COOKIE, decodeCheckoutHandle } from "@/lib/checkout/session-cookie";

/** Kształt jsonb z app.get_public_order_payment (0029). */
interface OrderPaymentRow {
  order_number: string;
  order_status: string;
  payment_status: string;
  payment_method: string | null;
  payment_provider: string;
  provider_payment_intent_id: string | null;
  amount_grosze: number;
  currency: string;
}

export interface CheckoutOrderView extends PayableOrder {
  orderStatus: string;
  paymentMethod: string | null;
  /** Token uchwytu — potrzebny do zapisu wiązania płatności; NIE do widoku. */
  token: string;
}

/**
 * Ładuje zamówienie wskazane ciasteczkiem. `null` znaczy „nie ma czego
 * pokazać" i jest stanem NORMALNYM: ciasteczko wygasa po dwóch godzinach,
 * a link wysłany komuś innemu z definicji nie niesie cudzego ciasteczka.
 * Wołający robi z tego przekierowanie do sklepu, nie komunikat o awarii.
 */
export async function loadCheckoutOrder(): Promise<CheckoutOrderView | null> {
  const tenantId = (await headers()).get(TENANT_ID_HEADER);
  if (!tenantId) return null;

  const handle = decodeCheckoutHandle((await cookies()).get(CHECKOUT_COOKIE)?.value);
  if (!handle) return null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.schema("app").rpc("get_public_order_payment", {
    p_tenant_id: tenantId,
    p_order_id: handle.orderId,
    p_checkout_token: handle.token,
  });

  if (error) {
    console.error("[checkout] odczyt stanu płatności nie powiódł się", error);
    return null;
  }
  if (!data) return null;

  const row = data as OrderPaymentRow;
  return {
    orderId: handle.orderId,
    token: handle.token,
    orderNumber: row.order_number,
    orderStatus: row.order_status,
    // Kwota POLICZONA PRZEZ SERWER przy składaniu zamówienia — jedyna, z którą
    // wolno porównywać cokolwiek u dostawcy.
    amountGrosze: row.amount_grosze,
    currency: row.currency,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    paymentProvider: row.payment_provider,
    providerPaymentIntentId: row.provider_payment_intent_id,
  };
}
