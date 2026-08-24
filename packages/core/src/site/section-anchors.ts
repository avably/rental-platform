/**
 * KOTWICE SEKCJI — CEL, KTÓRY MA `#produkty` I `#kontakt`.
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Presety sekcji (ADR-082) i szablony startowe (ADR-090) od początku wpisują
 * w przyciski adresy kotwic: hero prowadzi na `#produkty`, stopka na
 * `#kontakt`. Render owijał sekcję w `<div data-section-id>` — czyli w kotwicę
 * DLA KODU (płótno kreatora po niej znajduje sekcję), nigdy w kotwicę DLA
 * DOKUMENTU. Kotwica HTML to atrybut `id`, a tego nie wystawiał nikt, więc na
 * opublikowanej stronie te przyciski nie robiły NIC: przeglądarka nie ma czego
 * znaleźć, adres w pasku się nie zmienia, strona stoi.
 *
 * Awaria była cicha z dwóch powodów naraz. Po pierwsze martwy odnośnik nie
 * rzuca błędem — ani w konsoli, ani w logu serwera. Po drugie w kreatorze
 * kliknięcia i tak są przechwytywane przez warstwę edycyjną, więc operator,
 * który „sprawdził, czy działa", sprawdził coś innego.
 *
 * ==================== DLACZEGO REJESTR, A NIE `id={section.id}` ====================
 *
 * Najprostsze wyjście — wystawić jako `id` identyfikator wiersza — daje kotwice
 * poprawne i BEZUŻYTECZNE: `#a3f1c2e4-…` jest nie do wpisania w przycisk,
 * zmienia się przy każdym odtworzeniu sekcji i nie ma go jak nazwać w interfejsie.
 * Adres kotwicy musi być STABILNY i przewidywalny, bo wpisuje go człowiek
 * (dziś w treści presetu, jutro w polu „adres przycisku"), a wpisuje go ZANIM
 * sekcja docelowa powstanie.
 *
 * Stąd rejestr po TYPIE sekcji: typów jest zamknięta lista (patrz
 * `SECTION_TYPES`), więc zbiór adresów jest skończony, znany z góry i taki sam
 * na każdej stronie w produkcie.
 *
 * ==================== TO SĄ IDENTYFIKATORY, NIE TEKST ====================
 *
 * Nazwy są polskie, bo takie już stoją w treści (`#produkty`, `#kontakt`) —
 * także w szablonach angielskich, gdzie przycisk mówi „Browse catalog", a
 * prowadzi na `#produkty`. To nie jest niedoróbka do naprawienia tłumaczeniem:
 * kotwica jest IDENTYFIKATOREM, tak jak nazwa typu sekcji jest identyfikatorem
 * (`products`, nie „sprzęt"). Tłumaczenie kotwic znaczyłoby, że ten sam
 * przycisk prowadzi gdzie indziej w zależności od języka strony, a treść
 * najemcy — która te adresy niesie — nie ma po swojej stronie żadnej warstwy,
 * która by je przepisała.
 *
 * Z tego samego powodu wartości niżej są ZAMROŻONE. Zmiana nazwy kotwicy nie
 * jest zmianą tekstu, tylko zerwaniem odnośników na stronach, które już są
 * opublikowane — razem z adresami, które ktoś zdążył gdzieś wkleić.
 *
 * ==================== JEDNA KOTWICA NA TYP, PIERWSZA WYGRYWA ====================
 *
 * Strona może mieć DWIE sekcje tego samego typu (dwa pasma atutów, cennik nad
 * i pod katalogiem). Identyfikator w dokumencie musi być JEDEN — duplikat `id`
 * to niepoprawny HTML, a przeglądarki i tak skaczą do pierwszego. Kotwicę
 * dostaje więc pierwsza sekcja danego typu w kolejności strony
 * ({@link sectionAnchorIds}), a reszta nie dostaje jej wcale. Rozstrzygnięcie
 * jest tutaj, a nie w rendererze, bo pytanie „która sekcja niesie `#cennik`"
 * pada także poza Reactem (przyszły wybór celu przycisku w kreatorze).
 */
import type { SectionType } from "./index";

/**
 * Adres kotwicy per typ sekcji. Komplet jest wymuszony typem `Record` — nowy
 * typ sekcji nie skompiluje się bez wpisu tutaj, a to jest dokładnie ten moment,
 * w którym ktoś ma zdecydować, jak nazywa się miejsce na stronie.
 *
 * Dwa wpisy są SĄDEM o zastosowaniu, nie tłumaczeniem nazwy typu, i dlatego
 * stoją z uzasadnieniem: `freeform` (sekcja dowolnej treści) to w wypożyczalni
 * prawie zawsze „o nas", a `cta` (pasmo domykające) — zachęta do rezerwacji.
 * Nazwa kotwicy ma być czytelna dla najemcy wpisującego ją w przycisk, a
 * `#freeform` i `#cta` są żargonem naszego modelu danych, nie nazwą miejsca.
 */
export const SECTION_ANCHORS: Record<SectionType, string> = {
  hero: "start",
  products: "produkty",
  categories: "kategorie",
  pricing: "cennik",
  faq: "pytania",
  contact: "kontakt",
  freeform: "o-nas",
  testimonials: "opinie",
  gallery: "galeria",
  usp: "atuty",
  cta: "rezerwacja",
  directions: "dojazd",
  delivery: "dostawa",
  footer: "stopka",
};

/**
 * Adres kotwicy w postaci, w jakiej wpisuje się go w przycisk (`#produkty`).
 * Osobna funkcja, żeby krzyżyk nie był doklejany w pięciu miejscach — a przy
 * okazji jest to jedyne miejsce, które trzeba przeczytać, gdy ktoś zapyta,
 * czy adres kotwicy niesie ze sobą znak `#`, czy nie.
 */
export function sectionAnchorHref(type: SectionType): string {
  return `#${SECTION_ANCHORS[type]}`;
}

/**
 * Kotwice DLA KONKRETNEJ STRONY: id sekcji → nazwa kotwicy, wyłącznie dla
 * PIERWSZEJ sekcji każdego typu (patrz nagłówek pliku).
 *
 * Wejście jest w kolejności strony — tej samej, w której wołający renderuje
 * sekcje. Funkcja niczego nie sortuje: „pierwsza" znaczy pierwsza NA STRONIE,
 * a nie pierwsza po `position`, bo to renderujący zna kolejność ostateczną
 * (stopka jest przypięta do końca — patrz `./section-order`).
 */
export function sectionAnchorIds(
  sections: readonly { id: string; type: SectionType }[],
): Map<string, string> {
  const anchors = new Map<string, string>();
  const taken = new Set<SectionType>();

  for (const section of sections) {
    if (taken.has(section.type)) continue;
    taken.add(section.type);
    anchors.set(section.id, SECTION_ANCHORS[section.type]);
  }

  return anchors;
}
