/**
 * Powrót z onboardingu KYC (Z2, ADR-065) — MIEJSCE, W KTÓRYM MUSI STAĆ ODCZYT.
 *
 * Dostawca odsyła tu przeglądarkę, gdy najemca „skończył" formularz. Ten adres
 * NIE JEST DOWODEM NICZEGO: mówi wyłącznie, że jakaś przeglądarka gdzieś była.
 * Można go wkleić ręcznie, można wrócić po przerwaniu KYC w połowie, a dostawca
 * dokumentuje to wprost. To dokładnie kształt awarii 2.6b — „kolumna ustawiona
 * bez dowodu, UI mówi «Działa»" — tyle że na osi pieniędzy.
 *
 * Dlatego handler nie czyta z adresu ŻADNEGO parametru stanu i niczego z niego
 * nie zapisuje. Robi jedno: wykonuje `GET /v1/accounts/{id}` po stronie serwera
 * i zapisuje TO, co odczytał (reguła naczelna fazy 3, ADR-049).
 *
 * Handler NIE RZUCA przy awarii dostawcy: powód ląduje w `last_error`,
 * a najemca wraca na ekran z komunikatem i przyciskiem ponowienia — zamiast
 * na białą stronę błędu po wyjściu z cudzego formularza.
 */
import { redirect } from "next/navigation";

import { syncConnectAccountSafely } from "@avably/core";

import { AuthError } from "@/lib/auth";
import { localePath } from "@/lib/navigation";
import { requireMember } from "@/lib/supabase-server";

import { PAYMENT_SETTINGS_PATH } from "../payments-config";

export async function GET(): Promise<Response> {
  let context;
  try {
    context = await requireMember();
  } catch (error) {
    if (error instanceof AuthError) redirect(await localePath("/login", { next: PAYMENT_SETTINGS_PATH }));
    throw error;
  }

  const { data: account } = await context.supabase
    .from("payment_accounts")
    .select("provider_account_id")
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (account) {
    const sync = await syncConnectAccountSafely(account.provider_account_id as string);

    // Kolumny gotowości powstają WYŁĄCZNIE z `sync.state`. Gdyby odczyt padł,
    // zapisujemy sam powód i zostawiamy poprzednią migawkę — patrz akcje.
    const patch = sync.state
      ? {
          charges_enabled: sync.state.chargesEnabled,
          payouts_enabled: sync.state.payoutsEnabled,
          details_submitted: sync.state.detailsSubmitted,
          requirements_due: sync.state.requirementsDue,
          last_error: null,
          last_synced_at: new Date().toISOString(),
        }
      : { last_error: sync.error };

    await context.supabase
      .from("payment_accounts")
      .update(patch)
      .eq("tenant_id", context.tenantId);
  }

  redirect(await localePath(PAYMENT_SETTINGS_PATH));
}
