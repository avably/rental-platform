/**
 * Gotowość sekcji ekranu ustawień dostaw (U9, audyt UX 6.1).
 *
 * ================== DLACZEGO TU NIE MA WŁASNEJ OCENY ==================
 *
 * Pytanie „czy kurier jest skonfigurowany" ma w tym repo JEDNĄ odpowiedź:
 * `courierConfigFromSettings` z `@avably/core` — ta sama, którą dostaje
 * nadanie przesyłki i sekcja dostawy zamówienia. Ta warstwa jej NIE POWTARZA,
 * tylko rozdziela już policzone braki na sekcje ekranu, dokładnie tak samo jak
 * robi to `courierConfigItems` dla listy „uzupełnij w ustawieniach dostaw".
 *
 * Druga, niezależna ocena kompletności to pułapka zamknięta przy ADR-140:
 * kafel pulpitu i ekran docelowy mówiły wtedy dwie różne rzeczy o tym samym
 * stanie, a operator nie miał jak zgadnąć, która jest prawdziwa. Chip „gotowe"
 * przy karcie i lista braków przy zamówieniu MUSZĄ wynikać z jednego rachunku.
 *
 * ================== DLACZEGO CENNIK IDZIE OSOBNO ==================
 *
 * `courierConfigFromSettings` opisuje NADANIE przesyłki i cennika nie zna —
 * cennik jest kontraktem ze sklepem, nie z przewoźnikiem. Ma więc własne
 * źródło prawdy (`deliveryPricingFromSettings`), też z `@avably/core`, też
 * jedyne w repo. Sekcja jest „gotowa", gdy da się z niej wycenić choć jedną
 * metodę: pusty cennik nie jest błędem zapisu, ale jest stanem, w którym
 * sklep nie policzy dostawy — i chip ma o tym mówić wprost.
 */
import {
  CourierConfigError,
  courierConfigFromSettings,
  deliveryPricingFromSettings,
} from "@avably/core";

import { courierConfigItems } from "@/app/[locale]/(panel)/zamowienia/[id]/courier-config-copy";

/** Wartości osi `delivery-section` — patrz `lib/secondary-status.tsx`. */
export type DeliverySectionState = "complete" | "incomplete";

export interface DeliverySectionStates {
  credentials: DeliverySectionState;
  sender: DeliverySectionState;
  parcel: DeliverySectionState;
  pricing: DeliverySectionState;
}

/**
 * Znacznik „hasło jest zapisane" — ten sam zabieg co w sekcji dostawy
 * zamówienia (`zamowienia/[id]/delivery.ts`): parser potrzebuje wiedzieć, CZY
 * sekret istnieje, nie jaki jest. Ekran ustawień nie odszyfrowuje niczego.
 */
const SECRET_PRESENT_MARKER = "(zapisane)";

const state = (incomplete: boolean): DeliverySectionState =>
  incomplete ? "incomplete" : "complete";

/**
 * Wiersze `tenant_settings` + informacja o obecności sekretu → stan czterech
 * sekcji ekranu. Brak konfiguracji jest stanem obsługiwanym, nie wyjątkiem:
 * ekran ustawień jest dokładnie tym miejscem, w którym braki są normą.
 */
export function deliverySectionStates(
  rows: { key: string; value: unknown }[],
  passwordSet: boolean,
): DeliverySectionStates {
  let missing: ReturnType<typeof courierConfigItems> = [];
  try {
    courierConfigFromSettings(rows, passwordSet ? SECRET_PRESENT_MARKER : null);
  } catch (err) {
    // Wyjątek spoza silnika konfiguracji nie jest „brakiem konfiguracji"
    // i nie wolno go zamiatać do chipa „niekompletne".
    if (!(err instanceof CourierConfigError)) throw err;
    missing = courierConfigItems(err.problems);
  }

  let pricingReady: boolean;
  try {
    const pricing = deliveryPricingFromSettings(rows);
    pricingReady = pricing !== null && Object.keys(pricing).length > 0;
  } catch {
    // Wadliwy wpis w bazie: formularz i tak startuje pusty (page.tsx), więc
    // sekcja jest niekompletna — a nie „gotowa, tylko nie da się odczytać".
    pricingReady = false;
  }

  return {
    credentials: state(missing.includes("integrationAccount")),
    sender: state(missing.includes("sender")),
    parcel: state(missing.includes("parcel")),
    pricing: state(!pricingReady),
  };
}
