/**
 * CZY SZKIC STRONY RÓŻNI SIĘ OD TEGO, CO WIDZĄ KLIENCI (K-05, audyt UX
 * 2026-08-25) — lustro `./appearance-state.ts`, tyle że o TREŚCI, nie o wyglądzie.
 *
 * Lista stron miała dotąd jedną odznakę na dwa różne stany: „opublikowana"
 * świeciło tak samo nad stroną wypuszczoną co do przecinka i nad stroną, w
 * której operator przed chwilą przestawił pół płótna. Drugi stan jest ważniejszy
 * od pierwszego — to jedyny, w którym trzeba coś zrobić — a był NIEWIDOCZNY.
 * Operator wychodził z kreatora („Zapisano" na pasku), patrzył na listę
 * („opublikowana") i miał komplet sygnałów mówiących, że skończył. Kończył
 * z pracą, której klienci nie mają.
 *
 * ================== DLACZEGO PORÓWNANIE, A NIE ZEGAR ==================
 *
 * Kusi tu `updated_at > published_at`: `app.publish_site` stempluje OBIE
 * kolumny tą samą wartością (`v_published_at`), więc różnica wyglądałaby na
 * gotową odpowiedź. Odpada z jednego powodu: `updated_at` sekcji pisze PANEL
 * (`new Date().toISOString()` w `lib/actions/site.ts`), a `published_at` —
 * BAZA (`now()`). To dwa różne zegary. Wystarczy, że Node jest o sekundę do
 * tyłu, żeby zmiana zrobiona zaraz po publikacji dostała stempel WCZEŚNIEJSZY
 * niż publikacja i odznaka nie zapaliła się nigdy — awaria cicha, widoczna
 * dopiero jako brak zmian w sklepie.
 *
 * Porównujemy więc STAN z bliźniakiem (ADR-091), kolumna po kolumnie. Odpowiedź
 * nie zależy od żadnego zegara i jest tą samą odpowiedzią, którą przy publikacji
 * da baza.
 */

/** Wiersz `site_sections` w zakresie, który rozstrzyga o różnicy szkic ↔ żywe. */
export interface DraftSectionColumns {
  content_draft: unknown;
  /** `null` = sekcja NIGDY nie była publikowana, czyli jest czystym „plusem" szkicu. */
  content_published: unknown;
  position: number;
  position_published: number | null;
  enabled: boolean;
  enabled_published: boolean | null;
  /** Sekcja skasowana w szkicu, wciąż stojąca u klienta — zniknie przy publikacji. */
  deleted_in_draft: boolean;
}

/** Adres strony: szkic i bliźniak (0073, ADR-157). */
export interface DraftSiteColumns {
  slug: string;
  slug_published: string | null;
}

/**
 * Głębokie porównanie treści z jsonb. Klucze przychodzą z Postgresa w postaci
 * kanonicznej (jsonb sortuje je sam), więc kolejność właściwości nie ma prawa
 * wprowadzić fałszywej różnicy; mimo to porównujemy PO KLUCZACH, a nie po
 * `JSON.stringify`, bo serializacja jest odpowiedzią na inne pytanie i psuje
 * się na pierwszym `undefined`.
 */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameJson(left[key], right[key]));
}

/**
 * `true` = w szkicu tej strony czeka coś, czego klienci NIE MAJĄ.
 *
 * Wołający pyta wyłącznie o strony ŻYWE: dla roboczej pytanie nie ma sensu (nie
 * ma bliźniaka, z którym można by porównywać) i lista mówi o niej „wersja
 * robocza" — zdanie prawdziwe i wystarczające.
 */
export function draftPending(site: DraftSiteColumns, sections: readonly DraftSectionColumns[]): boolean {
  // ADRES: strona opublikowana kiedyś pod `/kontakt`, ze szkicem `/kontakty`,
  // ma zmianę czekającą na publikację tak samo jak strona ze zmienioną treścią.
  if ((site.slug_published ?? site.slug) !== site.slug) return true;

  return sections.some((section) => {
    // Sekcja skasowana w szkicu stoi jeszcze u klienta — zniknie DOPIERO przy
    // publikacji (ADR-091), więc jej obecność JEST różnicą.
    if (section.deleted_in_draft) return true;
    // Sekcja bez bliźniaka nigdy nie była publikowana: cały jej byt jest
    // różnicą, a `sameJson(x, null)` odpowiedziałoby na to samo pytanie
    // przypadkiem, a nie z konstrukcji.
    if (section.content_published === null) return true;
    if (section.position !== section.position_published) return true;
    if (section.enabled !== section.enabled_published) return true;
    return !sameJson(section.content_draft, section.content_published);
  });
}
