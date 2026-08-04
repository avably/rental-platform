/**
 * KOLEJNOŚĆ SEKCJI Z SEKCJAMI PRZYPIĘTYMI (K6, ADR-092) — czyste funkcje,
 * testowalne bez DOM-u i bez bazy.
 *
 * Do K5 kolejność sekcji była zwykłą permutacją: każda sekcja mogła stanąć
 * wszędzie, a jedyną arytmetyką było `orderWithInsertedAt` w panelu. STOPKA
 * łamie to założenie — jest z definicji ostatnia. Decyzja ADR-092 brzmi
 * „przypięta, nie zwykła", więc przypięcie musi mieć MIEJSCE, w którym żyje,
 * inaczej rozjedzie się na trzy niezależne kopie reguły: płótno kreatora,
 * akcja zapisu i render.
 *
 * Ten moduł jest tym miejscem i celowo nie wie NIC o bazie ani o Reakcie.
 * Warstwy wyżej mają jeden obowiązek: przepuścić przez `normalizeSectionOrder`
 * KAŻDĄ kolejność, zanim ją zapiszą. Wtedy nawet klient, który wyśle stopkę na
 * pozycji zerowej (własnym `fetch`-em, z pominięciem interfejsu), dostanie
 * stronę ze stopką na końcu — bo normalizacja stoi po stronie serwera.
 *
 * Czego ten moduł NIE robi: nie pilnuje JEDYNOŚCI stopki. To jest niezmiennik
 * DANYCH, więc broni go baza (unikat częściowy w 0047), a nie funkcja, którą
 * wołający może pominąć.
 */

import type { SectionType } from "./index";

/**
 * Typy przypięte do KOŃCA strony. Lista, a nie `=== "footer"`, bo pytanie
 * „czy ten typ jest przypięty" pada w czterech miejscach i drugi taki typ
 * (np. pasek zgód) nie może wymagać przeszukiwania kodu.
 *
 * Przypięcie do POCZĄTKU celowo nie istnieje: hero na górze jest konwencją,
 * nie regułą — stronę można zacząć od atutów albo od katalogu.
 */
export const PINNED_LAST_TYPES = ["footer"] as const;
export type PinnedLastType = (typeof PINNED_LAST_TYPES)[number];

/** Czy sekcja tego typu jedzie zawsze na końcu strony. */
export function isPinnedLastType(type: SectionType): boolean {
  return (PINNED_LAST_TYPES as readonly string[]).includes(type);
}

/** Para (id, typ) — minimum, którego potrzebuje arytmetyka kolejności. */
export interface OrderedSection {
  id: string;
  type: SectionType;
}

/**
 * Kolejność po przypięciu: sekcje zwykłe zachowują kolejność względną, sekcje
 * przypięte lądują na końcu (też zachowując swoją kolejność względną — komplet
 * z nagrobkami może chwilowo zawierać więcej niż jedną stopkę, bo nagrobek
 * sekcji usuniętej w szkicu wciąż jest wierszem).
 *
 * Wejście `orderedIds` to ŻĄDANA kolejność, `sections` to komplet znanych par
 * (id, typ). Id spoza kompletu jest pomijane, a sekcja z kompletu nieobecna w
 * żądaniu dopisuje się na końcu swojej grupy — dzięki temu funkcja jest
 * odporna na wyścig „operator przeciąga sekcję, gdy druga karta dodała nową".
 */
export function normalizeSectionOrder(
  orderedIds: readonly string[],
  sections: readonly OrderedSection[],
): string[] {
  const typeById = new Map(sections.map((section) => [section.id, section.type]));

  const requested: string[] = [];
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!typeById.has(id) || seen.has(id)) continue;
    seen.add(id);
    requested.push(id);
  }
  // Sekcje, których żądanie nie wymieniło, dopisujemy w kolejności kompletu.
  for (const section of sections) {
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    requested.push(section.id);
  }

  const loose: string[] = [];
  const pinned: string[] = [];
  for (const id of requested) {
    const type = typeById.get(id)!;
    (isPinnedLastType(type) ? pinned : loose).push(id);
  }
  return [...loose, ...pinned];
}

/**
 * Ile jest MIEJSC WSTAWIENIA na stronie o takim składzie — czyli największy
 * dopuszczalny indeks dla nowej sekcji zwykłej.
 *
 * Na stronie bez stopki miejsc jest `length` (0 = przed pierwszą, `length` =
 * na końcu). Stopka odbiera miejsce POD sobą: gdyby operator mógł upuścić
 * sekcję pod stopką, normalizacja i tak przesunęłaby ją nad nią, a podświetlony
 * slot skłamałby o wyniku. Płótno po prostu nie rysuje slotu, którego nie
 * potrafi dotrzymać.
 */
export function insertableSlots(sections: readonly OrderedSection[]): number {
  const pinnedCount = sections.filter((section) => isPinnedLastType(section.type)).length;
  return Math.max(0, sections.length - pinnedCount);
}
