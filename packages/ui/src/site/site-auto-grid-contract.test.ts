/**
 * AUTO-UKŁAD WPISÓW: JEDNA KOLUMNA NA TELEFONIE — KONTRAKT ARTEFAKTU
 * (S-16 + S-49, audyt UX 2026-08-25; aneks do ADR-085).
 *
 * ==================== WADA, KTÓRĄ TEN PLIK PILNUJE ====================
 *
 * Sufit dwóch kolumn poniżej 40 rem dawał na wąskim mobile karty po
 * ~130–160 px: tekst łamał się co jedno-dwa słowa („Sprzęt / sprawdzany po /
 * każdym najmie”), przy 360 px słowa pękały bez dywizu, a nieparzysta karta
 * raz stała na pełnej szerokości, raz na połówce z dziurą. Naprawą jest próg
 * JEDNEJ kolumny poniżej 28 rem kontenera — reguła żyje wyłącznie w arkuszu,
 * a arkusza nie da się wywołać w teście (lekcja PR #83: reguła, której nikt
 * nie sprawdza, znika przy pierwszym refaktorze arkusza bez czerwieni).
 *
 * Ten plik czyta ARTEFAKT (`site.css`) tak samo, jak `product-grid.test.ts`:
 * szuka dokładnego zapisu reguły i jej miejsca w kaskadzie. Czego NIE dowodzi:
 * jsdom nie liczy zapytań kontenera, więc prawdę wizualną (jedna kolumna na
 * 360/375/390 px) domykają zrzuty w raporcie zadania F2.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ARKUSZ = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "site.css"), "utf8");

/** Komentarze wypadają ze skanu — zdanie O regule nie jest regułą. */
const bezKomentarzy = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ");

/** Porównanie odporne na przełamania wierszy i wcięcia formattera. */
const zbite = (text: string) => bezKomentarzy(text).replace(/\s+/g, " ").trim();

/** Oczekiwany zapis progu jednej kolumny — składany, nie wklejony (kontrakt). */
const REGULA_JEDNEJ_KOLUMNY = "@container site (width < 28rem) { .site-auto-grid > * { flex-basis: 100%; } }";

/** Zapis sufitu dwóch kolumn (decyzja właściciela 2026-08-01) — kotwica kaskady. */
const SUFIT_DWOCH_KOLUMN = "@container site (width < 40rem) { .site-auto-grid > * { flex-basis: calc(";

describe("auto-układ: próg jednej kolumny STOI W ARKUSZU", () => {
  it("skan ma co czytać (kontrola pozytywna, anty-pusty-zbiór)", () => {
    expect(ARKUSZ.length).toBeGreaterThan(1_000);
    expect(ARKUSZ).toContain(".site-auto-grid");
  });

  it("poniżej 28 rem każdy wpis dostaje pełny wiersz (flex-basis: 100%)", () => {
    expect(
      zbite(ARKUSZ),
      "brak progu jednej kolumny — na 360 px wracają karty po ~130 px z pękającymi słowami",
    ).toContain(REGULA_JEDNEJ_KOLUMNY);
  });

  it("próg jednej kolumny stoi PO suficie dwóch kolumn (kaskada rozstrzyga)", () => {
    /*
     * Poniżej 28 rem prawdziwe są OBA zapytania (28 < 40), a obie reguły mają
     * tę samą specyficzność — wygrywa ta, która stoi w arkuszu PÓŹNIEJ.
     * Przestawienie bloków przywróciłoby dwie kolumny na telefonie bez
     * czerwieni w żadnym innym teście.
     */
    const arkusz = zbite(ARKUSZ);
    const sufit = arkusz.indexOf(SUFIT_DWOCH_KOLUMN);
    const jednaKolumna = arkusz.indexOf(REGULA_JEDNEJ_KOLUMNY);
    expect(sufit, "sufit dwóch kolumn zniknął z arkusza — kotwica kaskady nie istnieje").toBeGreaterThan(-1);
    expect(jednaKolumna).toBeGreaterThan(sufit);
  });

  it("sieroty: pełny wiersz ostatniej karty NIE jest osobną regułą per liczność", () => {
    /*
     * Kontrola intencji S-49: poniżej 28 rem sierota przestaje istnieć
     * Z KONSTRUKCJI (każdy wpis to pełny wiersz), a nie przez wyliczankę
     * `:nth-child` per liczność. Wyliczanka w arkuszu znaczyłaby powrót do
     * układu, który wygląda inaczej przy 3, 5 i 7 wpisach.
     */
    const blok28 = /@container site \(width < 28rem\) \{[\s\S]*?\n\}/.exec(bezKomentarzy(ARKUSZ));
    expect(blok28).not.toBeNull();
    expect(blok28![0]).not.toMatch(/nth-child/);
  });
});
