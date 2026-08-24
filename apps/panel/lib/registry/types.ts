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
 * Wynik NEGATYWNY — rozróżnienie „nie znaleziono" (oba źródła zgodnie
 * mówią: nie ma takiej firmy) od „rejestr niedostępny" (sieć/5xx — NIE
 * fabrykujemy odpowiedzi i NIE przepuszczamy cicho, patrz brief SPEC A.5).
 */
export interface CompanyLookupNotFound {
  ok: false;
  reason: "invalid_checksum" | "not_found" | "unavailable";
  message: string;
}

export type CompanyLookupResult = CompanyLookupFound | CompanyLookupNotFound;

/** Zapis w `app.nip_lookup_cache` — dokładnie to, co idzie do jsonb `data`. */
export type NipLookupCacheData = Omit<CompanyLookupFound, "ok" | "nip">;
