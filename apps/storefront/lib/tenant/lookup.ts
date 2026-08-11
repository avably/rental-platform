/**
 * Odczyt slug→tenant_id z bazy przez app.resolve_tenant_by_slug (Zadanie 2.1,
 * migracja 0017, ADR-039). Wołane z middleware'u (runtime brzegowy), więc
 * PROSTY `fetch` do PostgREST zamiast klienta `@supabase/ssr` — ten drugi
 * ciągnie adapter cookies (sesja), którego rozwiązywanie anonimowe nie ma i
 * nie potrzebuje. Anon key + RPC to jedyne, czego trzeba.
 *
 * `Content-Profile: app` wskazuje PostgREST schemat `app` dla POST-a (schemat
 * wystawiony w config.toml od Zadania 6). Funkcja jest SECURITY DEFINER z
 * grantem execute dla anona — 0017 to jedyna ścieżka odczytu tenanta dla
 * publiczności.
 *
 * FAIL-CLOSED: każdy błąd (transport, nie-2xx, niespodziewany kształt) → null,
 * czyli wołający daje 404. Świadomie wybieramy „chwilowo niedostępny sklep"
 * ponad „serwujemy niewłaściwego/żadnego tenanta". Błędu nie odróżniamy od
 * braku wiersza — dla 2.1 to akceptowalne (cache negatywny ma krótki TTL, więc
 * przejściowa awaria bazy nie zamraża sklepu na długo).
 */
import {
  SUPABASE_PUBLISHABLE_KEY_ENV,
  readSupabasePublishableKey,
} from "@avably/core/supabase-env";

async function callResolveRpc(fn: string, body: Record<string, string>): Promise<string | null> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Warstwa ADR-142: nowa nazwa sb_publishable_… z fallbackiem legacy; ten
  // moduł biega w middleware'u, więc odczyt MUSI być statyczny (wmurowanie
  // build-time) — warstwa trzyma ten kontrakt u siebie.
  const anonKey = readSupabasePublishableKey();
  if (!baseUrl || !anonKey) {
    console.error(
      `[tenant] brak NEXT_PUBLIC_SUPABASE_URL/${SUPABASE_PUBLISHABLE_KEY_ENV} — nie mogę rozwiązać tenanta`,
    );
    return null;
  }

  try {
    const res = await fetch(`${baseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Profile": "app",
      },
      body: JSON.stringify(body),
      // Rozwiązanie jest cache'owane u nas (lib/tenant/cache.ts); nie chcemy
      // dodatkowej warstwy cache'u fetcha Next.js na wywołaniu RPC.
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`[tenant] ${fn} zwróciło ${res.status}`);
      return null;
    }

    // Funkcja zwraca skalar uuid: PostgREST oddaje go wprost (string) albo null.
    const data: unknown = await res.json();
    return typeof data === "string" && data.length > 0 ? data : null;
  } catch (error) {
    console.error(`[tenant] odczyt ${fn} nie powiódł się`, error);
    return null;
  }
}

export async function lookupTenantIdBySlug(slug: string): Promise<string | null> {
  return callResolveRpc("resolve_tenant_by_slug", { p_slug: slug });
}

/**
 * Odczyt host→tenant_id dla WŁASNEJ domeny najemcy (Zadanie 2.6, migracja 0022,
 * ADR-046). Ta sama ścieżka i te same własności co wyżej: funkcja 0022 jest
 * LUSTREM 0017 (SECURITY DEFINER, grant dla anona, zwraca sam uuid), a bramki
 * `verified = true` i statusu tenanta siedzą PO STRONIE BAZY — middleware nie ma
 * ich jak obejść ani osłabić. Fail-closed identycznie: każdy błąd → null, czyli
 * host wraca na gałąź marketingową, nigdy „serwujemy przypadkowego tenanta".
 */
export async function lookupTenantIdByDomain(host: string): Promise<string | null> {
  return callResolveRpc("resolve_tenant_by_domain", { p_host: host });
}
