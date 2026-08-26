/**
 * Kształt wspólny dla obu źródeł rejestru (MF Biała lista / GUS BIR1.1) —
 * L1/ADR-234. Typy CZYSTE (bez I/O), więc bezpieczne do importu zarówno w
 * modułach serwerowych (`mf.ts`, `gus.ts`, `lookup.ts`, `cache.ts`), jak i w
 * komponentach klienckich, które tylko WYŚWIETLAJĄ wynik zwrócony przez akcję
 * serwerową (nigdy nie wołają MF/GUS bezpośrednio).
 */

export interface RegistryAddress {
  street: string;
  zip: string;
  city: string;
}

/** Wynik POZYTYWNY — firma znaleziona w jednym z dwóch źródeł. */
export interface CompanyLookupFound {
  ok: true;
  nip: string;
  legalName: string;
  regon: string | null;
  krs: string | null;
  address: RegistryAddress;
  /** `null`, gdy źródłem jest GUS (BIR1.1 nie niesie statusu VAT). */
  statusVat: string | null;
  source: "mf" | "gus";
  fetchedAt: string;
  /** `requestId` z MF Białej listy — dowód zapytania (brief SPEC A.2). `null` dla GUS. */
  requestId: string | null;
}

/**
 * Wynik NEGATYWNY. Powód jest ROZRÓŻNIONY, bo każdy z nich znaczy dla
 * człowieka przed formularzem coś innego — a do ADR-276 wszystkie poza
 * „nie znaleziono" zlewały się w jedno „Rejestr chwilowo niedostępny,
 * spróbuj ponownie", czyli w radę, która NIC NIE ZMIENIA w trzech z
 * czterech przypadków:
 *
 *   • `invalid_checksum` — NIP jest formalnie zły, poprawia go użytkownik.
 *   • `not_found` — oba źródła zgodnie mówią „nie ma takiej firmy" (np.
 *     podmiot ZWOLNIONY z VAT nie figuruje w wykazie MF). Ponawianie nie
 *     pomoże; pomoże wpisanie danych ręcznie.
 *   • `unavailable` — awaria PRZEJŚCIOWA (sieć/5xx/timeout). Tu „spróbuj
 *     ponownie" jest prawdą, ale i tak oferujemy drogę ręczną.
 *   • `unconfigured` — rejestru NIE MA JAK zapytać, bo brakuje konfiguracji
 *     po NASZEJ stronie (klucz GUS). Nazwanie tego „chwilową niedostępnością"
 *     było najgorszym z komunikatów: kazało czekać na coś, co samo nie minie.
 *   • `rate_limited` — użytkownik wyczerpał limit prób wyszukiwania. Wina
 *     nie leży po stronie rejestru i minie po chwili, ale to INNA rada niż
 *     „odśwież i spróbuj".
 */
export interface CompanyLookupNotFound {
  ok: false;
  reason: "invalid_checksum" | "not_found" | "unavailable" | "unconfigured" | "rate_limited";
  message: string;
}

export type CompanyLookupResult = CompanyLookupFound | CompanyLookupNotFound;

/** Zapis w `app.nip_lookup_cache` — dokładnie to, co idzie do jsonb `data`. */
export type NipLookupCacheData = Omit<CompanyLookupFound, "ok" | "nip">;
