/**
 * KONTRAKT publicznego API v1 (M1, ADR-108) — odpowiedzi i jednolity kształt
 * błędu dla /api/v1/**. Konsument: serwer najemcy (wtyczka WordPress — M2),
 * nie przeglądarka.
 *
 * ZASADY KONTRAKTU (spisane w ADR-108):
 *   * wersja w ścieżce (/api/v1/) — zmiana łamiąca = /api/v2, nie mutacja v1,
 *   * dane odczytów idą 1:1 z RPC publicznych (snake_case, kształty
 *     PublicCatalog/PublicAvailability z lib/checkout/contract.ts) — zero
 *     przepisywania pól, więc zero drugiego miejsca do zmiany,
 *   * odpowiedź rezerwacji = to, co dostaje storefront (CheckoutOrderSummary),
 *     BEZ pól diagnostycznych dostawców i BEZ emailIssues (maszynowy
 *     konsument nie ma czego z nimi zrobić, a każdy dodatkowy string to
 *     powierzchnia wycieku),
 *   * błąd ZAWSZE w kształcie { error: { code, fields? } } — kod maszynowy
 *     z zamkniętego zbioru; treść ludzka nie występuje (klient i tak by jej
 *     nie tłumaczył, a komunikaty bywają echem żądania).
 */
import type { CheckoutFieldErrors, CheckoutOrderSummary } from "@/lib/checkout/contract";

/** Zamknięty zbiór kodów błędów v1 — kontrakt, nie enum wewnętrzny. */
export type ApiV1ErrorCode =
  /** Brak/zły/odwołany klucz — NIEROZRÓŻNIALNIE (zakaz enumeracji). */
  | "unauthorized"
  /** Klucz poprawny, ale sklep najemcy nie przyjmuje ruchu (status tenanta). */
  | "store_unavailable"
  | "rate_limited"
  /** Wejście nie przeszło walidacji (fields: mapa pole→typ błędu). */
  | "validation_failed"
  /** Żądany zasób nie istnieje albo jest nieosiągalny — bez rozróżnienia. */
  | "not_found"
  /** Egzemplarz zajęty (wyścig o dostępność) — odśwież availability i ponów. */
  | "conflict"
  /** Serwer odrzucił rezerwację jako niespójną (odpowiednik 22023). */
  | "rejected"
  /** Wybrano płatność online, a sklep nie może jej dziś przyjąć. */
  | "payment_unavailable"
  /**
   * Najemca nie opublikował wymaganych dokumentów prawnych (regulamin +
   * polityka prywatności) — sprzedaż wstrzymana (ADR-191). Naprawa leży
   * w panelu najemcy, nie w payloadzie wołającego.
   */
  | "legal_documents_missing"
  | "server_error";

export interface ApiV1ErrorBody {
  error: {
    code: ApiV1ErrorCode;
    /** Wyłącznie przy validation_failed — mapa pole→typ (kontrakt checkoutu). */
    fields?: CheckoutFieldErrors;
  };
}

/** Odpowiedź 201 rezerwacji: nawigacja + podsumowanie zamówienia klienta. */
export interface ApiV1ReservationResponse {
  status: "success";
  /** `confirmation` = koniec ścieżki; `payment` = zamówienie czeka na opłatę online. */
  nextStep: "confirmation" | "payment";
  order: CheckoutOrderSummary;
}

/** Jednolita odpowiedź błędu — jedyna droga budowania nie-2xx w /api/v1. */
export function apiV1Error(
  status: number,
  code: ApiV1ErrorCode,
  fields?: CheckoutFieldErrors,
): Response {
  const body: ApiV1ErrorBody = { error: fields ? { code, fields } : { code } };
  return Response.json(body, { status });
}
