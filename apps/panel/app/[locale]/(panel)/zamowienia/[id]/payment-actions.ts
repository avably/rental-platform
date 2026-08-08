"use server";

/**
 * „Sprawdź status płatności" — ręczne wejście w tę samą rekoncyliację, którą
 * co kwadrans wykonuje job (L11, ADR-104).
 *
 * PO CO PRZYCISK, SKORO JEST PĘTLA. Bo operator rozmawia z klientem TERAZ:
 * „zapłaciłem, a u was nie widać". Odesłanie go z „proszę czekać do
 * kwadransa" jest odpowiedzią, której nie da się udzielić przy ladzie —
 * a każda inna droga, którą operator sobie wymyśli (ręczne przestawienie
 * statusu), byłaby twierdzeniem o pieniądzach bez odczytu.
 *
 * ================== TRZY GRANICE, KTÓRE TA AKCJA TRZYMA ==================
 *
 * 1. AUTORYZACJA JEST TUTAJ, NIE NIŻEJ. `requireMember()` daje tożsamość,
 *    a zamówienie jest odnajdywane KLIENTEM Z SESJĄ i filtrem po
 *    `tenant_id` z JWT (RLS 0013 jest drugą bramką tego samego). Dopiero
 *    zamówienie, które przeszło TEN odczyt, jedzie dalej. `tenant_id`
 *    z formularza nie występuje w tym pliku ani razu — bo gdyby występował,
 *    członek tenanta A podałby identyfikator tenanta B.
 *
 * 2. ZAPIS IDZIE TĄ SAMĄ ŚCIEŻKĄ CO JOB. `reconcileOrderPayment` woła to
 *    samo `applySettlement`, co webhook i pętla — zero drugiej ścieżki
 *    zapisu. Klient service-role, którego ten zapis wymaga (bramka 0030
 *    rezerwuje `paid`/`payment_failed` dla `service_role`), mieszka
 *    wyłącznie w `src/jobs/**` i NIE wchodzi do tego pliku.
 *
 * 3. DO UI WRACA STATUS, NIE ODPOWIEDŹ DOSTAWCY. Ani identyfikatora konta
 *    połączonego, ani `pi_...`, ani surowego ciała odczytu. Członek widzi
 *    stan swojej płatności — i nic poza tym.
 *
 * Rola: `requireMember()`, czyli także `staff`. To odczyt u dostawcy
 * i zapis tego, co dostawca powiedział — nie jest to decyzja operatorska
 * ani akcja destrukcyjna, więc nie wymaga właściciela (wzorzec
 * `refreshShipmentStatusAction`).
 */
import type { PaymentStatus } from "@avably/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuthError } from "@/lib/auth";
import { zodErrorToState, type FormState } from "@/lib/form-state";
import { uuidSchema } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";
import { reconcileOrderPayment } from "@/src/jobs/reconcile-payments";

const paymentCheckSchema = z.object({ orderId: uuidSchema });

/** Stan akcji + status PO rekoncyliacji, żeby UI nie musiał zgadywać. */
export type PaymentCheckState = FormState & { paymentStatus?: PaymentStatus };

const str = (value: FormDataEntryValue | null) => (typeof value === "string" ? value : "");

export async function checkPaymentStatusAction(
  _prevState: PaymentCheckState,
  formData: FormData,
): Promise<PaymentCheckState> {
  const parsed = paymentCheckSchema.safeParse({ orderId: str(formData.get("orderId")) });
  if (!parsed.success) return zodErrorToState(parsed.error);

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  // --- Własność zamówienia: rozstrzygnięta KLIENTEM Z SESJĄ, po tenancie
  //     z JWT. Cudze zamówienie nie przechodzi tego odczytu, więc nie ma
  //     jak dojść do ścieżki service-role niżej.
  const { data: order } = await ctx.supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.orderId)
    .maybeSingle();
  if (!order) return { formError: "Zamówienie nie istnieje albo zostało usunięte." };

  const entry = await reconcileOrderPayment({
    tenantId: ctx.tenantId!,
    orderId: parsed.data.orderId,
  });

  if (entry.outcome === "failed") {
    return { formError: entry.reason };
  }

  if (entry.outcome === "settled" || entry.outcome === "expired") {
    revalidatePath("/", "layout");
    return { success: "paymentChecked", paymentStatus: entry.paymentStatus ?? undefined };
  }

  // `unchanged` i `skipped` to NIE sukces i NIE porażka: odczyt się udał,
  // a stanu nie było po co ruszać. Komunikat neutralny mówi operatorowi
  // dokładnie tyle, ile wiemy — zamiast „gotowe", które sugerowałoby zmianę.
  return {
    notice: entry.reason,
    ...(entry.paymentStatus ? { paymentStatus: entry.paymentStatus } : {}),
  };
}
