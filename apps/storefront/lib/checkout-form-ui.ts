/**
 * Warstwa PREZENTACJI checkoutu (2.4b) — czyste odwzorowanie wyniku serwera
 * (CheckoutResult, kontrakt 2.4a) na stan widoku i klucz komunikatu. Wzorzec
 * przejęty po form-ui waitlisty (zdjętym razem z backendem w 0071): logika
 * „który komunikat i kiedy" jest tu, testowalna bez Reacta i bez sieci.
 *
 * ZASADA KWOT: stan `success` niesie `order` PROSTO Z SERWERA (CheckoutResult.
 * order). Ekran potwierdzenia liczy podsumowanie WYŁĄCZNIE z tego obiektu
 * (orderSummaryTotals) — podgląd lokalny (lib/catalog/preview.ts) nie ma wpływu
 * na to, co widzi klient po złożeniu. To jest bramka „kwota z odpowiedzi
 * serwera", nie własna arytmetyka (ADR-042).
 */
import type { CheckoutFieldErrors, CheckoutOrderSummary, CheckoutResult } from "@/lib/checkout/contract";

export type CheckoutViewState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | {
      kind: "success";
      order: CheckoutOrderSummary;
      emailIssues: string[];
      /**
       * Dokąd idzie klient po utrwaleniu zamówienia. `payment` znaczy
       * WYŁĄCZNIE „przejdź na krok płatności" — nigdy „zapłacono".
       */
      nextStep: "confirmation" | "payment";
    }
  | { kind: "validation"; fields: CheckoutFieldErrors }
  | { kind: "unavailable" }
  | { kind: "rejected" }
  | { kind: "rate_limited" }
  | { kind: "captcha_error" }
  | { kind: "connection_error" }
  /**
   * Klient wybrał płatność online, a serwer ODCZYTAŁ, że sklep nie może jej
   * dziś przyjąć. Zamówienie NIE powstało — formularz zostaje wypełniony,
   * a klient wybiera tor offline (ADR-066).
   */
  | { kind: "payment_unavailable" }
  /**
   * Najemca nie ma opublikowanych wymaganych dokumentów prawnych (ADR-191).
   * Zamówienie NIE powstało. Normalnie formularz jest zablokowany już na
   * renderze; ten stan łapie wyścig cofnięcia publikacji i żądania spoza UI.
   */
  | { kind: "legal_documents_missing" }
  /**
   * Najem krótszy niż minimalny okres najmu jednej z pozycji (0089, ADR-202).
   * Zamówienie NIE powstało; `minDays` z DETAIL odmowy — LP składa z niej
   * zdanie „minimum X dni". Formularz zostaje wypełniony: klient poprawia
   * TERMIN (w pasku terminu), nie dane.
   */
  | { kind: "min_rental_days"; minDays: number }
  | { kind: "server_error" };

/**
 * Klucz komunikatu błędu (LP mapuje na string w języku tenanta). `null` dla
 * stanów bez komunikatu-alertu (idle/submitting/success — sukces ma własny
 * ekran, walidacja podświetla pola).
 */
export type CheckoutMessageKey =
  | "unavailable"
  | "rejected"
  | "rate_limited"
  | "captcha"
  | "connection"
  | "payment_unavailable"
  | "legal_documents_missing"
  | "min_rental_days"
  | "server";

export function mapCheckoutResult(result: CheckoutResult): CheckoutViewState {
  switch (result.status) {
    case "success":
      return {
        kind: "success",
        order: result.order,
        emailIssues: result.emailIssues ?? [],
        nextStep: result.nextStep,
      };
    case "validation_error":
      return { kind: "validation", fields: result.fields };
    case "unavailable":
      return { kind: "unavailable" };
    case "rejected":
      return { kind: "rejected" };
    case "rate_limited":
      return { kind: "rate_limited" };
    case "captcha_failed":
      return { kind: "captcha_error" };
    case "payment_unavailable":
      return { kind: "payment_unavailable" };
    case "legal_documents_missing":
      return { kind: "legal_documents_missing" };
    case "min_rental_days":
      return { kind: "min_rental_days", minDays: result.minDays };
    case "server_error":
      return { kind: "server_error" };
  }
}

export function getCheckoutMessageKey(view: CheckoutViewState): CheckoutMessageKey | null {
  switch (view.kind) {
    case "unavailable":
      return "unavailable";
    case "rejected":
      return "rejected";
    case "rate_limited":
      return "rate_limited";
    case "captcha_error":
      return "captcha";
    case "connection_error":
      return "connection";
    case "payment_unavailable":
      return "payment_unavailable";
    case "legal_documents_missing":
      return "legal_documents_missing";
    case "min_rental_days":
      return "min_rental_days";
    case "server_error":
      return "server";
    case "idle":
    case "submitting":
    case "success":
    case "validation":
      return null;
  }
}

/**
 * Czy po tym wyniku token Turnstile jest zużyty i trzeba świeżego wyzwania.
 * Sukces i walidacja NIE zużywają tokena (walidacja pada przed captchą w
 * rdzeniu; sukces kończy formularz), reszta tak — jak w waitliście.
 */
export function shouldResetCaptcha(view: CheckoutViewState): boolean {
  return (
    view.kind !== "idle" &&
    view.kind !== "submitting" &&
    view.kind !== "success" &&
    view.kind !== "validation"
  );
}

export interface OrderSummaryTotals {
  rentalGrosze: number;
  depositGrosze: number;
  deliveryGrosze: number;
  /** Suma do zapłaty = najem + kaucja + dostawa. */
  totalGrosze: number;
}

/**
 * Podsumowanie kwot ekranu potwierdzenia — liczone WYŁĄCZNIE z obiektu order
 * zwróconego przez serwer. Żadna wartość nie pochodzi z podglądu lokalnego:
 * podmiana lokalnej wyceny nie ma prawa zmienić tego, co tu wyjdzie.
 */
export function orderSummaryTotals(order: CheckoutOrderSummary): OrderSummaryTotals {
  return {
    rentalGrosze: order.totalRentalGrosze,
    depositGrosze: order.totalDepositGrosze,
    deliveryGrosze: order.deliveryGrosze,
    totalGrosze: order.totalRentalGrosze + order.totalDepositGrosze + order.deliveryGrosze,
  };
}
