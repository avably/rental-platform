/**
 * Które metody płatności widzi klient (Z3, ADR-066) — czysta funkcja, bez
 * sieci i bez Reacta, żeby regułę dało się przypiąć testem, a nie wypatrzeć
 * w JSX-ie.
 *
 * REGUŁA, KTÓREJ TEN PLIK PILNUJE: tor offline jest w wyniku ZAWSZE. Nie ma
 * wejścia — żadnej kombinacji flag, żadnego stanu konta, żadnej awarii — przy
 * którym `transfer`/`cod` z tej listy znikają. Płatność online jest DODATKIEM
 * do tej listy, nie jej zamiennikiem.
 *
 * DLACZEGO TO JEST ZAPISANE OSOBNO, a nie jako `if` w formularzu: „usuń tor
 * offline, gdy Stripe działa" to jednolinijkowa zmiana, która wygląda jak
 * uproszczenie („po co dwie drogi, skoro karta działa"), a kosztuje sprzedaż
 * każdemu klientowi bez karty i każdemu, kto woli przelew. Reguła w osobnym
 * pliku z własnym testem jest droższa do usunięcia niż warunek w komponencie.
 *
 * ROZDZIELNE PRZYCZYNY NIEDOSTĘPNOŚCI: brak konfiguracji platformy to NASZ
 * problem, a brak KYC najemcy to normalny stan młodego sklepu. Zwijanie ich
 * w jedno „niedostępne" kazałoby pokazać klientowi komunikat o awarii tam,
 * gdzie nic się nie zepsuło (sedno ADR-066).
 */
import {
  CHECKOUT_OFFLINE_PAYMENT_METHODS,
  type CheckoutPaymentMethod,
} from "./contract";

export interface OnlinePaymentAvailability {
  /** Platforma ma komplet kluczy dostawcy (liczone na serwerze, ADR-049). */
  stripeConfigured: boolean;
  /**
   * Konto najemcy PRZYJMUJE płatności — wartość Z ODCZYTU u dostawcy, nigdy
   * z kolumny `payment_accounts.charges_enabled` (to kopia prezentacyjna).
   */
  chargesEnabled: boolean;
}

/** Dlaczego toru online nie ma na liście. `null` = jest. */
export type OnlineUnavailableReason = "not_configured" | "account_not_ready";

export function onlinePaymentUnavailableReason(
  availability: OnlinePaymentAvailability,
): OnlineUnavailableReason | null {
  if (!availability.stripeConfigured) return "not_configured";
  if (!availability.chargesEnabled) return "account_not_ready";
  return null;
}

/**
 * Lista metod do pokazania klientowi. Kolejność jest częścią wyniku: online
 * na początku, gdy jest — to najkrótsza droga do rezerwacji — a offline
 * zaraz pod nim, zawsze widoczny, nigdy schowany pod „inne opcje".
 */
export function availablePaymentMethods(
  availability: OnlinePaymentAvailability,
): CheckoutPaymentMethod[] {
  const offline = [...CHECKOUT_OFFLINE_PAYMENT_METHODS];
  if (onlinePaymentUnavailableReason(availability) !== null) return offline;
  return ["online", ...offline];
}

/**
 * Metoda zaznaczona przy wejściu na formularz. Online, gdy jest — klient,
 * który chce zapłacić od razu, nie musi nic klikać; reszta ma wybór o jedno
 * kliknięcie dalej i nikt nie zostaje bez drogi.
 */
export function defaultPaymentMethod(
  availability: OnlinePaymentAvailability,
): CheckoutPaymentMethod {
  return availablePaymentMethods(availability)[0] ?? "transfer";
}

/**
 * Czy wybór klienta jest w ogóle dopuszczalny w tym sklepie. Bramka
 * SERWEROWA: wejście Server Action pochodzi od klienta i nic nie gwarantuje,
 * że przeszło przez nasz formularz — a `paymentMethod: "online"` wysłane
 * ręcznie do sklepu bez konta próbowałoby założyć zamówienie w reżimie
 * ścisłym bez płatności, która ma je z niego wyprowadzić.
 */
export function isPaymentMethodAllowed(
  method: CheckoutPaymentMethod,
  availability: OnlinePaymentAvailability,
): boolean {
  return availablePaymentMethods(availability).includes(method);
}
