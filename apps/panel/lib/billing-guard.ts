/**
 * Guard AKCJI ROZLICZEŃ (J2 faza 2a, ADR-136) — korekta K1 ze spike'u J2.
 *
 * DLACZEGO NIE `requireMember`. Tamten guard zamyka panel dla
 * PANEL_CLOSED_STATUSES (suspended/cancelled/superadmin_locked, ADR-107)
 * — czyli odmówiłby DOKŁADNIE temu tenantowi, który ma zapłacić: dzień po
 * przejściu w `suspended` właściciel widziałby ekran bez żadnej możliwości
 * uregulowania faktury (K1: „guard zamyka drzwi, które checkout chce
 * otworzyć"). Akcje rozliczeń mają własny, WĘŻSZY zbiór odmów:
 *
 *   * `superadmin_locked` — blokada PLATFORMOWA (antyfraudowa) nie jest
 *     stanem rozliczeniowym; zapłata jej nie zdejmuje (zasada 6), więc
 *     checkout w locku byłby pobraniem pieniędzy bez zwrotu dostępu.
 *   * `cancelled` — organizacja zamknięta; reaktywacja to świadoma ścieżka
 *     przyszłej fazy (portal/checkout reaktywacyjny), nie boczne drzwi
 *     w akcji checkoutu.
 *
 * `suspended` PRZECHODZI — właśnie po to ten guard istnieje: zapłata
 * z zawieszenia wraca do `active` natychmiast (zasada 5). Relacja z oknem
 * domykania 2b: okno otworzy CZĘŚĆ panelu na domknięcie najmów, a ścieżka
 * płatności musi działać także PO zamknięciu okna — dlatego wisi na tym
 * guardzie, nie na guardzie okna.
 *
 * OWNER-ONLY: abonament to zobowiązanie organizacji — podpisuje właściciel.
 *
 * BEZ PĘTLI PRZEKIEROWAŃ: guard służy WYŁĄCZNIE server actions (rzuca
 * AuthError, akcja mapuje na komunikat) — nie stronom, więc nie ma dokąd
 * przekierowywać (pułapka K3 z krytyki wariantu B nie ma się gdzie zalęgnąć).
 */
import type { TenantStatus } from "@avably/db";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AuthError, getAuthContext, type AuthContext } from "./auth";
import { createSupabaseServerClient } from "./supabase-server";

/** Statusy zamykające AKCJE ROZLICZEŃ — węższe niż PANEL_CLOSED_STATUSES. */
export const BILLING_CLOSED_STATUSES: readonly TenantStatus[] = [
  "cancelled",
  "superadmin_locked",
];

/**
 * Rdzeń guardu (testowalny z wstrzykniętym klientem). Rzuca `AuthError`:
 * 401 bez sesji; 403 bez organizacji / bez żywego członkostwa / bez roli
 * owner / dla statusów z BILLING_CLOSED_STATUSES (kod `tenant_suspended` —
 * ten sam słownik odmów co reszta panelu).
 */
export async function requireBillingOwnerWithClient(
  supabase: SupabaseClient,
): Promise<AuthContext> {
  const ctx = await getAuthContext(supabase);
  if (!ctx) throw new AuthError(401, "Wymagane zalogowanie.");
  if (!ctx.tenantId) throw new AuthError(403, "Brak przypisanej organizacji.");

  // Żywy odczyt członkostwa + statusu (wzorzec requireMemberWithClient,
  // R12b/ADR-127): claim JWT nie jest dowodem — rola i status z bazy.
  const { data: memberRow, error: memberError } = await supabase
    .from("members")
    .select("role, tenants(status)")
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (memberError) {
    throw new Error(
      `Nie udało się zweryfikować członkostwa w organizacji: ${memberError.message}`,
    );
  }
  if (!memberRow) {
    throw new AuthError(403, "Członkostwo w organizacji zostało cofnięte.", "membership_revoked");
  }

  const row = memberRow as {
    role: "owner" | "staff";
    tenants: { status: TenantStatus } | { status: TenantStatus }[] | null;
  };
  const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
  if (!tenant) {
    throw new Error("Nie udało się zweryfikować statusu organizacji: brak powiązanej organizacji.");
  }

  if (BILLING_CLOSED_STATUSES.includes(tenant.status)) {
    // Kody rozdzielone (ADR-138): blokada platformowa ≠ organizacja
    // zamknięta. `suspended` tu NIE odmawia — po to ten guard istnieje.
    throw new AuthError(
      403,
      "Rozliczenia tej organizacji są zamknięte. Skontaktuj się ze wsparciem Avably.",
      tenant.status === "superadmin_locked" ? "tenant_locked" : "tenant_cancelled",
    );
  }
  if (row.role !== "owner") {
    throw new AuthError(403, "Akcje rozliczeń wymagają roli właściciela.");
  }

  ctx.role = row.role;
  ctx.tenantStatus = tenant.status;
  return ctx;
}

/** Owijka na kliencie serwerowym — wejście dla server actions rozliczeń. */
export async function requireBillingOwner(): Promise<AuthContext> {
  return requireBillingOwnerWithClient(await createSupabaseServerClient());
}
