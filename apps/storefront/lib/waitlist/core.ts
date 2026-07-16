/**
 * Rdzeń akcji waitlisty — bez `next/headers` i bez tworzenia klienta
 * Supabase, więc testowalny wprost (wzorzec: apps/panel/lib/auth.ts, gdzie
 * rdzeń przyjmuje klienta zamiast go budować).
 *
 * Owijka „use server" mieszka w lib/actions/waitlist.ts i dostarcza tu IP,
 * stan kill-switcha i wywołanie RPC.
 */
import { waitlistSchema, toFieldErrors } from "./validation";
import type { WaitlistResult } from "./contract";

/** Wynik RPC app.join_waitlist — zamknięty zbiór, patrz migracja 0006. */
export type WaitlistRpcOutcome = "success" | "duplicate";

export interface WaitlistRpcArgs {
  p_email: string;
  p_rental_type: string;
  p_inventory_range: string;
  p_current_process: string;
  p_consent: boolean;
  p_other_equipment: string | null;
  p_pilot_interest: boolean;
  p_phone: string | null;
  p_locale: string;
  p_source: string | null;
  p_campaign: string | null;
}

export interface WaitlistDeps {
  /** Kill-switch — patrz isWaitlistEnabled(). */
  enabled: boolean;
  /** Klucz rate-limitu (IP żądania). */
  ip: string;
  checkRateLimit: (
    key: string,
    opts: { limit: number; windowSeconds: number },
  ) => Promise<{ success: boolean }>;
  /** Wywołanie app.join_waitlist. Rzuca przy błędzie — mapujemy na server_error. */
  callRpc: (args: WaitlistRpcArgs) => Promise<WaitlistRpcOutcome>;
}

/**
 * Limit celowo ciasny: waitlista to jedno zdarzenie na człowieka, nie
 * przepływ. 5/godzinę per IP zostawia zapas na współdzielone NAT-y i pomyłki,
 * a odcina masowy zapis skryptem.
 */
export const WAITLIST_RATE_LIMIT = { limit: 5, windowSeconds: 3600 } as const;

/**
 * KILL-SWITCH. Domyślnie WYŁĄCZONY — brak zmiennej = brak zapisów.
 *
 * To jest bramka PRAWNA, nie przełącznik wygody: formularz nie może przyjąć
 * żadnego realnego zapisu, dopóki nie istnieje polityka prywatności (zbieramy
 * e-mail i telefon — dane osobowe — na podstawie zgody, która musi się do
 * czegoś odnosić). Domyślność „wyłączone" znaczy, że zapomnienie o
 * konfiguracji kończy się brakiem zapisów, a nie zbieraniem danych bez
 * podstawy.
 *
 * Porównanie do dokładnie "true": każda inna wartość ("1", "yes", literówka)
 * zostawia formularz wyłączony. Włączenie ma być świadome.
 */
export function isWaitlistEnabled(
  // Celowo wąski typ zamiast NodeJS.ProcessEnv: funkcja czyta jedną zmienną,
  // a ProcessEnv wymaga NODE_ENV, przez co każdy test musiałby podawać pole
  // niezwiązane z kill-switchem.
  env: { WAITLIST_ENABLED?: string | undefined } = process.env as {
    WAITLIST_ENABLED?: string | undefined;
  },
): boolean {
  return env.WAITLIST_ENABLED === "true";
}

export async function joinWaitlistCore(
  input: unknown,
  deps: WaitlistDeps,
): Promise<WaitlistResult> {
  // Kill-switch PRZED walidacją i przed rate-limitem: skoro żaden zapis nie
  // może zostać przyjęty, nie ma powodu, żeby dane osobowe w ogóle weszły
  // głębiej w proces.
  if (!deps.enabled) return { status: "disabled" };

  // Rate-limit PRZED walidacją (panel robi odwrotnie przy auth): tam wejściem
  // są dwa pola, tu — jedenaście, w tym pola tekstowe do 500 znaków od
  // anonima bez CAPTCHA. Limit jest tańszą bramką niż parser i chroni
  // wszystko za sobą, łącznie z nim.
  const limit = await deps.checkRateLimit(`waitlist:ip:${deps.ip}`, WAITLIST_RATE_LIMIT);
  if (!limit.success) return { status: "rate_limited" };

  const parsed = waitlistSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "validation_error", fields: toFieldErrors(parsed.error) };
  }

  const data = parsed.data;

  // PUNKT WPIĘCIA Turnstile: tutaj, po walidacji a przed zapisem, trafi
  // weryfikacja tokenu (data.captchaToken) — odpowiednik
  // apps/panel/lib/turnstile.ts. Świadomie niepodpięte: wymaga konta
  // Cloudflare, którego infra jeszcze nie ma. Warunek przed publicznym
  // launchem — patrz dokumentacja modułu.

  try {
    const outcome = await deps.callRpc({
      p_email: data.email,
      p_rental_type: data.rentalType,
      p_inventory_range: data.inventoryRange,
      p_current_process: data.currentProcess,
      p_consent: data.consent,
      p_other_equipment: data.otherEquipment ?? null,
      p_pilot_interest: data.pilotInterest,
      p_phone: data.phone ?? null,
      p_locale: data.locale,
      p_source: data.source ?? null,
      p_campaign: data.campaign ?? null,
    });
    return outcome === "duplicate" ? { status: "duplicate" } : { status: "success" };
  } catch (error) {
    // Szczegóły zostają w logu serwera; do klienta idzie sam status. Treść
    // błędu bazy potrafi zawierać wartości pól (czyli dane osobowe) i nie ma
    // prawa opuścić serwera.
    console.error("[waitlist] zapis nie powiódł się", error);
    return { status: "server_error" };
  }
}
