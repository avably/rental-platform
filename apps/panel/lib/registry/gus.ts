/**
 * Klient GUS BIR1.1 (`UslugaBIRzewnPubl.svc`) — FALLBACK hybrydy (L1/ADR-234,
 * SPEC A.3), używany WYŁĄCZNIE gdy MF Biała lista zwróci `subject: null`
 * (firma niezarejestrowana do VAT — np. świeża działalność, zwolnienie
 * podmiotowe). Ręczna koperta SOAP + `fetch` (brief: pakiet `soap` bywa
 * problematyczny) — kontrakt zweryfikowany NA ŻYWO 2026-08-24 wobec
 * `wyszukiwarkaregontest.stat.gov.pl` publicznym kluczem testowym
 * `abcde12345abcde12345`:
 *
 *   1. `Zaloguj(pKluczUzytkownika)` → `sid` w CIEL ODPOWIEDZI
 *      (`ZalogujResult`). Kolejne wywołania niosą ten sid w nagłówku
 *      HTTP `sid` (NIE w kopercie SOAP!) + WS-Addressing `wsa:To`/`wsa:Action`
 *      w nagłówku SOAP.
 *   2. Odpowiedź WCF jest MTOM (`multipart/related`) NAWET dla żądania
 *      zwykłym XML-em — parsowane przez `extractSoapEnvelope` (xml.ts),
 *      które ignoruje opakowanie MIME.
 *   3. `DaneSzukajPodmioty(Nip)` → `DaneSzukajPodmiotyResult` to ZAKODOWANY
 *      XML w XML-u (`&lt;root&gt;…`) — `Typ` (P/F) + `SilosID` rozstrzygają
 *      NAZWĘ RAPORTU do `DanePobierzPelnyRaport`. Sesja nieważna/wygasła →
 *      `XxxResult` PUSTY (samozamykający się, bez treści — zweryfikowane
 *      empirycznie próbą z fałszywym sid) → jeden re-login + retry.
 *      Firma nieznaleziona → treść z `<ErrorCode>4</ErrorCode>`.
 *   4. `DanePobierzPelnyRaport(regon, nazwaRaportu)` — pola raportu mają
 *      prefiks zależny od typu (`praw_*` dla osób prawnych, `fiz_*` dla
 *      fizycznych/CEIDG) — oba kształty zweryfikowane na żywo.
 *
 * MAPOWANIE `Typ`+`SilosID` → `nazwaRaportu` zaimplementowane jest dla DWÓCH
 * gałęzi realnie zweryfikowanych na żywo: P/6 (`BIR11OsPrawna`) i F/1
 * (`BIR11OsFizycznaDzialalnoscCeidg`, najczęstsza forma jednoosobowej
 * działalności z NIP-em). Pozostałe SilosID fizycznych (2=rolnicza,
 * 3=pozostała ewidencja, 5=dane ogólne bez działalności) są UDOKUMENTOWANE
 * w kodzie, ale NIEZWERYFIKOWANE na żywo — traktowane jako `unavailable`
 * zamiast zgadywać kształt pól (patrz `unsupportedReportKind`). Odłożone
 * świadomie — poza brief i mało prawdopodobne dla najemcy zakładającego
 * wypożyczalnię.
 */
import { extractDecodedResult, extractSoapEnvelope, extractTag, isSoapFault } from "./xml";
import type { CompanyLookupResult, RegistryAddress } from "./types";

const GUS_TEST_BASE_URL = "https://wyszukiwarkaregontest.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc";
const GUS_PROD_BASE_URL = "https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc";
/** Publiczny klucz testowy GUS — udokumentowany w specyfikacji BIR1.1, do dev/CI. */
export const GUS_TEST_USER_KEY = "abcde12345abcde12345";

const NAMESPACE = "http://CIS/BIR/PUBL/2014/07";
const ACTION_BASE = `${NAMESPACE}/IUslugaBIRzewnPubl`;

export function gusBaseUrl(): string {
  return process.env.GUS_BIR_ENV === "test" ? GUS_TEST_BASE_URL : GUS_PROD_BASE_URL;
}

/**
 * Klucz GUS jest OPCJONALNY (brief SPEC A.3): brak `GUS_BIR_USER_KEY` na
 * produkcji degraduje hybrydę do samego MF, zamiast wywalać się. W trybie
 * testowym (`GUS_BIR_ENV=test`) używamy publicznego klucza testowego, jeśli
 * nikt nie skonfigurował własnego — środowisko testowe GUS i tak akceptuje
 * WYŁĄCZNIE ten klucz.
 */
export function gusUserKey(): string | null {
  const configured = process.env.GUS_BIR_USER_KEY;
  if (configured && configured.trim() !== "") return configured;
  return process.env.GUS_BIR_ENV === "test" ? GUS_TEST_USER_KEY : null;
}

export interface GusDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function soapEnvelope(url: string, action: string, bodyXml: string): string {
  return (
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" ` +
    `xmlns:wsa="http://www.w3.org/2005/08/addressing" xmlns:ns="${NAMESPACE}" ` +
    `xmlns:dat="${NAMESPACE}/DataContract">` +
    `<soap:Header><wsa:To>${url}</wsa:To><wsa:Action>${action}</wsa:Action></soap:Header>` +
    `<soap:Body>${bodyXml}</soap:Body></soap:Envelope>`
  );
}

async function soapRequest(
  url: string,
  action: string,
  bodyXml: string,
  sid: string | null,
  deps: Required<GusDeps>,
): Promise<{ envelope: string } | { error: "transport" | "fault" }> {
  const headers: Record<string, string> = {
    "Content-Type": `application/soap+xml; charset=utf-8; action="${action}"`,
  };
  if (sid) headers.sid = sid;

  let res: Response;
  try {
    res = await deps.fetchFn(url, {
      method: "POST",
      headers,
      body: soapEnvelope(url, action, bodyXml),
      cache: "no-store",
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
  } catch (err) {
    console.error("[registry:gus] transport error", err);
    return { error: "transport" };
  }

  const text = await res.text();
  const envelope = extractSoapEnvelope(text);
  if (!res.ok || envelope === null) {
    console.error("[registry:gus] nie-2xx albo brak koperty SOAP", res.status);
    return { error: "transport" };
  }
  if (isSoapFault(envelope)) {
    console.error("[registry:gus] SOAP Fault");
    return { error: "fault" };
  }
  return { envelope };
}

/** Cache `sid` w pamięci procesu — brief SPEC A.3: „Cache sid, odśwież na wygaśnięcie". */
let cachedSid: string | null = null;

async function login(deps: Required<GusDeps>, key: string): Promise<string | null> {
  const action = `${ACTION_BASE}/Zaloguj`;
  const body = `<ns:Zaloguj><ns:pKluczUzytkownika>${key}</ns:pKluczUzytkownika></ns:Zaloguj>`;
  const result = await soapRequest(gusBaseUrl(), action, body, null, deps);
  if ("error" in result) return null;

  const sid = extractTag(result.envelope, "ZalogujResult");
  if (!sid) return null;
  cachedSid = sid;
  return sid;
}

/** `true` = `XxxResult` pusty/samozamykający — sygnatura sid nieważnego/wygasłego (zweryfikowane na żywo). */
function isSessionInvalidResult(envelope: string, resultTag: string): boolean {
  const raw = extractTag(envelope, resultTag);
  return raw === null || raw === "";
}

interface GusSearchHit {
  regon: string;
  typ: "P" | "F";
  silosId: string;
  nazwa: string;
}

/** Woła `DaneSzukajPodmioty(Nip)` z re-loginem PRZY nieważnym sid (jeden retry). */
async function searchByNip(
  nip: string,
  deps: Required<GusDeps>,
  key: string,
): Promise<GusSearchHit | "not_found" | "unavailable"> {
  const action = `${ACTION_BASE}/DaneSzukajPodmioty`;
  const body = `<ns:DaneSzukajPodmioty><ns:pParametryWyszukiwania><dat:Nip>${nip}</dat:Nip></ns:pParametryWyszukiwania></ns:DaneSzukajPodmioty>`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const sid = cachedSid ?? (await login(deps, key));
    if (!sid) return "unavailable";

    const result = await soapRequest(gusBaseUrl(), action, body, sid, deps);
    if ("error" in result) return "unavailable";

    if (isSessionInvalidResult(result.envelope, "DaneSzukajPodmiotyResult")) {
      // sid wygasł/nieważny → wymuś re-login w kolejnej iteracji.
      cachedSid = null;
      continue;
    }

    const inner = extractDecodedResult(result.envelope, "DaneSzukajPodmiotyResult");
    if (inner === null) return "unavailable";

    if (extractTag(inner, "ErrorCode") !== null) return "not_found";

    const regon = extractTag(inner, "Regon");
    const typ = extractTag(inner, "Typ");
    const silosId = extractTag(inner, "SilosID");
    const nazwa = extractTag(inner, "Nazwa");
    if (!regon || !typ || !silosId || !nazwa || (typ !== "P" && typ !== "F")) {
      console.error("[registry:gus] niespodziewany kształt DaneSzukajPodmiotyResult");
      return "unavailable";
    }
    return { regon, typ, silosId, nazwa };
  }

  return "unavailable";
}

/**
 * Nazwa raportu wg Typ+SilosID (dokumentacja BIR1.1). Tylko P/6 i F/1 są
 * zweryfikowane na żywo (patrz docblock modułu) — pozostałe gałęzie
 * fizyczne zwracają `null` (traktowane jako `unavailable` przez wołającego),
 * żeby nie zgadywać nazw pól raportu, których nikt nie widział na oczy.
 */
function reportNameFor(typ: "P" | "F", silosId: string): string | null {
  if (typ === "P" && silosId === "6") return "BIR11OsPrawna";
  if (typ === "F" && silosId === "1") return "BIR11OsFizycznaDzialalnoscCeidg";
  return null;
}

function addressFromReport(inner: string, prefix: string): RegistryAddress {
  const street = extractTag(inner, `${prefix}AdSiedzUlica_Nazwa`) ?? "";
  const number = extractTag(inner, `${prefix}AdSiedzNumerNieruchomosci`) ?? "";
  const local = extractTag(inner, `${prefix}AdSiedzNumerLokalu`);
  const zipRaw = extractTag(inner, `${prefix}AdSiedzKodPocztowy`) ?? "";
  const city = extractTag(inner, `${prefix}AdSiedzMiejscowosc_Nazwa`) ?? "";

  const streetWithNumber = [street, number].filter(Boolean).join(" ") + (local ? `/${local}` : "");
  // GUS oddaje kod pocztowy BEZ myślnika ("09411") — MF go MA ("09-411");
  // ujednolicamy na format polski, żeby oba źródła dawały ten sam kształt.
  const zip = /^\d{5}$/.test(zipRaw) ? `${zipRaw.slice(0, 2)}-${zipRaw.slice(2)}` : zipRaw;

  return { street: streetWithNumber.trim(), zip, city };
}

async function fetchFullReport(
  hit: GusSearchHit,
  reportName: string,
  deps: Required<GusDeps>,
  key: string,
): Promise<{ legalName: string; address: RegistryAddress } | "unavailable"> {
  const action = `${ACTION_BASE}/DanePobierzPelnyRaport`;
  const body = `<ns:DanePobierzPelnyRaport><ns:pRegon>${hit.regon}</ns:pRegon><ns:pNazwaRaportu>${reportName}</ns:pNazwaRaportu></ns:DanePobierzPelnyRaport>`;

  const sid = cachedSid ?? (await login(deps, key));
  if (!sid) return "unavailable";

  const result = await soapRequest(gusBaseUrl(), action, body, sid, deps);
  if ("error" in result) return "unavailable";

  const inner = extractDecodedResult(result.envelope, "DanePobierzPelnyRaportResult");
  if (inner === null) return "unavailable";

  const prefix = hit.typ === "P" ? "praw_" : "fiz_";
  const legalName = extractTag(inner, `${prefix}nazwa`);
  if (!legalName) return "unavailable";

  return { legalName, address: addressFromReport(inner, prefix) };
}

/**
 * Odpytuje GUS BIR1.1 o firmę po NIP. Zwraca `ok:false` dla wszystkiego —
 * łącznie z „nie znaleziono" i „brak klucza" — bo GUS jest tu WYŁĄCZNIE
 * fallbackiem: wołający (`lookup.ts`) decyduje co zrobić z każdym wariantem,
 * ten moduł nie zna kontekstu MF.
 */
export async function lookupGus(nip: string, deps: GusDeps = {}): Promise<CompanyLookupResult> {
  const key = gusUserKey();
  if (!key) {
    return { ok: false, reason: "unavailable", message: "Rejestr GUS niedostępny (brak konfiguracji)." };
  }

  const resolvedDeps: Required<GusDeps> = {
    fetchFn: deps.fetchFn ?? fetch,
    timeoutMs: deps.timeoutMs ?? 10_000,
  };

  const hit = await searchByNip(nip, resolvedDeps, key);
  if (hit === "not_found") {
    return { ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." };
  }
  if (hit === "unavailable") {
    return { ok: false, reason: "unavailable", message: "Rejestr chwilowo niedostępny, spróbuj ponownie." };
  }

  const reportName = reportNameFor(hit.typ, hit.silosId);
  if (reportName === null) {
    console.error(`[registry:gus] niewspierany typ raportu Typ=${hit.typ} SilosID=${hit.silosId}`);
    return { ok: false, reason: "unavailable", message: "Rejestr chwilowo niedostępny, spróbuj ponownie." };
  }

  const report = await fetchFullReport(hit, reportName, resolvedDeps, key);
  if (report === "unavailable") {
    return { ok: false, reason: "unavailable", message: "Rejestr chwilowo niedostępny, spróbuj ponownie." };
  }

  return {
    ok: true,
    nip,
    legalName: report.legalName,
    regon: hit.regon,
    krs: null,
    address: report.address,
    statusVat: null,
    source: "gus",
    fetchedAt: new Date().toISOString(),
    requestId: null,
  };
}

/** Reset stanu cache sid — WYŁĄCZNIE do testów. */
export function __resetGusSidCacheForTests(): void {
  cachedSid = null;
}
