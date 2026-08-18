/**
 * Stan zaproszenia ZAPRASZANEGO — czytany z bazy, nie zgadywany z błędu
 * (ADR-196, migracja 0087).
 *
 * PostgREST zjada klasę P0xxx odmów `app.accept_invitation` do gołego 500
 * bez kodu i treści (ADR-193 D6), więc panel nie miał JAK rozróżnić „wygasło"
 * od „wystawione na inny adres" — a to dwie różne instrukcje dla człowieka.
 * `app.invitation_state(p_token)` (SECURITY DEFINER, token = uprawnienie)
 * oddaje etykietę z ZAMKNIĘTEGO zbioru sześciu stanów i NIC ponad nią
 * (zero adresów, nazw i identyfikatorów — ADR-181). Kolejność rozstrzygania
 * stanów żyje w BAZIE (0087 lustrzane wobec 0051) — ten moduł wyłącznie
 * parsuje etykietę i wskazuje klucz słownika.
 *
 * Uwaga: to jest stan dla POSIADACZA TOKENU (zapraszanego). Statusem listy
 * zaproszeń po stronie OWNERA zajmuje się lib/invitations.ts — tam stan
 * liczy się z wiersza odczytanego przez RLS członka, tu z tokenu przez RPC.
 *
 * FAIL-CLOSED: etykieta spoza zbioru albo błąd odczytu → `null`, a wołający
 * pokazuje dzisiejszy ogólny komunikat `invitationAccept.denied` (akcja)
 * albo formularz (ekran — bramką wejścia i tak pozostaje accept_invitation).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Zamknięty zbiór etykiet funkcji `app.invitation_state` (0087). */
export const INVITATION_STATES = [
  "open",
  "not_found",
  "used",
  "revoked",
  "expired",
  "email_mismatch",
] as const;

export type InvitationState = (typeof INVITATION_STATES)[number];

/**
 * Klucz komunikatu per stan (przestrzeń `invitationAccept`, PL/EN).
 * `stateOpen` jest komunikatem PO NIEUDANYM akcepcie: stan „otwarte" przy
 * odmowie oznacza usterkę przejściową (np. 5xx samego akceptu), nie stan
 * zaproszenia — komunikat mówi „spróbuj ponownie", a nie zgaduje powodu.
 */
export const INVITATION_STATE_MESSAGE_KEY = {
  open: "stateOpen",
  not_found: "stateNotFound",
  used: "stateUsed",
  revoked: "stateRevoked",
  expired: "stateExpired",
  email_mismatch: "stateEmailMismatch",
} as const satisfies Record<InvitationState, string>;

/** Etykieta z RPC → stan z zamkniętego zbioru; wszystko inne → null. */
export function parseInvitationState(value: unknown): InvitationState | null {
  return typeof value === "string" && (INVITATION_STATES as readonly string[]).includes(value)
    ? (value as InvitationState)
    : null;
}

/**
 * Odczyt stanu zaproszenia sesją zapraszanego (klient z cookies żądania —
 * RPC wykonuje się rolą authenticated; zero service_role, kwarantanna
 * ADR-099 nietknięta). Błąd odczytu NIE wyrzuca — oddaje null (fail-closed
 * po stronie wołającego).
 */
export async function readInvitationState(
  supabase: SupabaseClient,
  token: string,
): Promise<InvitationState | null> {
  try {
    const { data, error } = await supabase
      .schema("app")
      .rpc("invitation_state", { p_token: token });
    if (error) return null;
    return parseInvitationState(data);
  } catch {
    return null;
  }
}
