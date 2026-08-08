/**
 * Braki konfiguracji kuriera → język najemcy (U1, audyt UX W3).
 *
 * CourierConfigError niesie listę problemów nazwaną kluczami ustawień
 * („brak ustawienia courier_sender”) — dla silnika to precyzja, dla
 * operatora wypożyczalni szum, a dla napastnika mapa modelu danych.
 * Ta warstwa tłumaczy problemy na WIADRA rzeczy do uzupełnienia, nazwane
 * tak, jak nazywa je ekran ustawień dostaw, na który prowadzi link.
 *
 * Funkcje czyste i osobne od widoku — klasyfikacja jest testowalna bez
 * renderowania panelu, a korzysta z niej i sekcja dostawy (klucze słownika
 * PL/EN), i akcje serwerowe (zdanie PL do formError).
 *
 * Klasyfikacja PO KLUCZU zawartym w treści problemu, z importem stałych
 * z @avably/core: gdy klucz zmieni nazwę, mapowanie idzie za repo, nie za
 * pamięcią. Problem bez rozpoznanego klucza spada do wiadra „pozostałe” —
 * bramka tenant-copy-config-gate pilnuje, żeby nigdy nie wyszedł na ekran
 * w brzmieniu surowym.
 */
import {
  COURIER_PARCEL_KEY,
  COURIER_SENDER_KEY,
  GLOBKURIER_CREDENTIALS_KEY,
} from "@avably/core";

/** Wiadro = klucz słownika `orders.delivery.section.configItems.<wiadro>`. */
export type CourierConfigItem = "integrationAccount" | "sender" | "parcel" | "other";

const ITEM_ORDER: readonly CourierConfigItem[] = [
  "integrationAccount",
  "sender",
  "parcel",
  "other",
];

function classify(problem: string): CourierConfigItem {
  if (problem.includes(GLOBKURIER_CREDENTIALS_KEY)) return "integrationAccount";
  if (problem.includes(COURIER_SENDER_KEY)) return "sender";
  if (problem.includes(COURIER_PARCEL_KEY)) return "parcel";
  return "other";
}

/**
 * Lista braków do wyświetlenia: bez duplikatów (hasło i pola konta to jedno
 * wiadro), w stałej kolejności ekranu ustawień — nie w kolejności rzucania
 * problemów przez parser.
 */
export function courierConfigItems(problems: readonly string[]): CourierConfigItem[] {
  const present = new Set(problems.map(classify));
  return ITEM_ORDER.filter((item) => present.has(item));
}

/** Etykiety PL do komunikatów akcji serwerowych (wzorzec: akcje mówią po polsku). */
const ITEM_LABEL_PL: Record<CourierConfigItem, string> = {
  integrationAccount: "konto integracji kuriera",
  sender: "dane nadawcy przesyłki",
  parcel: "domyślne wymiary i wagę paczki",
  other: "pozostałe ustawienia dostaw",
};

/**
 * Jedno zdanie PL dla `formError` akcji nadania/anulowania przesyłki —
 * ta sama treść co sekcja dostawy, tylko złożona w tekst, bo akcja nie
 * renderuje listy.
 */
export function courierConfigSummaryPl(problems: readonly string[]): string {
  const items = courierConfigItems(problems).map((item) => ITEM_LABEL_PL[item]);
  return `Zanim nadasz przesyłkę, uzupełnij w ustawieniach dostaw: ${items.join(", ")}.`;
}
