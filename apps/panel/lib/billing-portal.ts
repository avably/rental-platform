/**
 * Rdzeń otwarcia PORTALU KLIENTA dostawcy płatności (J2 faza 3, ADR-152).
 *
 * Portal jest jedynym miejscem, w którym najemca wymienia kartę, pobiera
 * faktury i widzi historię płatności — nie odtwarzamy tych ekranów u siebie.
 * Cała nasza odpowiedzialność mieści się w jednym zdaniu: **sesja Portalu
 * powstaje wyłącznie dla klienta przypisanego do TEGO najemcy**.
 *
 * DWIE NIEZALEŻNE WARSTWY TOŻSAMOŚCI (obie muszą się zgodzić):
 *
 *   1. `cus_…` NIE PRZYCHODZI Z ŻĄDANIA. Bierzemy go z projekcji zawężonej
 *      do `tenant_id` ownera, czytanej klientem JEGO sesji — RLS jest tu
 *      bramką, nie ozdobą. Nie ma parametru, którym dałoby się podstawić
 *      cudzy identyfikator, bo takiego parametru nie ma w sygnaturze.
 *   2. WERDYKT Z ODCZYTU U DOSTAWCY (ADR-049). Nawet własny wiersz projekcji
 *      może nieść cudzy albo nieaktualny `cus_…` (wpis superadmina, ręczna
 *      operacja w dashboardzie, skrzyżowane strumienie webhooków). Dlatego
 *      przed utworzeniem sesji pytamy dostawcę, czyj to klient, i porównujemy
 *      z naszym tenantem. Rozjazd = odmowa BEZ tworzenia sesji.
 *
 * Warstwa 2 nie jest paranoją „na wszelki wypadek": to jedyna warstwa, która
 * działa, gdy prawda po naszej stronie jest już przekłamana. Zdjęcie
 * którejkolwiek z nich pali imienny test w `billing-portal.test.ts`.
 *
 * CZEGO TU NIE MA: zapisu stanu. Portal potrafi anulować subskrypcję i
 * wymienić kartę, ale `public.subscriptions` i `tenants.status` przestawia
 * WYŁĄCZNIE webhook z odczytu (ADR-136) — powrót z Portalu niczego nie
 * „potwierdza", bo nie ma prawa niczego wiedzieć.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Wycinek portu rozliczeń, którego rdzeń Portalu potrzebuje (DI dla testów). */
export interface BillingPortalClient {
  readCustomerTenantId(customerId: string): Promise<string | null>;
  createBillingPortalSession(input: {
    customerId: string;
    returnUrl: string;
    locale?: string | undefined;
  }): Promise<{ url: string }>;
}

export interface OpenBillingPortalDeps {
  /** Klient SESJI właściciela — projekcja czytana przez RLS, nigdy service-role. */
  supabase: SupabaseClient;
  billing: BillingPortalClient;
}

export interface OpenBillingPortalInput {
  tenantId: string;
  locale: string;
  returnUrl: string;
}

export type OpenBillingPortalOutcome = { url: string } | { error: string };

/**
 * Najemca bez klienta u dostawcy nie ma czym zarządzać — to normalny stan
 * konta w okresie próbnym, nie awaria. Komunikat mówi, co zrobić dalej.
 */
export const PORTAL_NO_CUSTOMER =
  "Zarządzanie płatnościami będzie dostępne po wybraniu planu i pierwszej płatności.";

/**
 * Rozjazd przypisania klienta. Komunikat celowo NIE cytuje żadnego
 * identyfikatora dostawcy: to dane spoza tenanta i nie mają czego robić na
 * ekranie ani w echu błędu.
 */
export const PORTAL_FOREIGN_CUSTOMER =
  "Nie udało się potwierdzić konta płatności tej organizacji. Skontaktuj się ze wsparciem Avably.";

export async function openBillingPortal(
  deps: OpenBillingPortalDeps,
  input: OpenBillingPortalInput,
): Promise<OpenBillingPortalOutcome> {
  // Warstwa 1: identyfikator klienta WYŁĄCZNIE z własnego wiersza projekcji.
  const projection = await deps.supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (projection.error) {
    return { error: `Odczyt stanu subskrypcji nie powiódł się: ${projection.error.message}` };
  }
  const customerId = (projection.data as { stripe_customer_id: string | null } | null)
    ?.stripe_customer_id;
  if (!customerId) {
    return { error: PORTAL_NO_CUSTOMER };
  }

  // Warstwa 2: czyj to klient — pyta się DOSTAWCĘ, nie własnej bazy.
  const ownerTenantId = await deps.billing.readCustomerTenantId(customerId);
  if (ownerTenantId !== input.tenantId) {
    return { error: PORTAL_FOREIGN_CUSTOMER };
  }

  const session = await deps.billing.createBillingPortalSession({
    customerId,
    returnUrl: input.returnUrl,
    locale: input.locale,
  });
  return { url: session.url };
}
