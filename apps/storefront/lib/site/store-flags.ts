/**
 * FLAGI POWŁOKI SKLEPU (ADR-203, migracja 0090) — przełączniki ZACHOWANIA
 * powłoki najemcy, na start: globalna pigułka terminu w pasku (ADR-194,
 * faza B — „wyłączalność pigułki przez najemcę").
 *
 * ==================== DLACZEGO OSOBNA FUNKCJA, NIE KATALOG ====================
 *
 * Koperty publicznych odczytów katalogu są parsowane `.strict()`, a migracje
 * jadą na produkcję PRZED kodem — nowy klucz w kopercie katalogu położyłby
 * sklep każdego najemcy na czas okna wdrożeniowego (lekcja 0074/0079/0083).
 * `app.get_public_store_flags` jest nową funkcją, której w oknie nikt nie
 * woła, więc migracja nie ma jak niczego zepsuć.
 *
 * ==================== FAIL-SOFT, NIE FAIL-CLOSED ====================
 *
 * Ta sama decyzja, co przy `getTenantAppearance` (ADR-171): flaga nie jest
 * bramką dostępu do niczego, a jej DOMYŚLNA wartość znaczy „zachowanie sprzed
 * 0090". Nieudany odczyt (transport, kształt) oddaje domyślne `true` —
 * chwilowy blip nie może gasić pigułki w sklepach wszystkich najemców.
 * Najemca poza oknem handlowym dostaje z bazy NULL, ale to nie ma znaczenia:
 * takiego najemcę gasi wcześniej fail-closed odczyt katalogu w tym samym
 * `Promise.all`.
 *
 * IZOLACJA. `app.get_public_store_flags` jest SECURITY DEFINER — bramką jest
 * jawne zawężenie `t.id = p_tenant_id` w ciele, a `tenantId` przychodzi
 * WYŁĄCZNIE z nagłówka wstrzykniętego przez proxy po rozwiązaniu hosta
 * (ADR-039). Pilnuje tego packages/db/test/store-term-flag.test.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export interface StoreFlags {
  /**
   * Globalna pigułka wyboru terminu w pasku powłoki (ADR-194). `false` =
   * najemca ją wyłączył: trasy podają `term={null}`, a klient wybiera termin
   * w widgecie strony sprzętu (`ProductBooking` — NIEZALEŻNY od tej flagi:
   * własne pole, własne okno, zapis do tego samego stanu koszyka).
   */
  termCalendarEnabled: boolean;
}

/**
 * Powłoka najemcy, o którym nic nie wiadomo: pigułka WIDOCZNA — dokładnie to,
 * co sklep robił przed 0090. Nieudany odczyt nie zmienia zachowania, tylko
 * go NIE ZMIENIA (bliźniak DEFAULT_TENANT_APPEARANCE).
 */
export const DEFAULT_STORE_FLAGS: StoreFlags = {
  termCalendarEnabled: true,
};

/**
 * Parsowanie koperty flag — wydzielone, bo mierzą je testy bez bazy.
 *
 * Fail-soft PO ZNANYCH KLUCZACH: klucz nieobecny albo w złym kształcie spada
 * na domyślną wartość, a klucz NIEZNANY jest ignorowany — następna flaga
 * powłoki dołoży klucz do tej samej koperty i stary kod jej nie zauważy,
 * zamiast się wywrócić (odwrotność `.strict()`, świadomie).
 */
export function parseStoreFlags(payload: unknown): StoreFlags {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return DEFAULT_STORE_FLAGS;
  }
  const raw = payload as Record<string, unknown>;
  return {
    termCalendarEnabled:
      typeof raw.term_calendar_enabled === "boolean"
        ? raw.term_calendar_enabled
        : DEFAULT_STORE_FLAGS.termCalendarEnabled,
  };
}

/** Flagi powłoki najemcy — `client` wstrzykiwalny dla testów, jak reszta warstwy. */
export async function getPublicStoreFlags(
  tenantId: string,
  client?: SupabaseClient,
): Promise<StoreFlags> {
  const supabase = client ?? (await createSupabaseServerClient());

  const { data, error } = await supabase
    .schema("app")
    .rpc("get_public_store_flags", { p_tenant_id: tenantId });

  if (error || data == null) return DEFAULT_STORE_FLAGS;

  return parseStoreFlags(data);
}
