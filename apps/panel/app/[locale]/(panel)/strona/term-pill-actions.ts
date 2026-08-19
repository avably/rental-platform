"use server";

/**
 * Server action FLAGI PIGUŁKI TERMINU (ADR-203, migracja 0090).
 *
 * Jeden czasownik: zapisz. Flaga świadomie NIE MA pary szkic/publikacja —
 * to przełącznik ZACHOWANIA powłoki (jak ustawienia dostaw), nie treść,
 * więc działa od zapisania.
 *
 * KTO PILNUJE CZEGO. Ten plik nie jest bramką bezpieczeństwa i nie udaje nią
 * być: tenanta wybiera baza (`app.tenant_id()` w `app.set_store_term_calendar`
 * — zapis cudzemu najemcy jest NIEWYRAŻALNY), żywego członkostwa pilnuje ta
 * sama funkcja (kanon ADR-126), a `requireMember` odsiewa tu jedynie brak
 * sesji, zanim w ogóle polecimy do bazy. Tu zostaje tłumaczenie odmowy na
 * zdanie dla operatora.
 *
 * UWAGA: plik "use server" — WSZYSTKIE eksporty muszą być async funkcjami.
 * Eksport innego kształtu wywraca cały moduł („no exports at all"), a łapie
 * to dopiero `next build`.
 */
import { getTranslations } from "next-intl/server";

import { requireMember } from "@/lib/supabase-server";

export type StoreTermPillActionResult = { ok: true } | { ok: false; error: string };

export async function saveStoreTermCalendarAction(
  enabled: boolean,
): Promise<StoreTermPillActionResult> {
  const t = await getTranslations("site.termPill");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("error") };
  }

  // `Boolean(...)` na granicy serializacji: action przyjmuje z sieci dowolny
  // JSON, a baza i tak odmówi NULL-owi — tu domykamy kształt, żeby odmowa
  // była dla operatora zdaniem, nie kodem 22023.
  const { error } = await ctx.supabase
    .schema("app")
    .rpc("set_store_term_calendar", { p_enabled: Boolean(enabled) });

  if (error) return { ok: false, error: t("error") };
  return { ok: true };
}
