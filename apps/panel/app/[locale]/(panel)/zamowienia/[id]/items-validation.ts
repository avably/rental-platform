/**
 * Schematy i arytmetyka EDYCJI POZYCJI zamówienia (uwagi przeglądu D6/N4).
 *
 * Wzorzec katalogu: walidacja Zod PRZED Supabase, kwoty przez
 * `parseMajorToGrosze` (jedyna konwersja złote→grosze w panelu, lib/money-input.ts),
 * bramką pozostaje baza — trigger `order_items_assignment_gate` z 0010.
 *
 * ================= PRZY JAKICH STATUSACH WOLNO EDYTOWAĆ =================
 *
 * `pending`, `reserved`, `ready_for_pickup` — i ani jednego więcej. To NIE
 * jest ta sama lista co `AVAILABILITY_BLOCKING_ORDER_STATUSES`, i różnica
 * jest w obie strony celowa:
 *
 *  - `picked_up` JEST statusem blokującym (baza sprawdziłaby tam dostępność
 *    normalnie), a mimo to edycji nie wpuszczamy. Powód jest operacyjny, nie
 *    techniczny: sprzęt jest fizycznie u klienta, kaucja zwykle pobrana,
 *    a umowa wydana z listą pozycji. Dołożenie pozycji do wydanego zamówienia
 *    zapisałoby najem sprzętu, którego nikt nie wydał — rozjazd zapisu ze
 *    stanem magazynu, którego potem nie da się odróżnić od kradzieży.
 *    Operacyjna ścieżka na doposażenie w trakcie to osobne zamówienie.
 *
 *  - `returned` i `cancelled` bramka 0010 PRZEPUSZCZA bez sprawdzenia
 *    dostępności (`if v_status not in (...) then return new`), bo pozycja
 *    zamówienia niewiążącego nie blokuje egzemplarza. Gdyby UI wpuszczało
 *    tam edycję, przypisanie egzemplarza zajętego w tym samym terminie przez
 *    ŻYWE zamówienie przeszłoby bez jednego sprawdzenia — cicha furtka wokół
 *    ADR-024. To zakaz twardy, nie preferencja: jedyne miejsce, w którym
 *    zapora musi stać po stronie aplikacji, bo baza świadomie milczy
 *    (dokładnie ta sama asymetria co przy terminach w ADR-028).
 *
 * Zakaz jest EGZEKWOWANY w akcjach (filtr `.in("order_status", …)` na
 * odczycie zamówienia + jawna odmowa), a nie tylko chowany w UI.
 */
import { z } from "zod";

import { parseMajorToGrosze } from "@/lib/money-input";
import { uuidSchema } from "@/lib/order-validation";

/**
 * Statusy, w których pozycje wolno edytować. Uzasadnienie — nagłówek pliku.
 * Lista jest WĘŻSZA niż `AVAILABILITY_BLOCKING_ORDER_STATUSES` z @avably/core
 * i celowo nie importuje z niej: to inna decyzja, o innym kryterium.
 */
export const ITEM_EDIT_ORDER_STATUSES = ["pending", "reserved", "ready_for_pickup"] as const;

export type ItemEditOrderStatus = (typeof ITEM_EDIT_ORDER_STATUSES)[number];

export function canEditOrderItems(status: string): boolean {
  return (ITEM_EDIT_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Kwota pozycji z pola formularza → grosze. Zero JEST dopuszczalne (gratis,
 * pozycja bez kaucji), ujemne nie — lustro CHECK-ów `rental_grosze >= 0`
 * i `deposit_grosze >= 0` z 0007. Odrzucenie zamiast zaokrąglenia: trzecie
 * miejsce po przecinku to inna kwota, niż wpisał operator (money-input.ts).
 */
const itemAmountSchema = z.string().transform((raw, ctx) => {
  const grosze = parseMajorToGrosze(raw);
  if (grosze === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Podaj kwotę w złotych, maksymalnie z dwoma miejscami (np. 100 lub 100,50).",
    });
    return z.NEVER;
  }
  return grosze;
});

/**
 * Egzemplarz opcjonalny: pusty string z `<select>` znaczy „bez przypisania"
 * (`unit_id = NULL`) i jest PEŁNOPRAWNYM wyborem, a nie brakiem danych —
 * pozycja bez wolnego egzemplarza w terminie wchodzi właśnie tak (N4).
 */
const optionalUnitSchema = z
  .string()
  .transform((raw) => raw.trim())
  .transform((raw, ctx): string | null => {
    if (raw === "") return null;
    if (!uuidSchema.safeParse(raw).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nieprawidłowy egzemplarz." });
      return z.NEVER;
    }
    return raw;
  });

export const addOrderItemSchema = z.object({
  orderId: uuidSchema,
  productId: uuidSchema,
});

export const updateOrderItemSchema = z
  .object({
    orderId: uuidSchema,
    itemId: uuidSchema,
    unitId: optionalUnitSchema,
    rental: itemAmountSchema,
    deposit: itemAmountSchema,
  })
  .transform((form) => ({
    orderId: form.orderId,
    itemId: form.itemId,
    unitId: form.unitId,
    rentalGrosze: form.rental,
    depositGrosze: form.deposit,
  }));

export const removeOrderItemSchema = z.object({
  orderId: uuidSchema,
  itemId: uuidSchema,
});

/** Pozycja sprowadzona do dwóch liczb — tyle wchodzi do sum zamówienia. */
export interface ItemAmounts {
  rentalGrosze: number;
  depositGrosze: number;
}

export interface OrderTotals {
  totalRentalGrosze: number;
  totalDepositGrosze: number;
}

/**
 * Sumy zamówienia = suma pozycji, liczona OD ZERA z aktualnego stanu tabeli.
 *
 * Nie inkrementalnie („stary total + delta") i to jest tu istotą: sumy są
 * WARTOŚCIĄ POCHODNĄ, więc każde przeliczenie jest samo w sobie naprawą.
 * Inkrement utrwaliłby każdy pominięty krok na zawsze, a przy trzech ścieżkach
 * mutacji (dodanie, edycja, usunięcie) i braku transakcji przez PostgREST
 * pominięty krok jest kwestią czasu, nie hipotezą.
 *
 * Grosze na wejściu, grosze na wyjściu — całkowite. Ułamek w sumie oznacza
 * wiersz spoza kontraktu bazy (`int`), więc jest błędem, a nie liczbą do
 * zaokrąglenia.
 */
export function sumOrderItemTotals(items: readonly ItemAmounts[]): OrderTotals {
  let totalRentalGrosze = 0;
  let totalDepositGrosze = 0;

  for (const item of items) {
    if (!Number.isSafeInteger(item.rentalGrosze) || !Number.isSafeInteger(item.depositGrosze)) {
      throw new RangeError(
        `Kwoty pozycji muszą być całkowitą liczbą groszy (otrzymano ${item.rentalGrosze}/${item.depositGrosze}).`,
      );
    }
    totalRentalGrosze += item.rentalGrosze;
    totalDepositGrosze += item.depositGrosze;
  }

  return { totalRentalGrosze, totalDepositGrosze };
}
