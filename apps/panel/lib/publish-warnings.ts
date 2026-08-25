/**
 * OSTRZEŻENIA PRZED PUBLIKACJĄ STRONY (K-13/K-14, audyt UX 2026-08-25).
 *
 * Okno publikacji mówiło dotąd WYŁĄCZNIE o zasięgu: co zobaczą klienci i pod
 * jakim adresem. O tym, CO dokładnie wychodzi, nie mówiło nic — więc szablon
 * z nietkniętym „Napisz kilka zdań o swojej wypożyczalni…" i kafel zdjęcia bez
 * zdjęcia jechały do sklepu tak samo cicho, jak strona dopracowana. Najemca
 * dowiadywał się o tym od klienta.
 *
 * ================== OSTRZEŻENIE, A NIE BRAMKA ==================
 *
 * Żadne z tych wykryć NIE blokuje publikacji i blokować nie może: „sekcja
 * z treścią przykładową" bywa świadomym etapem pracy (najemca wypuszcza szkielet
 * i dopisuje treść wieczorem), a interfejs, który zabrania czegoś legalnego,
 * uczy obchodzenia siebie. Okno pokazuje listę i zostawia przycisk aktywny —
 * zmienia się jego napis, nie jego dostępność.
 *
 * ================== DLACZEGO KODY, A NIE ZDANIA ==================
 *
 * Funkcja jest CZYSTA i nie zna języka operatora: oddaje kody z licznikami,
 * a zdania składa okno (i18n PL+EN, ADR-253). Dzięki temu ten sam wynik obsługuje
 * dwie powierzchnie — kreator (liczy ze szkicu w edytorze) i listę stron (liczy
 * z odczytu bazy) — i obie mówią o publikacji DOKŁADNIE to samo. Rozjazd między
 * nimi byłby tą samą wadą, którą przy samym oknie zamknął ADR-093 (jeden
 * `PublishDialog` na obie drogi).
 *
 * ================== CZEGO TU CELOWO NIE MA ==================
 *
 * „ELEMENTY NIEWIDOCZNE NA MOBILE" (podpunkt warunkowy findingu K-14) —
 * SPRAWDZONE I ODRZUCONE, bo ten stan jest NIEREPREZENTOWALNY. `mobileLayoutOf`
 * podnosi wysokość płótna telefonu do najniższej ręcznej poprawki (`cursor =
 * max(cursor, manual.y + manual.h)`), a jego sufit `SECTION_MAX_ROWS_MOBILE`
 * (2127) jest DOKŁADNIE tą samą liczbą, co `GEOMETRY_MAX_ROWS` w schemacie
 * geometrii — więc pudełko, które dałoby się zapisać, zawsze mieści się na
 * płótnie, które pod nie urośnie. Ostrzeżenie o tym stanie byłoby ostrzeżeniem
 * o czymś, co nie może zajść: martwym kodem udającym bramkę.
 *
 * „PUSTY TEKST" z listy findingów nie jest reprezentowalny: schemat treści
 * wymaga `min(1)` po `trim()` dla nagłówka, akapitu, etykiety przycisku i opisu
 * alternatywnego (`elements.ts`), więc element z pustym napisem nie przeszedłby
 * zapisu. Jego prawdziwym odpowiednikiem jest element, który został przy
 * TREŚCI STARTOWEJ z palety („Nowy nagłówek", „Kliknij, żeby napisać własny
 * tekst.") — i to on jest liczony. Zbiór tych napisów nie jest tu przepisany
 * ręcznie: powstaje z `createElement`, czyli z tego samego źródła, z którego
 * bierze go paleta — kopia literałów rozjechałaby się przy pierwszej zmianie
 * copy i ostrzeżenie zgasłoby po cichu.
 */
import {
  PALETTE_ELEMENT_KINDS,
  PRESET_LOCALES,
  createElement,
  isSectionCanvas,
  isStructuredSection,
  isStructuredType,
  normalizeImageSource,
  presetContentFor,
  sectionCanvasFrom,
  structuredPresetFor,
  type SectionType,
} from "@avably/core/site";

export type PublishWarningCode =
  /** Sekcja stoi na treści z presetu — nikt jej nie tknął. */
  | "sampleSection"
  /** Element zdjęcia bez wskazanego zdjęcia (kafel zastępczy). */
  | "emptyImage"
  /** Element z treścią startową z palety („Nowy nagłówek"). */
  | "placeholderElement";

export interface PublishWarning {
  code: PublishWarningCode;
  /** Ile razy — okno wymienia liczbę, bo „jedna sekcja" i „sześć" to inna decyzja. */
  count: number;
}

/** Sekcja do zbadania — tyle, ile trzeba, żeby odpowiedzieć na cztery pytania. */
export interface PublishWarningSection {
  type: SectionType;
  /**
   * Sekcja WYŁĄCZONA nie jedzie do klienta, więc jej treść nie jest niczyim
   * problemem. Liczenie jej byłoby ostrzeżeniem o czymś, czego publikacja nie
   * wypuszcza — a ostrzeżenie bez pokrycia uczy ignorować całą listę.
   */
  enabled: boolean;
  /** Treść w DOWOLNEJ generacji (v1, płótno v2, sekcja strukturalna v3). */
  content: unknown;
}

/** Kolejność wyliczenia w oknie — od wady najbardziej widocznej dla klienta. */
const ORDER: readonly PublishWarningCode[] = ["sampleSection", "emptyImage", "placeholderElement"];

/**
 * Wszystkie napisy z dowolnej struktury treści. Chodzi o PORÓWNANIE z presetem,
 * a nie o render, więc zbieramy każdy string — klucz `heading`, `body`, tekst
 * elementu płótna i wpis listy strukturalnej znaczą tu tyle samo.
 */
function stringsOf(value: unknown, sink: Set<string>): Set<string> {
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length > 0) sink.add(text);
    return sink;
  }
  if (Array.isArray(value)) {
    for (const item of value) stringsOf(item, sink);
    return sink;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringsOf(item, sink);
  }
  return sink;
}

/**
 * Napisy PRZYKŁADOWE danego typu sekcji — we WSZYSTKICH językach presetów i we
 * wszystkich generacjach, w których ta sama treść może leżeć w bazie.
 *
 * Dwa języki, bo preset powstaje w języku operatora Z CHWILI dodania sekcji,
 * a porównanie odbywa się później i bywa w drugim: sekcja dodana po polsku
 * i oglądana po angielsku dalej jest sekcją nietkniętą.
 *
 * Trzy generacje, bo sekcja v1 konwertuje się do płótna przy pierwszej edycji
 * geometrii, a jej NAPISY zostają dokładnie te same — porównanie tylko z v1
 * przestawałoby widzieć przykład natychmiast po przesunięciu czegokolwiek.
 */
const sampleCache = new Map<SectionType, Set<string>>();

function sampleStrings(type: SectionType): Set<string> {
  const cached = sampleCache.get(type);
  if (cached) return cached;

  const sink = new Set<string>();
  for (const locale of PRESET_LOCALES) {
    const preset = presetContentFor(type, locale);
    stringsOf(preset, sink);
    stringsOf(sectionCanvasFrom(type, preset), sink);
    if (isStructuredType(type)) stringsOf(structuredPresetFor(type, locale), sink);
  }
  sampleCache.set(type, sink);
  return sink;
}

/** Napisy, z którymi rodzi się element wyjęty z palety — patrz nagłówek pliku. */
let startCopyCache: Set<string> | null = null;

function startCopy(): Set<string> {
  if (startCopyCache) return startCopyCache;
  const sink = new Set<string>();
  const geometry = { x: 0, y: 0, w: 10, h: 10, z: 0 };
  for (const locale of PRESET_LOCALES) {
    for (const kind of PALETTE_ELEMENT_KINDS) {
      const element = createElement(kind, "wzorzec", geometry, locale);
      if ("text" in element && typeof element.text === "string") sink.add(element.text.trim());
      if ("label" in element && typeof element.label === "string") sink.add(element.label.trim());
      if ("alt" in element && typeof element.alt === "string") sink.add(element.alt.trim());
    }
  }
  startCopyCache = sink;
  return sink;
}

/**
 * Lista ostrzeżeń dla kompletu sekcji, które publikacja wypuści. Pusta tablica
 * znaczy „nie mam nic do powiedzenia" — i wtedy okno nie rysuje sekcji ostrzeżeń
 * w ogóle, zamiast pokazywać nagłówek nad pustką.
 */
export function publishWarnings(sections: readonly PublishWarningSection[]): PublishWarning[] {
  const counts = new Map<PublishWarningCode, number>();
  const bump = (code: PublishWarningCode) => counts.set(code, (counts.get(code) ?? 0) + 1);

  const starters = startCopy();

  for (const section of sections) {
    if (!section.enabled) continue;

    // 1. TREŚĆ PRZYKŁADOWA: każdy napis sekcji pochodzi z presetu jej typu.
    //    Warunek jest CAŁOŚCIOWY, a nie „zawiera choć jeden": nagłówek
    //    „Kontakt" zostaje „Kontaktem" także na dopracowanej stronie, więc
    //    pojedyncze trafienie oskarżałoby sekcje, których nikt nie zaniedbał.
    const texts = stringsOf(section.content, new Set<string>());
    if (texts.size > 0) {
      const sample = sampleStrings(section.type);
      if ([...texts].every((text) => sample.has(text))) bump("sampleSection");
    }

    if (!isSectionCanvas(section.content)) {
      // Sekcja strukturalna i zastana nie mają elementów płótna — trzy
      // pozostałe pytania nie mają w nich przedmiotu.
      if (isStructuredSection(section.content)) continue;
      continue;
    }

    const canvas = section.content;
    for (const element of canvas.elements) {
      // 2. KAFEL ZASTĘPCZY ZAMIAST ZDJĘCIA. Element związany ze zdjęciem
      //    sprzętu (`bindings.source`) zdjęcie DOSTANIE przy renderze, więc
      //    brak własnego źródła nie jest tam wadą.
      if (
        element.kind === "image" &&
        !normalizeImageSource(element) &&
        !element.bindings?.source
      ) {
        bump("emptyImage");
      }

      // 3. TREŚĆ STARTOWA Z PALETY — element dołożony i nietknięty.
      const own =
        element.kind === "heading" || element.kind === "text"
          ? element.text
          : element.kind === "button"
            ? element.label
            : null;
      if (own !== null && starters.has(own.trim())) bump("placeholderElement");
    }
  }

  return ORDER.filter((code) => (counts.get(code) ?? 0) > 0).map((code) => ({
    code,
    count: counts.get(code)!,
  }));
}
