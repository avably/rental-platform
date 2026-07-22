import "server-only";

/**
 * Dostępność płatności online w sklepie najemcy (Z3, ADR-066) — WYŁĄCZNIE po
 * stronie serwera.
 *
 * `server-only` na górze nie jest ozdobą: ten moduł buduje klienta dostawcy
 * z klucza sekretnego. Import z komponentu klienckiego ma paść przy budowaniu,
 * a nie objawić się kluczem w bundlu.
 *
 * DWA ODCZYTY, DWA RÓŻNE ŹRÓDŁA:
 *   1. identyfikator konta — z NASZEJ bazy (app.get_public_payment_account),
 *      bo to fakt o naszym najemcy;
 *   2. gotowość konta — od DOSTAWCY (readConnectAccount), bo to fakt o jego
 *      decyzji, a nasza kopia w `payment_accounts` jest migawką sprzed
 *      nieznanego czasu (0028/ADR-049).
 * Zamiana źródeł miejscami jest dokładnie tym błędem, który ta faza ma nie
 * popełnić: konto zablokowane wczoraj wyglądałoby dziś na gotowe.
 */
import {
  readConnectAccount,
  resolveStripeConfig,
  StripeConfigError,
  canAcceptCharges,
} from "@avably/core";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { OnlinePaymentAvailability } from "@/lib/checkout/payment-options";

/** Identyfikator konta najemcy u dostawcy; `null` = najemca go nie zakładał. */
export async function readTenantAccountId(tenantId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_public_payment_account", { p_tenant_id: tenantId });
  if (error) {
    // Odmowa bazy nie ma prawa wywrócić checkoutu przelewowego — wołający
    // potraktuje `null` jak „brak konta", czyli tor online niedostępny.
    console.error("[checkout] odczyt konta płatności nie powiódł się", error);
    return null;
  }
  return (data as string | null) ?? null;
}

/**
 * Klucz publikowalny dostawcy — czytany na SERWERZE i stamtąd podawany
 * przeglądarce (ADR-066).
 *
 * NIE `NEXT_PUBLIC_*`: tamta przestrzeń jest wstawiana do bundla przy
 * BUDOWANIU, więc wartość zamarza w artefakcie. Rotacja klucza albo
 * przełączenie trybu test↔live wymagałyby przebudowy, a do tego czasu
 * przeglądarka potwierdzałaby płatność kluczem z INNEGO trybu niż ten,
 * którym serwer ją utworzył — awaria niema, dokładnie w kształcie 2.6c.
 * Czytany tutaj klucz przechodzi w dodatku przez bramki `resolveStripeConfig`
 * (zamiana kluczy, rozjazd trybów), których stała build-time nie widzi.
 */
export function readPublishableKey(): string | null {
  try {
    return resolveStripeConfig().publishableKey;
  } catch (error) {
    if (error instanceof StripeConfigError) return null;
    throw error;
  }
}

/**
 * Pełna odpowiedź na pytanie „czy pokazać klientowi płatność online".
 *
 * NIGDY NIE RZUCA. Awaria dostawcy, brak konfiguracji i brak konta dają ten
 * sam skutek: `chargesEnabled: false`, czyli w checkoucie zostaje tor offline.
 * Wyjątek wypuszczony stąd wywróciłby CAŁY checkout — także klientowi, który
 * wybrał przelew i o istnieniu integracji nie ma pojęcia.
 */
export async function readOnlinePaymentAvailability(
  tenantId: string,
): Promise<OnlinePaymentAvailability> {
  const publishableKey = readPublishableKey();
  if (!publishableKey) return { stripeConfigured: false, chargesEnabled: false };

  const accountId = await readTenantAccountId(tenantId);
  if (!accountId) return { stripeConfigured: true, chargesEnabled: false };

  try {
    const state = await readConnectAccount(accountId);
    return { stripeConfigured: true, chargesEnabled: canAcceptCharges(state) };
  } catch (error) {
    console.error("[checkout] odczyt stanu konta u dostawcy nie powiódł się", error);
    return { stripeConfigured: true, chargesEnabled: false };
  }
}
