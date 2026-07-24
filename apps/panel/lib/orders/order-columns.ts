/**
 * Wybór widocznych kolumn listy zamówień (uwaga przeglądu U5).
 *
 * BEZ MIGRACJI I BEZ BAZY — dokładnie z tego samego powodu, co zwinięcie
 * sidebara (`lib/shell/sidebar-collapse.ts`): która kolumna jest widoczna, to
 * stan interfejsu JEDNEGO urządzenia, a nie własność tenanta. Mieszka więc
 * w `localStorage`, pod jednym kluczem, i nie opuszcza przeglądarki.
 *
 * ZAPISUJEMY KOLUMNY UKRYTE, NIE WIDOCZNE. Różnica jest w zachowaniu przy
 * rozbudowie: gdy ekran dostanie kiedyś ósmą kolumnę, magazyn z listą
 * widocznych ukryłby ją wszystkim, którzy kiedykolwiek dotknęli menu (bo nie
 * ma jej na zapisanej liście). Lista ukrytych daje odwrotny, właściwy domyślny
 * stan: nowa kolumna jest widoczna, dopóki ktoś jej świadomie nie zdejmie.
 *
 * KOLUMNY STAŁE: „ID" i „Akcje" nie są przełączalne i celowo nie ma ich w tym
 * zbiorze. „ID" niesie kotwicę z etykietą i fokusem całego wiersza (naprawa
 * #117), a „Akcje" jest jedynym wejściem do menu wiersza — bez nich wiersz
 * traci nawigację, a nie tylko treść.
 *
 * Klucze kolumn są DOKŁADNIE tym, co niesie atrybut `data-cell` w tabeli:
 * jedno źródło prawdy dla renderu, menu i kontraktu #117.
 */

export const ORDER_COLUMN_KEYS = [
  "customer",
  "equipment",
  "date",
  "amount",
  "order-status",
  "payment-status",
] as const;

export type OrderColumnKey = (typeof ORDER_COLUMN_KEYS)[number];

/** Etykieta kolumny w menu = etykieta jej nagłówka (klucz `orders.list`). */
export const ORDER_COLUMN_LABEL_KEY: Record<OrderColumnKey, string> = {
  customer: "colCustomer",
  equipment: "colEquipment",
  date: "colTerm",
  amount: "colAmount",
  "order-status": "colOrderStatus",
  "payment-status": "colPaymentStatus",
};

export const ORDERS_COLUMNS_STORAGE_KEY = "avably-orders-columns";
export const ORDERS_COLUMNS_EVENT = "avably:orders-columns";

const KNOWN: ReadonlySet<string> = new Set(ORDER_COLUMN_KEYS);

/**
 * Surowa wartość magazynu → zbiór ukrytych kolumn.
 *
 * Wejście jest NIEZAUFANE (użytkownik może wpisać w `localStorage` cokolwiek,
 * a stara wersja aplikacji mogła zapisać kolumnę, której już nie ma): nieznane
 * klucze są milcząco pomijane, a nie wywracają ekranu. Brak wartości = nic
 * nieukryte, czyli dzisiejszy komplet kolumn jako domyślny zestaw.
 */
export function hiddenColumnsFrom(raw: string | null | undefined): ReadonlySet<OrderColumnKey> {
  if (raw == null || raw === "") return new Set();
  const keys = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part): part is OrderColumnKey => KNOWN.has(part));
  return new Set(keys);
}

/** Zbiór ukrytych kolumn → wartość magazynu (stała kolejność, więc stabilna). */
export function serializeHiddenColumns(hidden: ReadonlySet<OrderColumnKey>): string {
  return ORDER_COLUMN_KEYS.filter((key) => hidden.has(key)).join(",");
}

/** Nowy zbiór ukrytych po przełączeniu jednej kolumny (bez mutacji wejścia). */
export function withColumnVisible(
  hidden: ReadonlySet<OrderColumnKey>,
  key: OrderColumnKey,
  visible: boolean,
): ReadonlySet<OrderColumnKey> {
  const next = new Set(hidden);
  if (visible) next.delete(key);
  else next.add(key);
  return next;
}

/** Ile kolumn treściowych (bez stałej „ID") jest widocznych. */
export function visibleColumnCount(hidden: ReadonlySet<OrderColumnKey>): number {
  return ORDER_COLUMN_KEYS.filter((key) => !hidden.has(key)).length;
}
