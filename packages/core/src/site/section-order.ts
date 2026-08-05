/**
 * KOLEJNOŚĆ SEKCJI Z SEKCJAMI PRZYPIĘTYMI (K6, ADR-092) — czyste funkcje,
 * testowalne bez DOM-u i bez bazy.
 *
 * Do K5 kolejność sekcji była zwykłą permutacją: każda sekcja mogła stanąć
 * wszędzie, a arytmetyka wstawienia siedziała w panelu. STOPKA
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
 * MIEJSCE WSTAWIENIA OPISANE SĄSIADEM, NIE INDEKSEM (E2).
 *
 * Kolejność po wstawieniu `newId` BEZPOŚREDNIO PRZED sekcją `beforeId`.
 * Nieznana (albo nieobecna) kotwica znaczy „na końcu" — bo dokładnie tym jest
 * „+" pod ostatnią sekcją, a także sytuacja, w której kotwica zniknęła między
 * kliknięciem a zapisem.
 *
 * Dlaczego SĄSIAD, a nie indeks: indeks jest prawdziwy wyłącznie w liście, na
 * której go policzono. Dwa zapisy w locie (dwa kliknięcia w „+" bez czekania na
 * odpowiedź) liczą go na dwóch różnych listach, więc drugi trafia obok miejsca,
 * które operator wskazał. Identyfikator sąsiada znaczy to samo w każdej wersji
 * listy — i to jest cała odporność tej ścieżki na wyścig (lekcja K6-delty,
 * ADR-092 decyzja 1b: niezmiennik należy do serwera).
 *
 * Funkcja NIE pilnuje przypięcia — od tego jest `normalizeSectionOrder`, przez
 * które wynik i tak przechodzi po drodze do zapisu.
 */
export function orderWithSectionBefore(
  orderedIds: readonly string[],
  newId: string,
  beforeId?: string,
): string[] {
  const without = orderedIds.filter((id) => id !== newId);
  const at = beforeId === undefined ? -1 : without.indexOf(beforeId);
  if (at < 0) return [...without, newId];
  return [...without.slice(0, at), newId, ...without.slice(at)];
}
