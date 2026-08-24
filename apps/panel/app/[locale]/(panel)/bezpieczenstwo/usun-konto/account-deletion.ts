/**
 * Kontekst usunięcia konta — moduł BEZ dyrektyw (wzorzec `zaproszenia/team.ts`).
 *
 * Nie może mieszkać w `actions.ts`: plik z "use server" wystawia KAŻDY swój
 * eksport jako punkt wejścia akcji serwerowej, a ta funkcja przyjmuje klienta
 * Supabase w argumencie — czyli coś, czego nie da się (i nie wolno)
 * serializować z przeglądarki. Ten sam kontekst czyta STRONA (żeby oddać stan
 * zablokowany bez formularza) i AKCJA (żeby ten sam warunek wyegzekwować po
 * stronie serwera) — jedno źródło prawdy, żadnej bramki tylko w UI.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthContext } from "@/lib/auth";

export interface AccountDeletionContext {
  /** Adres konta wołającego — do wglądu i jako wzorzec potwierdzenia. */
  email: string | null;
  /** Organizacja z bieżącego claimu, jeśli jakąkolwiek ma. */
  tenantId: string | null;
  /** Czy wołający jest właścicielem tej organizacji. */
  isOwner: boolean;
  /** Liczba właścicieli tej organizacji (0, gdy nie udało się odczytać). */
  ownerCount: number;
  /**
   * JEDYNY właściciel organizacji. Usunięcie jego konta osierociłoby dane
   * tenanta (auth user + dane + Stripe + RLS), więc ten stan BLOKUJE żądanie —
   * priorytet: nie zniszczyć danych. Fail-safe: jeśli liczby właścicieli nie
   * udało się odczytać (`ownerCount === 0`), traktujemy to jak jedynego
   * właściciela i i tak blokujemy — nigdy nie ryzykujemy osierocenia w drugą
   * stronę.
   */
  isSoleOwner: boolean;
}

/**
 * Kontekst decyzji o usunięciu konta wołającego.
 *
 * Liczbę właścicieli czytamy z `public.members` klientem SESJI wołającego —
 * bramką jest RLS (ta sama polityka, którą czyta ekran zespołu w
 * `loadTeamMembers`), więc zapytanie widzi WYŁĄCZNIE członków własnej
 * organizacji. Sesja bez organizacji (onboarding) albo rola inna niż owner nie
 * jest jedynym właścicielem z definicji — org przeżyje usunięcie takiego konta.
 */
export async function readAccountDeletionContext(
  supabase: SupabaseClient,
  ctx: AuthContext,
): Promise<AccountDeletionContext> {
  const email = ctx.user.email;
  const tenantId = ctx.tenantId;
  const isOwner = ctx.role === "owner";

  if (!tenantId || !isOwner) {
    return { email, tenantId, isOwner, ownerCount: 0, isSoleOwner: false };
  }

  const { data } = await supabase
    .from("members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("role", "owner");

  const ownerCount = Array.isArray(data) ? data.length : 0;
  // `<= 1` łapie też `ownerCount === 0` (nieudany odczyt) — blokada fail-safe.
  const isSoleOwner = ownerCount <= 1;

  return { email, tenantId, isOwner, ownerCount, isSoleOwner };
}
