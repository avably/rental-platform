/**
 * Parytet cen LP ↔ `SAAS_PLAN_PRICING` (packages/core, ADR-135).
 *
 * Kwoty abonamentu SaaS mają JEDNO źródło prawdy — stałą w `@avably/core`.
 * Panel czyta z niej wprost; LP nie może, bo trzyma kwoty W PROZIE
 * (messages/{pl,en}.json): w środku zdań FAQ, na cenniku i w metadanych SEO,
 * w dwóch formatach locale („1 990 zł" vs „PLN 1,990"). Renderowanie z
 * wartości stałej wymagałoby przebudowy potoku tokenów {{klucz}} → cała
 * treść oraz interpolacji w metadanych — dlatego parytet pilnuje ten test,
 * DWUKIERUNKOWO:
 *
 * 1. messages → stała: skaner zdejmuje z OBU plików treści KAŻDĄ liczbę
 *    stojącą przy markerze waluty (zł / PLN / EUR / €) i porównuje pełny
 *    inwentarz (ścieżka klucza → kwoty w kolejności wystąpień) z oczekiwaniem
 *    policzonym ze stałej. Kwota dopisana gdziekolwiek w treści bez pokrycia
 *    (przynęta) to nadmiarowy wpis → czerwień; kwota usunięta albo
 *    przestawiona między planami → brakujący/przestawiony wpis → czerwień.
 * 2. stała → messages: oczekiwany inwentarz NIE zawiera ani jednego literału
 *    ceny — wszystko jest wyprowadzone z `SAAS_PLAN_PRICING`, więc zmiana
 *    stałej bez zmiany treści też daje czerwień.
 *
 * Kwoty przykładowe z copy o kaucjach (950 zł pobrania, 57 zł potrącenia)
 * NIE są cenami SaaS — stoją w inwentarzu jawnie, żeby skaner pozostał
 * zupełny: każda kwota w treści musi być rozliczona, nie tylko cennikowa.
 * Zmiana przykładu w copy to świadoma edycja inwentarza, nie dziura w bramce.
 */
import { SAAS_PLAN_PRICING, SAAS_YEARLY_MONTHS_CHARGED } from "@avably/core";
import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

/** Kalendarz, nie decyzja cenowa — dwanaście rat w roku to stała natury. */
const MIESIECY_W_ROKU = 12;

function plan(id: "standard" | "premium") {
  const znaleziony = SAAS_PLAN_PRICING.find((wpis) => wpis.id === id);
  if (!znaleziony) {
    throw new Error(`SAAS_PLAN_PRICING nie zna planu „${id}" — zaktualizuj inwentarz cen LP`);
  }
  return znaleziony;
}

/**
 * Stała trzyma grosze; treść LP mówi w pełnych złotych. Kwota z częścią
 * groszową (np. 199,50) wymagałaby decyzji o zapisie w DWÓCH językach —
 * ten przelicznik celowo pęka, żeby taka zmiana nie przeszła bez ruszenia
 * treści i tego inwentarza.
 */
function zlote(grosze: number): number {
  if (grosze % 100 !== 0) {
    throw new Error(`kwota ${grosze} gr nie jest pełną złotówką — LP pisze ceny bez groszy`);
  }
  return grosze / 100;
}

const standardMies = zlote(plan("standard").monthlyNetGrosze);
const standardRok = zlote(plan("standard").yearlyNetGrosze);
const premiumMies = zlote(plan("premium").monthlyNetGrosze);
const premiumRok = zlote(plan("premium").yearlyNetGrosze);

/** „To o 398 zł mniej niż dwanaście rat" — różnica jest POLICZONA, nie wpisana. */
const oszczednoscStandard = MIESIECY_W_ROKU * standardMies - standardRok;
/** „Dwanaście rat kosztowałoby 4 788 zł" — iloczyn, nie literał. */
const dwanascieRatPremium = MIESIECY_W_ROKU * premiumMies;

/** Przykłady liczbowe z copy o kaucjach — treść marketingowa, nie cennik. */
const PRZYKLAD_KAUCJI = 950;
const PRZYKLAD_POTRACENIA = 57;

/**
 * Pełny inwentarz kwot pieniężnych w treści LP. Obie wersje językowe niosą
 * IDENTYCZNY układ (parytet kluczy pilnuje messages-parity.test.ts), więc
 * oczekiwanie jest jedno. Kolejność w tablicy = kolejność wystąpień w zdaniu,
 * dlatego zamiana cen planów miejscami też pali.
 */
const INWENTARZ: Record<string, number[]> = {
  "marketing.premise.statement": [PRZYKLAD_POTRACENIA],
  "marketing.tabs.item2Body": [PRZYKLAD_KAUCJI, PRZYKLAD_POTRACENIA, PRZYKLAD_POTRACENIA],
  "marketing.faq.a2Lead": [standardMies],
  "marketing.faq.a2": [premiumMies],
  "marketing.faq.a3": [standardMies, premiumMies],
  "marketing.pricingPage.standardPrice": [standardMies],
  "marketing.pricingPage.standardYearly": [standardRok, oszczednoscStandard],
  "marketing.pricingPage.premiumPrice": [premiumMies],
  "marketing.pricingPage.premiumYearly": [premiumRok, dwanascieRatPremium],
  "landing.metadata.description": [standardMies],
};

/**
 * Liczba przy markerze waluty. Marker jest warunkiem KONIECZNYM: goła liczba
 * („trial 14 dni", „RFC 9116", numer telefonu) nie jest kwotą pieniężną.
 * `zł` nie może być początkiem słowa („złożyć zamówienie"); PLN/EUR łapią
 * zapis przedrostkowy. Separatory grup (spacja, NBSP, przecinek) schodzą przy
 * normalizacji do liczby całkowitej — więc zapis z częścią groszową
 * („99,50 zł" → 9950) NIE rozliczy się z inwentarzem i pali bramkę zamiast
 * cicho przejść: nieznany format to czerwień, nie interpretacja.
 */
const KWOTA = /(\d[\d\s,]*\d|\d)\s*(?:zł(?!\p{L})|€|EUR(?!\p{L}))|(?:PLN|EUR|€)\s*(\d[\d\s,]*\d|\d)/gu;

function zbierzKwoty(drzewo: unknown, sciezka: string, wynik: Record<string, number[]>): void {
  if (typeof drzewo === "string") {
    for (const trafienie of drzewo.matchAll(KWOTA)) {
      const token = trafienie[1] ?? trafienie[2];
      (wynik[sciezka] ??= []).push(Number(token.replace(/[\s,]/g, "")));
    }
    return;
  }
  if (drzewo && typeof drzewo === "object") {
    for (const [klucz, wartosc] of Object.entries(drzewo)) {
      zbierzKwoty(wartosc, sciezka ? `${sciezka}.${klucz}` : klucz, wynik);
    }
  }
}

describe("parytet cen LP ze stałą SAAS_PLAN_PRICING", () => {
  for (const [locale, messages] of [
    ["pl", pl],
    ["en", en],
  ] as const) {
    it(`${locale}: każda kwota pieniężna w treści rozlicza się z inwentarzem ze stałej`, () => {
      const znalezione: Record<string, number[]> = {};
      zbierzKwoty(messages, "", znalezione);
      expect(znalezione).toEqual(INWENTARZ);
    });
  }

  /**
   * Kwoty SŁOWNE. „Rok w cenie dziesięciu miesięcy" to ta sama obietnica co
   * 1 990 zł — tyle że skaner liczb jej nie widzi. Liczebnik bierze się ze
   * słownika kluczowanego stałą: zmiana `SAAS_YEARLY_MONTHS_CHARGED` bez
   * uzupełnienia słownika I treści obu locale pali test, zanim rozjazd
   * dojedzie do strony.
   */
  it("liczebniki rocznego rozliczenia są przypięte do SAAS_YEARLY_MONTHS_CHARGED", () => {
    const LICZEBNIKI: Record<number, { mianownik: string; dopelniacz: string; en: string }> = {
      10: { mianownik: "dziesięć", dopelniacz: "dziesięciu", en: "ten" },
    };
    const slowa = LICZEBNIKI[SAAS_YEARLY_MONTHS_CHARGED];
    if (!slowa) {
      throw new Error(
        `słownik liczebników nie zna wartości ${SAAS_YEARLY_MONTHS_CHARGED} — ` +
          "po zmianie stałej uzupełnij słownik ORAZ treść obu wersji językowych",
      );
    }

    expect(pl.marketing.faq.a2).toContain(`${slowa.mianownik} miesięcy`);
    expect(pl.marketing.faq.a3).toContain(`${slowa.dopelniacz} miesięcy`);
    expect(pl.marketing.pricingPage.intro).toContain(`${slowa.mianownik} rat`);
    expect(en.marketing.faq.a2).toContain(`${slowa.en} months`);
    expect(en.marketing.faq.a3).toContain(`${slowa.en} months`);
    expect(en.marketing.pricingPage.intro).toContain(`${slowa.en} instalments`);
  });
});
