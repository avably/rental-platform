/**
 * ETYKIETY SZUFLADY LICZONE PO REJESTRZE (E4, ADR-095 — luka własnego dowodu
 * mutacyjnego M10).
 *
 * ==================== CO ZŁAPAŁA MUTACJA ====================
 *
 * Kontrakt szuflady sprawdzał, że lista rodzajów wpisu pokazuje etykiety
 * z `messages/pl.json` — i BRAŁ TE ETYKIETY Z TEGO SAMEGO PLIKU. Wyczyszczenie
 * jednej z nich przechodziło na zielono, bo razem z renderem zmieniało się
 * oczekiwanie. Test porównywał artefakt sam ze sobą.
 *
 * ==================== CO ROBI TEN PLIK ====================
 *
 * Chodzi po REJESTRZE (`STRUCTURED_SECTIONS`) i wylicza KOMPLET kluczy, o które
 * framework szuflady poprosi i18n przy każdym typie: warianty układu, pola
 * wpisu i pola sekcji, wartości list zamkniętych, przełączniki, ustawienia
 * wyglądu, zakładki szuflady dwudzielnej i komunikat limitu. Każdy z nich musi
 * ISTNIEĆ i być NIEPUSTY w OBU językach.
 *
 * Konsekwencja jest ta sama, co przy macierzy kontrastu: nowy typ strukturalny
 * (cennik, opinie, sprzęt…) wchłania się do bramki sam, a wpis rejestru bez
 * tłumaczenia nie ma jak przejść — bo w szufladzie objawiłby się gołym kluczem
 * `structured.pricing.fields.price` na ekranie operatora.
 */
import {
  STRUCTURED_SECTION_TYPES,
  structuredNewItemFor,
  structuredSpecOf,
} from "@avably/core/site";
import { describe, expect, it } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

const KATALOGI = { pl: plMessages, en: enMessages } as const;

/** Wartość spod klucza z kropkami albo `undefined`, gdy ścieżki nie ma. */
function value(messages: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        typeof node === "object" && node !== null ? (node as Record<string, unknown>)[key] : undefined,
      messages,
    );
}

/** KOMPLET kluczy, o które szuflada poprosi i18n dla danego typu. */
function keysFor(type: (typeof STRUCTURED_SECTION_TYPES)[number]): string[] {
  const spec = structuredSpecOf(type);
  const base = `site.structured.${type}`;
  const keys = [`${base}.itemsTitle`, `${base}.removeBody`];

  for (const layout of spec.layouts) keys.push(`${base}.layouts.${layout}`);
  for (const toggle of spec.toggles) keys.push(`${base}.toggles.${toggle.key}`);
  for (const choice of spec.choices) {
    keys.push(`${base}.choices.${choice.key}`);
    for (const option of choice.values) keys.push(`${base}.choiceValues.${choice.key}.${option}`);
  }
  for (const field of [...spec.itemFields, ...(spec.fields ?? [])]) {
    keys.push(`${base}.fields.${field.key}`);
    // Podpowiedź istnieje TYLKO tam, gdzie rejestr mówi, że pustka coś znaczy…
    if (field.empty === "value") keys.push(`${base}.hints.${field.key}`);
    /*
     * …ALBO tam, gdzie pole ma FORMAT, w którym da się pomylić (E6). Kwota jest
     * dziś jedynym takim polem: „120,50" i „120.50" przechodzą, „1.299,00" nie,
     * a symbol waluty w polu jest błędem — czego operator nie zgadnie z samej
     * etykiety „Cena". Podpowiedź jest więc częścią kontrolki, nie ozdobą, więc
     * jej brak w jednym języku ma palić tak samo, jak brak etykiety.
     */
    if (field.kind === "money") keys.push(`${base}.hints.${field.key}`);
    /*
     * POLE WSKAZUJĄCE ENCJĘ (faza 1b, ADR-154) — dwa zdania, których żadna
     * etykieta nie zastąpi, bo mówią o STANIE, a nie o polu:
     *   • `fieldNone` — pozycja „bez wskazania" na liście `pick`. Bez niej
     *     operator dostałby pustą opcję i musiałby zgadywać, czy to brak
     *     wyboru, czy pole bez nazwy;
     *   • `fieldEmpty` — zdanie stojące ZAMIAST kontrolki, gdy host nie ma ani
     *     jednej encji do wskazania. Pusta lista wygląda jak awaria szuflady,
     *     a operator ma się dowiedzieć, GDZIE te encje założyć.
     */
    if (field.kind === "pick") keys.push(`${base}.fieldNone.${field.key}`);
    if (field.kind === "pick" || field.kind === "pickMany") {
      keys.push(`${base}.fieldEmpty.${field.key}`);
    }
    // Lista o zamkniętym zbiorze: etykieta na każdą wartość z rejestru.
    for (const option of field.values ?? []) keys.push(`${base}.fieldValues.${field.key}.${option}`);
  }
  // Przycisk „dodaj wpis" istnieje wyłącznie tam, gdzie rejestr umie podać
  // świeży wpis (galeria rodzi wpisy z wgrania pliku).
  if (structuredNewItemFor(type, "pl") !== undefined) keys.push(`${base}.addItem`);
  // Szuflada dwudzielna nazywa swoje zakładki.
  if (spec.editor === "split") keys.push(`${base}.tabs.items`, `${base}.tabs.appearance`);
  // Typ medialny mówi, kiedy lista jest pełna.
  if (spec.itemFields.some((field) => field.kind === "image")) keys.push(`${base}.full`);
  /*
   * KOPIOWANIE WPISÓW Z INNEGO MODUŁU (E5, ADR-096) — przycisk plus TRZY powody
   * jego wyłączenia. Każdy powód jest osobnym kluczem, bo prowadzi gdzie indziej
   * („dodaj punkty w Dostawach" kontra „usuń któryś z sekcji"), a operator, który
   * widzi wyłączony przycisk bez wyjaśnienia, ma zgadywać, czego mu brakuje.
   */
  if (spec.itemsImport) {
    keys.push(
      `${base}.import.action`,
      `${base}.import.empty`,
      `${base}.import.nothingNew`,
      `${base}.import.full`,
    );
  }
  /*
   * WSKAZANIE ENCJI Z MODUŁU PANELU (E7) — selektor, przycisk, TRZY powody
   * wyłączenia (jak przy imporcie) plus zdanie o pozycji, której już nie ma.
   * To ostatnie jest osobnym kluczem, bo pojawia się w WIERSZU listy, a nie
   * pod przyciskiem: operator widzi wtedy, KTÓRE wskazanie osierociało.
   */
  if (spec.itemsPick) {
    keys.push(
      `${base}.pick.label`,
      `${base}.pick.placeholder`,
      `${base}.pick.action`,
      `${base}.pick.empty`,
      `${base}.pick.nothingNew`,
      `${base}.pick.full`,
      `${base}.pick.missing`,
    );
  }
  /*
   * LISTA BEZ SKUTKU (E7, `itemsWhen`) — zdanie stojące ZAMIAST listy w stanie,
   * w którym wybór pozycji niczego nie zmienia. Bez niego szuflada pokazywałaby
   * w tym miejscu pustkę, a operator nie miałby jak zgadnąć, co przełączyć.
   */
  if (spec.itemsWhen) keys.push(`${base}.itemsIdle`);
  /*
   * PUSTY STAN NA PŁÓTNIE (E8) — wyłącznie tam, gdzie sekcja MOŻE zostać bez
   * ani jednego wpisu, czyli tam, gdzie rejestr opuścił podłogę do zera. Typ
   * z podłogą 1 nie ma jak opustoszeć (szuflada nie usunie ostatniego wpisu,
   * a schemat nie przyjmie pustej listy), więc żądanie tych kluczy od niego
   * byłoby żądaniem tłumaczenia zdania, którego nikt nigdy nie zobaczy.
   *
   * `elsewhere` jest OSOBNYM kluczem i dokładnie tam, gdzie ma sens: przy typie
   * z `itemsWhen` pustka bywa nienaprawialna w szufladzie (sekcja sprzętu przy
   * pustym katalogu), a wtedy zdanie musi powiedzieć, GDZIE iść — jeden wspólny
   * komunikat kazałby operatorowi zgadywać, które z dwojga.
   */
  if (spec.minItems === 0) {
    keys.push(`${base}.canvasEmpty.title`, `${base}.canvasEmpty.action`);
    if (spec.itemsWhen) keys.push(`${base}.canvasEmpty.elsewhere`);
  }

  return keys;
}

describe("i18n szuflady: komplet etykiet dla KAŻDEGO typu z rejestru", () => {
  it("rejestr nie jest pusty (osłona anty-pusty-zbiór)", () => {
    expect(STRUCTURED_SECTION_TYPES.length).toBeGreaterThan(0);
    for (const type of STRUCTURED_SECTION_TYPES) {
      expect(keysFor(type).length, `typ "${type}" nie prosi o ANI JEDNĄ etykietę`).toBeGreaterThan(0);
    }
  });

  it.each(Object.keys(KATALOGI) as (keyof typeof KATALOGI)[])(
    "%s: każdy klucz istnieje i jest niepusty",
    (locale) => {
      const braki: string[] = [];
      for (const type of STRUCTURED_SECTION_TYPES) {
        for (const key of keysFor(type)) {
          const label = value(KATALOGI[locale], key);
          if (typeof label !== "string") braki.push(`${key} — brak klucza`);
          else if (label.trim() === "") braki.push(`${key} — etykieta pusta`);
        }
      }
      expect(braki, `braki w tłumaczeniach (${locale}):\n${braki.join("\n")}`).toEqual([]);
    },
  );

  it("etykiety wartości list ZAMKNIĘTYCH są RÓŻNE między sobą", () => {
    // Dwa rodzaje wpisu pod tą samą nazwą to lista, na której operator nie
    // odróżni telefonu od adresu — a wybór jest wtedy loterią.
    const kolizje: string[] = [];
    for (const type of STRUCTURED_SECTION_TYPES) {
      for (const field of structuredSpecOf(type).itemFields) {
        if (!field.values) continue;
        for (const locale of Object.keys(KATALOGI) as (keyof typeof KATALOGI)[]) {
          const etykiety = field.values.map((option) =>
            String(value(KATALOGI[locale], `site.structured.${type}.fieldValues.${field.key}.${option}`)),
          );
          if (new Set(etykiety).size !== etykiety.length) {
            kolizje.push(`${locale}/${type}/${field.key}: ${etykiety.join(", ")}`);
          }
        }
      }
    }
    expect(kolizje, `powtórzone etykiety wartości:\n${kolizje.join("\n")}`).toEqual([]);
  });
});
