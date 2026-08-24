/**
 * Hybryda MF Biała lista (główne) + GUS BIR1.1 (fallback) — L1/ADR-234,
 * SPEC A. Jedyny eksport, którego wołający (akcja serwerowa `lookup-action.ts`)
 * potrzebuje: `lookupCompanyByNip`.
 *
 * KOLEJNOŚĆ (brief SPEC A):
 *   1. Checksum — bramka PRZED jakimkolwiek strzałem do sieci.
 *   2. MF Biała lista. `subject: null` (firma nie figuruje w VAT) → GUS.
 *      Błąd transportu MF → `unavailable` NATYCHMIAST, bez próby GUS: skoro
 *      nie wiadomo, czy MF w ogóle prawdziwie odpowiedział, awaryjne przejście
 *      dalej zmieniałoby jednoznaczny sygnał „nie wiadomo" w domysł.
 *   3. GUS — tylko gdy MF powiedział „nie ma w VAT". Brak klucza GUS
 *      (`gusUserKey() === null`) degraduje CICHO do samego wyniku MF
 *      (`not_found`) — to NIE jest błąd, to świadomy wybór właściciela
 *      (klucz GUS jest opcjonalny).
 */
import { isValidNipChecksum, normalizeNip } from "@avably/core";

import { lookupGus } from "./gus";
import { lookupMfWhitelist } from "./mf";
import type { CompanyLookupResult } from "./types";

export interface LookupCompanyDeps {
  fetchFn?: typeof fetch;
}

export async function lookupCompanyByNip(
  rawNip: string,
  deps: LookupCompanyDeps = {},
): Promise<CompanyLookupResult> {
  const nip = normalizeNip(rawNip);

  // KROK 1 (SPEC A.1) — bramka PRZED jakimkolwiek strzałem do sieci. Wołający
  // (akcja serwerowa) waliduje to samo jeszcze wcześniej dla UX-u (błąd bez
  // opóźnienia sieciowego), ale ta funkcja MUSI powtórzyć sprawdzenie —
  // pojedyncze źródło prawdy o tym, co wolno wysłać dalej, nie dwa niezależne.
  if (!isValidNipChecksum(nip)) {
    return { ok: false, reason: "invalid_checksum", message: "Nieprawidłowy NIP." };
  }

  const mfResult = await lookupMfWhitelist(nip, { fetchFn: deps.fetchFn });
  if (mfResult.ok) return mfResult;
  if (mfResult.reason === "unavailable") return mfResult;

  // mfResult.reason === "not_found" → jedyna gałąź, w której próbujemy GUS.
  return lookupGus(nip, { fetchFn: deps.fetchFn });
}
