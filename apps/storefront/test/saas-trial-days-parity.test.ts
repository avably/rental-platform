/**
 * Parytet długości triala LP ↔ `SAAS_TRIAL_DAYS` (packages/core, ADR-135).
 *
 * Obietnica „trial 14 dni bez karty" ma JEDNO źródło prawdy — stałą
 * w `@avably/core` (lustro zegara `now() + interval '14 days'` z migracji
 * 0066; parytetu SQL↔stała pilnuje packages/db/test/trial-clock.test.ts).
 * LP trzyma liczbę W PROZIE (messages/{pl,en}.json): na banerze hero,
 * w FAQ, na cenniku i w metadanych SEO — dlatego parytet pilnuje ten test,
 * DWUKIERUNKOWO, wzorcem z saas-pricing-parity.test.ts:
 *
 * 1. messages → stała: skaner zdejmuje z OBU plików treści KAŻDĄ liczbę
 *    stojącą przy markerze dni (dni / dniach / dnia, day / days, także
 *    zapis „14-day") i porównuje pełny inwentarz (ścieżka klucza → liczby
 *    w kolejności wystąpień) z oczekiwaniem policzonym ze stałej. Liczba
 *    dni dopisana gdziekolwiek w treści bez pokrycia (przynęta) to
 *    nadmiarowy wpis → czerwień; usunięta albo przepisana na nieznaną
 *    odmianę gramatyczną → brakujący wpis → czerwień. Nieznany format to
 *    czerwień, nie interpretacja.
 * 2. stała → messages: oczekiwany inwentarz NIE zawiera literału triala —
 *    wpisy są wyprowadzone z `SAAS_TRIAL_DAYS`, więc zmiana stałej bez
 *    zmiany treści obu locale też daje czerwień.
 *
 * Liczebniki SŁOWNE („po czternastu dniach" / "after fourteen days")
 * są niewidzialne dla skanera cyfr — pilnuje ich słownik kluczowany stałą
 * (wzorzec liczebników z saas-pricing-parity) ORAZ zamiatanie form
 * liczebnika po CAŁEJ treści, żeby nowe słowne „czternaście" nie weszło
 * poza inwentarzem. Liczebniki dni spoza triala („dwa dni przedłużenia",
 * „ostatnich trzydziestu dni" na pulpicie) to przykłady produktowe w copy,
 * nie obietnica triala — skaner cyfr ich nie widzi (są słowne), a zamiatanie
 * form szuka wyłącznie odmian liczby triala, więc zostają poza bramką
 * ŚWIADOMIE.
 */
import { SAAS_TRIAL_DAYS } from "@avably/core";
import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

/**
 * Liczba przy markerze dni. Marker jest warunkiem KONIECZNYM: goła liczba
 * („199 zł", „23% VAT", „RFC 9116") nie jest liczbą dni. Gramatyka markerów
 * jest ZAMKNIĘTĄ listą odmian występujących w treści (dni/dniach/dnia,
 * day/days, łącznik w „14-day"); odmiana spoza listy (np. „14 dniami")
 * NIE rozliczy się z inwentarzem i pali bramkę zamiast cicho przejść.
 */
const DNI = /(\d+)[\s-]*(?:dni(?:ach|a)?|days?)(?!\p{L})/gu;

function zbierzDni(drzewo: unknown, sciezka: string, wynik: Record<string, number[]>): void {
  if (typeof drzewo === "string") {
    for (const trafienie of drzewo.matchAll(DNI)) {
      (wynik[sciezka] ??= []).push(Number(trafienie[1]));
    }
    return;
  }
  if (drzewo && typeof drzewo === "object") {
    for (const [klucz, wartosc] of Object.entries(drzewo)) {
      zbierzDni(wartosc, sciezka ? `${sciezka}.${klucz}` : klucz, wynik);
    }
  }
}

/**
 * Pełny inwentarz CYFROWYCH liczb dni w treści LP. Obie wersje językowe
 * niosą IDENTYCZNY układ (parytet kluczy pilnuje messages-parity.test.ts),
 * więc oczekiwanie jest jedno. Każdy wpis jest wyprowadzony ze stałej —
 * w tej tablicy nie ma ani jednego literału 14.
 */
const INWENTARZ: Record<string, number[]> = {
  "marketing.banner.text": [SAAS_TRIAL_DAYS],
  "marketing.faq.q3": [SAAS_TRIAL_DAYS],
  "marketing.pricingPage.intro": [SAAS_TRIAL_DAYS],
  "marketing.pricingPage.honest1": [SAAS_TRIAL_DAYS],
  "landing.metadata.description": [SAAS_TRIAL_DAYS],
  "landing.metadata.ogDescription": [SAAS_TRIAL_DAYS],
  "landing.form.disabled.body": [SAAS_TRIAL_DAYS],
};

/**
 * Słownik liczebników triala kluczowany stałą. Zmiana `SAAS_TRIAL_DAYS`
 * bez uzupełnienia słownika I treści obu locale pali test, zanim rozjazd
 * dojedzie do strony. `formy` łapie KAŻDĄ odmianę i złożenie liczebnika
 * (czternastu, czternaście, czternastodniowy / fourteen, fourteen-day) —
 * zamiatanie niżej wymaga, żeby wszystkie wystąpienia w treści były
 * rozliczone z inwentarzem słownym.
 */
const LICZEBNIKI: Record<number, { plFraza: string; enFraza: string; formy: RegExp }> = {
  14: {
    plFraza: "po czternastu dniach",
    enFraza: "after fourteen days",
    formy: /czternast\p{L}*|fourteen(?:-day)?/giu,
  },
};

/** Wystąpienia form liczebnika triala: ścieżka klucza → liczba trafień. */
const INWENTARZ_SLOWNY: Record<string, number> = {
  "marketing.faq.a3": 1,
};

function zamiecFormy(drzewo: unknown, sciezka: string, formy: RegExp, wynik: Record<string, number>): void {
  if (typeof drzewo === "string") {
    const trafienia = [...drzewo.matchAll(formy)].length;
    if (trafienia > 0) wynik[sciezka] = trafienia;
    return;
  }
  if (drzewo && typeof drzewo === "object") {
    for (const [klucz, wartosc] of Object.entries(drzewo)) {
      zamiecFormy(wartosc, sciezka ? `${sciezka}.${klucz}` : klucz, formy, wynik);
    }
  }
}

function liczebnikTriala() {
  const slowa = LICZEBNIKI[SAAS_TRIAL_DAYS];
  if (!slowa) {
    throw new Error(
      `słownik liczebników nie zna wartości ${SAAS_TRIAL_DAYS} — po zmianie ` +
        "stałej uzupełnij słownik ORAZ treść obu wersji językowych",
    );
  }
  return slowa;
}

describe("parytet triala LP ze stałą SAAS_TRIAL_DAYS", () => {
  for (const [locale, messages] of [
    ["pl", pl],
    ["en", en],
  ] as const) {
    it(`${locale}: każda cyfrowa liczba dni w treści rozlicza się z inwentarzem ze stałej`, () => {
      const znalezione: Record<string, number[]> = {};
      zbierzDni(messages, "", znalezione);
      expect(znalezione).toEqual(INWENTARZ);
    });

    it(`${locale}: liczebniki słowne triala rozliczają się z inwentarzem słownym`, () => {
      const znalezione: Record<string, number> = {};
      zamiecFormy(messages, "", liczebnikTriala().formy, znalezione);
      expect(znalezione).toEqual(INWENTARZ_SLOWNY);
    });
  }

  it("fraza triala w FAQ jest przypięta do SAAS_TRIAL_DAYS w obu locale", () => {
    const slowa = liczebnikTriala();
    expect(pl.marketing.faq.a3).toContain(slowa.plFraza);
    expect(en.marketing.faq.a3).toContain(slowa.enFraza);
  });

  /**
   * Test-przynęta (czujnik nie jest dekoracją): skaner MUSI widzieć liczbę
   * dni w świeżym zdaniu i MUSI ignorować liczby bez markera dni — inaczej
   * `toEqual(INWENTARZ)` wyżej byłby zielony z powodu ślepoty, nie parytetu.
   */
  it("przynęta: skaner cyfr wykrywa nową liczbę dni i ignoruje liczby bez markera", () => {
    const wykryte: Record<string, number[]> = {};
    zbierzDni(
      {
        pulapkaPl: "trial 15 dni bez karty",
        pulapkaEn: "a 15-day trial, then a further 3 days",
        szum: "RFC 9116, telefon 601 234 567, 199 zł, 23% VAT",
      },
      "",
      wykryte,
    );
    expect(wykryte).toEqual({ pulapkaPl: [15], pulapkaEn: [15, 3] });
  });

  it("przynęta: zamiatanie form łapie odmiany i złożenia liczebnika triala", () => {
    const wykryte: Record<string, number> = {};
    zamiecFormy(
      {
        zlozenie: "czternastodniowy trial, a fourteen-day trial",
        szum: "cztery dni, fort days",
      },
      "",
      liczebnikTriala().formy,
      wykryte,
    );
    expect(wykryte).toEqual({ zlozenie: 2 });
  });
});
