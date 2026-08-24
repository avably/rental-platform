/**
 * Mini-parser SOAP/XML dla GUS BIR1.1 (L1/ADR-234) — CELOWO bez zależności
 * (`packages/pnpm-workspace.yaml` nie ma żadnej biblioteki XML, a brief zadania
 * wprost odradza pakiet `soap`: "bywa problematyczny"). Kształt odpowiedzi
 * GUS jest WĄSKI i STABILNY (rządowa usługa SOAP z zamrożonym kontraktem
 * `UslugaBIRzewnPubl.svc`), więc regexowa ekstrakcja pojedynczych znaczników
 * jest tu uzasadniona — nie parsujemy dowolnego, nieufanego XML-a.
 *
 * ZWERYFIKOWANE NA ŻYWO (2026-08-24) wobec testowego środowiska GUS
 * (`wyszukiwarkaregontest.stat.gov.pl`, publiczny klucz testowy
 * `abcde12345abcde12345`) — patrz `gus.ts` po szczegóły przepływu:
 *
 *   1. Odpowiedź WCF przychodzi jako MTOM (`multipart/related`), NIE jako
 *      goła koperta SOAP — nawet gdy żądanie jest zwykłym XML-em. Zamiast
 *      parsować granice MIME, wyciągamy `<...Envelope>…</...Envelope>`
 *      regexem NIEZALEŻNIE od opakowania: `Content-Transfer-Encoding: 8bit`
 *      (zweryfikowane empirycznie) oznacza czysty tekst, bez base64.
 *   2. Wynik operacji (`XxxResult`) jest ZAKODOWANYM XML-em WEWNĄTRZ XML-a —
 *      encje (`&lt;`, `&gt;`, `&#xD;`…) trzeba zdekodować, ZANIM da się z
 *      niego wyciągnąć pojedyncze pola. Stąd `decodeXmlEntities` jako osobny
 *      krok między `extractTag` zewnętrznym a `extractTag` wewnętrznym.
 */

/** Dekoduje standardowe encje XML — `&amp;` OSTATNIA, żeby nie dekodować dwukrotnie. */
export function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

/**
 * Wyciąga treść znacznika `<tag>...</tag>` (opcjonalny prefiks przestrzeni
 * nazw, np. `<a:ZalogujResult>`). `null` dla znacznika samozamykającego
 * (`<Foo />`) albo nieobecnego — oba znaczą „puste"/"brak", co jest
 * poprawnym rozróżnieniem dla pól GUS (puste pole = samozamykający się tag).
 */
export function extractTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, "i");
  const match = re.exec(xml);
  return match ? match[1]!.trim() : null;
}

/**
 * Wyciąga całą kopertę SOAP z surowej odpowiedzi HTTP — działa zarówno na
 * odpowiedzi multipart/MTOM (bierze tylko fragment Envelope, ignorując
 * nagłówki MIME dookoła), jak i na gołym XML-u. `null`, gdy koperty nie da
 * się znaleźć (transport zwrócił coś innego niż SOAP — traktuj jak błąd).
 */
export function extractSoapEnvelope(rawBody: string): string | null {
  const match = /<(?:[\w-]+:)?Envelope[\s\S]*<\/(?:[\w-]+:)?Envelope>/i.exec(rawBody);
  return match ? match[0] : null;
}

/** `true`, gdy koperta niesie `<s:Fault>`/`<soap:Fault>` (błąd SOAP, np. sesja wygasła). */
export function isSoapFault(envelopeXml: string): boolean {
  return /<(?:[\w-]+:)?Fault[\s>]/i.test(envelopeXml);
}

/**
 * Wyciąga wartość znacznika `XxxResult` (zewnętrzna koperta SOAP), dekoduje
 * encje i zwraca gotowy, WEWNĘTRZNY XML gotowy do dalszej ekstrakcji
 * `extractTag`. `null`, gdy `XxxResult` jest samozamykający/nieobecny —
 * sygnatura empirycznie zaobserwowana przy nieważnym/wygasłym `sid`
 * (patrz `gus.ts`, `isSessionInvalidResult`).
 */
export function extractDecodedResult(envelopeXml: string, resultTag: string): string | null {
  const raw = extractTag(envelopeXml, resultTag);
  if (raw === null || raw === "") return null;
  return decodeXmlEntities(raw);
}
