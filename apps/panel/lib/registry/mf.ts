/**
 * Klient MF Biała lista podatników VAT (L1/ADR-234, SPEC A.2) — GŁÓWNE
 * źródło hybrydy. REST, bez klucza, JSON. Kształt odpowiedzi zweryfikowany
 * NA ŻYWO 2026-08-24 (`wl-api.mf.gov.pl`, NIP PKN ORLEN 7740001454):
 *
 *   { result: { subject: {...} | null, requestId, requestDateTime } }
 *
 * `subject: null` (HTTP 200) = firma nie figuruje w Białej liście — to NIE
 * jest błąd transportu, to jest wynik wyszukiwania. Rozróżnienie od awarii
 * (sieć/5xx) jest CELOWE (brief SPEC A.5): tylko `subject: null` uruchamia
 * fallback GUS, błąd transportu kończy się `unavailable` bez próby GUS
 * (nie ma sensu szukać dalej, skoro nie wiadomo, czy MF w ogóle odpowiedział
 * prawdziwie).
 */
import type { CompanyLookupResult, RegistryAddress } from "./types";

/** Endpoint testowy (`wl-test.mf.gov.pl`) — brief SPEC A.2, do dev/CI. */
const MF_WHITELIST_BASE_URL_ENV = "MF_WHITELIST_BASE_URL";
const DEFAULT_MF_WHITELIST_BASE_URL = "https://wl-api.mf.gov.pl";

export function mfWhitelistBaseUrl(): string {
  const configured = process.env[MF_WHITELIST_BASE_URL_ENV];
  return configured && configured.trim() !== "" ? configured : DEFAULT_MF_WHITELIST_BASE_URL;
}

/** Dzisiejsza data w formacie `YYYY-MM-DD`, wymaganym przez MF (`?date=`). */
export function todayDateParam(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Rozbija adres MF (jeden string: `"ULICA NR, KOD MIASTO"`) na
 * street/zip/city. MF NIE wystawia tych pól osobno — to jedyny format, jaki
 * dostajemy (zweryfikowane na żywo: `"CHEMIKÓW 7, 09-411 PŁOCK"`).
 * Brak dopasowania kodu pocztowego (adres zagraniczny/nietypowy) → cała
 * reszta wraz z przecinkiem trafia w `street`, `zip`/`city` puste — lepsze
 * niż rzucić błąd na dane, które i tak trzeba pokazać operatorowi do
 * ręcznej korekty.
 */
export function parseMfAddress(raw: string): RegistryAddress {
  const commaIndex = raw.lastIndexOf(",");
  if (commaIndex === -1) return { street: raw.trim(), zip: "", city: "" };

  const street = raw.slice(0, commaIndex).trim();
  const rest = raw.slice(commaIndex + 1).trim();
  const zipMatch = /^(\d{2}-\d{3})\s+(.*)$/.exec(rest);
  if (!zipMatch) return { street, zip: "", city: rest };

  return { street, zip: zipMatch[1]!, city: zipMatch[2]!.trim() };
}

interface MfSubject {
  name: string;
  nip: string;
  statusVat: string | null;
  regon: string | null;
  krs: string | null;
  residenceAddress: string | null;
  workingAddress: string | null;
}

interface MfSearchResponse {
  result: {
    subject: MfSubject | null;
    requestId: string;
    requestDateTime: string;
  };
}

function isMfSearchResponse(value: unknown): value is MfSearchResponse {
  if (typeof value !== "object" || value === null) return false;
  const result = (value as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return false;
  const requestId = (result as { requestId?: unknown }).requestId;
  return typeof requestId === "string";
}

export interface LookupMfWhitelistDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
}

/**
 * Woła MF Biała lista dla pojedynczego NIP-u. Zwraca:
 *  - `ok:true`  — firma znaleziona,
 *  - `ok:false, reason:"not_found"` — MF odpowiedział, `subject` jest `null`
 *    (wołający decyduje, czy próbować GUS),
 *  - `ok:false, reason:"unavailable"` — transport/HTTP/kształt zawiódł.
 *
 * NIGDY nie rzuca — każdy błąd ląduje w wyniku `unavailable` (brief SPEC
 * A.5: „NIE fabrykuj, NIE przepuszczaj cicho").
 */
export async function lookupMfWhitelist(
  nip: string,
  deps: LookupMfWhitelistDeps = {},
): Promise<CompanyLookupResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 8000;
  const date = todayDateParam(deps.now ?? new Date());
  const url = `${mfWhitelistBaseUrl()}/api/search/nip/${nip}?date=${date}`;

  let res: Response;
  try {
    res = await fetchFn(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    console.error("[registry:mf] transport error", err);
    return { ok: false, reason: "unavailable", message: "Rejestr chwilowo niedostępny, spróbuj ponownie." };
  }

  if (!res.ok) {
    console.error("[registry:mf] nie-2xx", res.status);
    return { ok: false, reason: "unavailable", message: "Rejestr chwilowo niedostępny, spróbuj ponownie." };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    console.error("[registry:mf] nieparsowalny JSON", err);
    return { ok: false, reason: "unavailable", message: "Rejestr chwilowo niedostępny, spróbuj ponownie." };
  }

  if (!isMfSearchResponse(data)) {
    console.error("[registry:mf] niespodziewany kształt odpowiedzi");
    return { ok: false, reason: "unavailable", message: "Rejestr chwilowo niedostępny, spróbuj ponownie." };
  }

  const { subject, requestId, requestDateTime } = data.result;
  if (subject === null) {
    return { ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." };
  }

  const addressRaw = subject.workingAddress ?? subject.residenceAddress ?? "";

  return {
    ok: true,
    nip: subject.nip,
    legalName: subject.name,
    regon: subject.regon,
    krs: subject.krs,
    address: parseMfAddress(addressRaw),
    statusVat: subject.statusVat,
    source: "mf",
    fetchedAt: requestDateTime,
    requestId,
  };
}
