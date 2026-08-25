/**
 * CENNIK I OPINIE — KONTRAKT MODELU (E6, aneks ADR-094).
 *
 * ==================== CO TU JEST BRONIONE ====================
 *
 *   1. KWOTA POD KLAWISZAMI. Parser kwoty stoi między tym, co operator wpisał,
 *      a tym, co zobaczy klient. Pomyłka o rząd wielkości jest tu najtańsza
 *      do popełnienia i najdroższa w skutkach, więc granice („1.299,00" nie
 *      przechodzi, „12,05" daje 1205, nie 1204) są zdaniami, a nie intencją.
 *   2. KONWERSJA PRZENOSI KOLEJNOŚĆ, NIE TYLKO LICZBĘ. Test liczący WPISY
 *      przechodzi na zielono przy konwersji, która je przetasowała — a opinia
 *      podpisana cudzym nazwiskiem jest gorsza niż opinia zgubiona.
 *   3. CENNIK NIE WYMYŚLA CEN. Stara treść cennika ich NIE MA (v1 to
 *      `{ heading?, note? }`), więc konwersja przenosi nagłówek i przypis,
 *      a pozycje bierze z presetu — nigdy z rozbioru zdania operatora.
 */
import { describe, expect, it } from "vitest";

import { formatMoneyAmount, parseMoneyAmount } from "../money";
import { sectionCanvasFrom } from "./canvas-presets";
import {
  pricingHeadAndNoteFromLegacy,
  pricingPriceLabel,
  pricingStructuredSchema,
  structuredFromLegacy,
  structuredPresetFor,
  testimonialsFromLegacy,
  testimonialsStructuredSchema,
  type PricingStructuredContent,
  type TestimonialsStructuredContent,
} from "./structured";

describe("KWOTA POD KLAWISZAMI: parser i zapis pola edycji", () => {
  it.each([
    ["120", 12_000],
    ["120,50", 12_050],
    ["120.50", 12_050],
    ["0", 0],
    ["0,05", 5],
    ["1299", 129_900],
    /*
     * ZAOKRĄGLENIE, NIE OBCIĘCIE — i to są przypadki, na których różnicę
     * naprawdę widać. `2.01 * 100` daje w arytmetyce zmiennoprzecinkowej
     * 200.99999999999997, więc `Math.trunc` zrobiłby z dwóch złotych JEDNEGO
     * GROSZA równe dwa złote. Wartość myląco „okrągła" (12,05) tego NIE
     * pokazuje: tam iloczyn wypada powyżej liczby całkowitej i obcięcie
     * przechodzi na zielono — pierwsza wersja tego testu stała właśnie na niej
     * i mutacja `Math.round` → `Math.trunc` przeżyła cały pakiet.
     */
    ["2,01", 201],
    ["0,29", 29],
    ["1,13", 113],
    // Spacja NIEŁAMLIWA (U+00A0 i U+202F) — tak separator tysięcy wkleja się
    // razem z kwotą skopiowaną ze strony dostawcy.
    ["1\u00A0299,00", 129_900],
    ["1\u202F299,00", 129_900],
  ])("„%s” → %i groszy", (wejscie, oczekiwane) => {
    expect(parseMoneyAmount(wejscie, "PLN")).toBe(oczekiwane);
  });

  it.each([
    ["", "pustka to nie zero — zero jest decyzją, a pustka brakiem decyzji"],
    ["120,", "operator jest w połowie pisania"],
    ["120,555", "trzy miejsca po przecinku — grosz jest niepodzielny"],
    ["1.299,00", "dwa separatory naraz — który był tysiącem, to zgadywanie"],
    ["-120", "cena ujemna nie jest ceną, tylko rabatem, którego model nie zna"],
    ["120 zł", "symbol waluty w polu kwoty"],
    ["sto", "to nie jest liczba"],
    ["12e3", "zapis wykładniczy — 12000 czy 12? nie zgadujemy"],
  ])("„%s” NIE JEST kwotą (%s)", (wejscie) => {
    expect(parseMoneyAmount(wejscie, "PLN")).toBeNull();
  });

  it("zapis pola edycji NIE MA separatora tysięcy ani symbolu waluty", () => {
    /*
     * Pole edycji wypełnia wartość, która zaraz wróci do parsera. Odstęp
     * tysięcy zrobiłby z „1 299,00" wejście, które po jednej poprawce
     * przestaje być liczbą — a operator nie ma jak zgadnąć, że spacja była
     * naszym pomysłem, a nie jego literówką.
     */
    const zapis = formatMoneyAmount(129_900, "PLN", "pl");
    expect(zapis).toBe("1299,00");
    expect(parseMoneyAmount(zapis, "PLN"), "własny zapis nie przechodzi własnego parsera").toBe(129_900);
    expect(formatMoneyAmount(129_900, "PLN", "en"), "separator dziesiętny nie poszedł za locale").toBe(
      "1299.00",
    );
  });
});

describe("ETYKIETA CENY składa się z kwoty, przedrostka i jednostki", () => {
  const pozycja = { name: "Namiot", price_grosze: 6_000, unit: "day" as const, mode: "exact" as const };

  it("cena dokładna: kwota z formattera + jednostka z języka strony", () => {
    const etykieta = pricingPriceLabel(pozycja, "PLN", "pl", { from: "od", unit: "doba" });
    expect(etykieta).toContain("60,00");
    expect(etykieta).toContain("doba");
    expect(etykieta, "przedrostek dołożony bez decyzji najemcy").not.toContain("od ");
  });

  it("cena wyjściowa: TEN SAM wpis z `mode: from` dostaje przedrostek", () => {
    const etykieta = pricingPriceLabel({ ...pozycja, mode: "from" }, "PLN", "pl", {
      from: "od",
      unit: "doba",
    });
    expect(etykieta.startsWith("od ")).toBe(true);
  });

  it("waluta i locale są DANYMI — ta sama treść, dwa zapisy", () => {
    const pl = pricingPriceLabel(pozycja, "PLN", "pl", { from: "od", unit: "doba" });
    const en = pricingPriceLabel(pozycja, "EUR", "en", { from: "from", unit: "day" });
    expect(pl).not.toEqual(en);
    expect(en).toContain("60.00");
    expect(en, "waluta zaszyta w kodzie zamiast wziętej z argumentu").not.toContain("zł");
  });
});

describe("KONWERSJA OPINII przenosi KOLEJNOŚĆ, nie tylko liczbę", () => {
  /** Cztery opinie o ROZRÓŻNIALNEJ treści — bez tego przetasowanie jest niewidoczne. */
  const V1 = {
    heading: "Co mówią klienci",
    items: [
      { quote: "Pierwsza opinia.", author: "Autor A", role: "Rola A" },
      { quote: "Druga opinia.", author: "Autor B" },
      { quote: "Trzecia opinia.", author: "Autor C", role: "Rola C" },
      { quote: "Czwarta opinia.", author: "Autor D" },
    ],
  };

  it("v1 → v3: wpisy jadą CO DO JEDNEGO i W TEJ SAMEJ KOLEJNOŚCI", () => {
    const items = testimonialsFromLegacy(V1);
    expect(items).toHaveLength(4);
    expect(
      items.map((item) => item.quote),
      "konwersja przetasowała opinie — podpis trafi pod cudzą wypowiedź",
    ).toEqual(["Pierwsza opinia.", "Druga opinia.", "Trzecia opinia.", "Czwarta opinia."]);
    expect(items.map((item) => item.author)).toEqual(["Autor A", "Autor B", "Autor C", "Autor D"]);
    expect(items.map((item) => item.role)).toEqual(["Rola A", undefined, "Rola C", undefined]);
  });

  it("PŁÓTNO v2 → v3: para (cytat, podpis) z wariantów, w kolejności CZYTANIA", () => {
    /*
     * Płótno powstaje NASZĄ konwersją v1→v2, więc cytat jest tekstem wariantu
     * `lead`, a podpis następującym po nim `small`. Rozdzielenie podpisu na
     * autora i rolę jest odwróceniem naszego własnego sklejania („A — B"),
     * a nie interpretacją cudzego zdania.
     */
    const canvas = sectionCanvasFrom("testimonials", V1);
    const items = testimonialsFromLegacy(canvas);

    expect(items.map((item) => item.quote)).toEqual([
      "Pierwsza opinia.",
      "Druga opinia.",
      "Trzecia opinia.",
      "Czwarta opinia.",
    ]);
    expect(items.map((item) => item.author)).toEqual(["Autor A", "Autor B", "Autor C", "Autor D"]);
    expect(items.map((item) => item.role)).toEqual(["Rola A", undefined, "Rola C", undefined]);
  });

  it("wynik konwersji SPEŁNIA SCHEMAT i zachowuje nagłówek", () => {
    const wynik = structuredFromLegacy("testimonials", V1, "pl") as TestimonialsStructuredContent;
    expect(testimonialsStructuredSchema.safeParse(wynik).success).toBe(true);
    expect(wynik.heading).toBe("Co mówią klienci");
    expect(wynik.items).toHaveLength(4);
  });

  it("opinia BEZ PODPISU nie wchodzi — nie wymyślamy, kto to powiedział", () => {
    const items = testimonialsFromLegacy({
      items: [
        { quote: "Anonimowa pochwała." },
        { quote: "Z podpisem.", author: "Autor B" },
      ],
    });
    expect(items.map((item) => item.author)).toEqual(["Autor B"]);
  });

  it("brak opinii = brak konwersji (degradacja do presetu, nie pusta sekcja)", () => {
    expect(testimonialsFromLegacy({ items: [] })).toEqual([]);
    const wynik = structuredFromLegacy("testimonials", { items: [] }, "pl");
    expect(wynik).toEqual(structuredPresetFor("testimonials", "pl"));
  });
});

describe("KONWERSJA CENNIKA nie wymyśla cen", () => {
  it("v1 (`{heading, note}`) → v3: jadą OBA napisy, pozycje z presetu", () => {
    const wynik = structuredFromLegacy(
      "pricing",
      { heading: "Nasze stawki", note: "Ceny netto, kaucja osobno." },
      "pl",
    ) as PricingStructuredContent;

    expect(pricingStructuredSchema.safeParse(wynik).success).toBe(true);
    expect(wynik.heading).toBe("Nasze stawki");
    expect(wynik.footnote).toBe("Ceny netto, kaucja osobno.");
    // Pozycje SĄ (schemat wymaga co najmniej jednej) i są dokładnie presetowe:
    // rozbiór zdania operatora na nazwy i kwoty byłby wymyślaniem cen.
    const preset = structuredPresetFor("pricing", "pl") as PricingStructuredContent;
    expect(wynik.items).toEqual(preset.items);
  });

  it("JĘZYK sekcji rządzi pozycjami startowymi (konwersja zna locale)", () => {
    const wynik = structuredFromLegacy("pricing", { heading: "Our rates" }, "en") as PricingStructuredContent;
    const presetEn = structuredPresetFor("pricing", "en") as PricingStructuredContent;
    expect(
      wynik.items,
      "angielski sklep dostał po konwersji polskie pozycje startowe",
    ).toEqual(presetEn.items);
  });

  it("PŁÓTNO v2 → v3: nagłówek i przypis w kolejności CZYTANIA płótna", () => {
    const canvas = sectionCanvasFrom("pricing", {
      heading: "Cennik 2026",
      note: "Ceny obowiązują do końca sezonu.",
    });
    expect(pricingHeadAndNoteFromLegacy(canvas)).toEqual({
      heading: "Cennik 2026",
      footnote: "Ceny obowiązują do końca sezonu.",
    });
  });

  it("stara sekcja PUSTA = brak konwersji, czyli czysty preset", () => {
    expect(pricingHeadAndNoteFromLegacy({})).toEqual({});
    expect(structuredFromLegacy("pricing", {}, "pl")).toEqual(structuredPresetFor("pricing", "pl"));
  });
});

describe("SCHEMAT CENNIKA broni kwoty przed kształtem, którego nie da się zapłacić", () => {
  const bazowa = structuredPresetFor("pricing", "pl") as PricingStructuredContent;
  const zCena = (price_grosze: unknown) =>
    pricingStructuredSchema.safeParse({
      ...bazowa,
      items: [{ name: "Pozycja", price_grosze, unit: "day", mode: "exact" }],
    }).success;

  it.each([
    [12_000, true],
    [0, true],
    [100_000_000, true],
    [12.5, false],
    [-1, false],
    [100_000_001, false],
    ["12000", false],
  ])("cena %s → poprawna: %s", (wartosc, oczekiwane) => {
    expect(zCena(wartosc)).toBe(oczekiwane);
  });

  it("jednostka spoza słownika nie przechodzi (render nie zna jej nazwy)", () => {
    expect(
      pricingStructuredSchema.safeParse({
        ...bazowa,
        items: [{ name: "Pozycja", price_grosze: 1, unit: "fortnight", mode: "exact" }],
      }).success,
    ).toBe(false);
  });
});

describe("ATOMOWOŚĆ FRAZY CENY — token „kwota / jednostka” bez łamania (S-40)", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ (audyt UX 2026-08-25): przy 360 px fraza łamała
  // się na „od 920,00 zł /” + „doba” (wiszący ukośnik, samotna jednostka),
  // w cenniku na TRZY linie — cena przestawała być skanowalna jednym rzutem.
  const pozycja = { name: "Namiot", price_grosze: 92_000, unit: "day" as const, mode: "from" as const };

  it("ukośnik wiąże się z kwotą i jednostką TWARDĄ spacją (U+00A0)", () => {
    const etykieta = pricingPriceLabel(pozycja, "PLN", "pl", { from: "od", unit: "doba" });
    expect(etykieta).toContain("\u00A0/\u00A0doba");
    // Kontrola negatywna: łamliwy zapis „ / ” (zwykłe spacje) nie ma prawa
    // wrócić — to dokładnie miejsce, w którym fraza pękała.
    expect(etykieta, "zwykła spacja przy ukośniku — fraza znowu pęknie w środku").not.toMatch(/ \/|\/ /);
  });

  it("po przedrostku „od” zostaje ZWYKŁA spacja — wiersz może się złamać PRZED frazą", () => {
    /*
     * Pełna atomowość całej etykiety to druga strona tej samej wady (S-12):
     * nierozrywalny pasek „od 920,00 zł / doba” rozpycha wąskie kontenery
     * i wypycha stronę poziomo. Twardy jest TOKEN, nie cała etykieta.
     */
    const etykieta = pricingPriceLabel(pozycja, "PLN", "pl", { from: "od", unit: "doba" });
    expect(etykieta.startsWith("od ")).toBe(true);
    expect(etykieta.charAt(2)).toBe(" ");
  });

  it("cena dokładna: sam token, wciąż atomowy", () => {
    const etykieta = pricingPriceLabel({ ...pozycja, mode: "exact" }, "EUR", "en", {
      from: "from",
      unit: "day",
    });
    expect(etykieta).toContain("\u00A0/\u00A0day");
    expect(etykieta.startsWith("from")).toBe(false);
  });
});
