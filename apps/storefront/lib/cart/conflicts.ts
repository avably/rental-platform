/**
 * KONFLIKT TERMINU Z KOSZYKIEM (faza 5, ADR-179) — CZYSTY rdzeń.
 *
 * ==================== PROBLEM ====================
 *
 * Termin jest WSPÓLNY dla całego zamówienia (`CartState.startDate/endDate`),
 * a klient może go zmienić po dołożeniu sprzętu do koszyka. Nowy termin bywa
 * węższy w dostępność niż stary: sprzęt, który był wolny w lipcu, w sierpniu
 * może być wynajęty.
 *
 * ==================== ROZSTRZYGNIĘCIE (R4) ====================
 *
 * POKAZUJEMY, NIE USUWAMY. Ciche wyrzucenie pozycji z koszyka jest odebraniem
 * klientowi wyboru, którego dokonał, bez pytania go o zdanie — a przy okazji
 * jedynym śladem po tej decyzji byłaby zmieniona suma. Klient dostaje LISTĘ
 * pozycji w konflikcie i sam rozstrzyga: zdjąć sprzęt albo wrócić do terminu.
 *
 * PRZEJŚCIE DO KASY JEST ZABLOKOWANE, dopóki konflikt trwa. Nie dlatego, że
 * serwer by się nie obronił — obroni się (bramka przypisania egzemplarza pod
 * advisory lockiem w `app.public_checkout`) — tylko dlatego, że wpuszczenie
 * klienta w formularz kasy po to, żeby ostatni krok padł, jest kosztem
 * przerzuconym na klienta za wiedzę, którą mamy WCZEŚNIEJ.
 *
 * ==================== DLACZEGO TO JEST CZYSTA FUNKCJA ====================
 *
 * Rdzeń dostaje pozycje i ODPOWIEDŹ o dostępności, a nie klienta bazy. Dzięki
 * temu reguła „co jest konfliktem" daje się sprawdzić bez sieci i bez
 * przeglądarki, a warstwa transportu (jedna akcja serwera dla całego katalogu)
 * nie ma jak jej po cichu zmienić.
 */
import type { PublicCatalogAvailability } from "@/lib/checkout/contract";

import type { CartLine, CartState } from "./model";
import { normalizeCart } from "./model";

export interface CartConflict {
  productId: string;
  /** Ile sztuk klient ma w koszyku. */
  requested: number;
  /**
   * Ile sztuk jest wolnych w NOWYM terminie. `0` znaczy „nic nie zostało";
   * liczba dodatnia mniejsza od `requested` znaczy „zostało mniej, niż chcesz".
   */
  available: number;
}

/**
 * Wynik rozstrzygania konfliktu. `unknown` to STAN TRZECI, nie brak konfliktu:
 * gdy dostępności nie udało się odczytać (brak sieci, najemca poza oknem
 * handlowym, zakres odwrócony), nie wiemy nic — i nie wolno nam wtedy ani
 * pokazać konfliktu, którego może nie być, ani zapewnić, że go nie ma.
 */
export interface CartConflictVerdict {
  conflicts: CartConflict[];
  unknown: boolean;
}

export const NO_CONFLICTS: CartConflictVerdict = { conflicts: [], unknown: false };

/**
 * Które pozycje koszyka nie mieszczą się w dostępności podanego terminu.
 *
 * Pozycja NIEOBECNA w odpowiedzi katalogu jest konfliktem z zerem wolnych
 * sztuk, a nie pozycją pominiętą: sprzęt zdjęty z oferty (albo wygaszony przez
 * najemcę) zniknie z odpowiedzi, a klient wciąż ma go w koszyku. Potraktowanie
 * takiej pozycji jako „brak informacji, przepuszczamy" byłoby dokładnie tą
 * ścieżką, którą zamówienie wchodzi na serwer po to, żeby tam paść.
 */
export function cartConflicts(
  items: readonly CartLine[],
  availability: PublicCatalogAvailability | null,
): CartConflictVerdict {
  if (availability === null) return { conflicts: [], unknown: true };

  const byProduct = new Map(
    availability.products.map((row) => [row.product_id, row.available_units]),
  );

  const conflicts: CartConflict[] = [];
  for (const line of items) {
    const available = byProduct.get(line.productId) ?? 0;
    if (available < line.quantity) {
      conflicts.push({ productId: line.productId, requested: line.quantity, available });
    }
  }

  return { conflicts, unknown: false };
}

/**
 * Czy koszyk wolno puścić do kasy — pełna bramka po stronie klienta.
 *
 * Warunek `unknown` jest tu ŚWIADOMIE PRZEPUSZCZAJĄCY, odwrotnie niż w wielu
 * innych bramkach tego repo. Powód: to nie jest bramka bezpieczeństwa, tylko
 * uprzejmość wobec klienta. Blokowanie kasy przy chwilowym błędzie odczytu
 * dostępności odbierałoby sprzedaż najemcy za awarię, która może nie mieć
 * z jego sprzętem nic wspólnego — a WIĄŻĄCA bramka i tak stoi na serwerze
 * i nie zależy od tego, czy ten odczyt się udał.
 */
export function isCheckoutBlockedByConflict(verdict: CartConflictVerdict): boolean {
  return verdict.conflicts.length > 0;
}

/**
 * Koszyk po zdjęciu WSZYSTKICH pozycji w konflikcie. Nie wołamy tego sami —
 * to jest gotowa operacja dla przycisku, który klient klika ŚWIADOMIE.
 */
export function removeConflictingLines(
  state: CartState,
  verdict: CartConflictVerdict,
): CartState {
  const base = normalizeCart(state);
  const blocked = new Set(verdict.conflicts.map((conflict) => conflict.productId));
  return { ...base, items: base.items.filter((line) => !blocked.has(line.productId)) };
}
