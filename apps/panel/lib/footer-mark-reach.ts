/**
 * GDZIE ZNAK DO STOPKI NIE WEJDZIE (ADR-167) — ŻEBY PRZEŁĄCZNIK NIE MILCZAŁ.
 *
 * ==================== DLACZEGO TO W OGÓLE ISTNIEJE ====================
 *
 * Sednem wady ADR-160 nie było to, że render czegoś nie rysował. Sednem było
 * to, że najemca miał przełącznik, który dawał się zaznaczyć, zapisać
 * i OPUBLIKOWAĆ, a nie robił nic — i ekran o tym milczał. Przełącznik bez
 * skutku jest gorszy niż jego brak, bo uczy operatora, że ustawienia bywają
 * ozdobą, i każe mu szukać winy u siebie.
 *
 * Naprawa renderu (ADR-167) zostawia JEDEN kształt stopki, do którego znak
 * dalej nie wchodzi — płótno z własnym obrazem — oraz jeden stan, w którym nie
 * ma go gdzie postawić: strona bez stopki. Ten plik zamienia oba w ZDANIE przy
 * przełączniku, z nazwą strony, której dotyczą.
 *
 * ==================== CO LICZYMY, A CZEGO NIE ====================
 *
 * Liczymy stan OPUBLIKOWANY i wyłącznie dla stron ŻYWYCH, bo pytanie brzmi
 * „gdzie klient nie zobaczy znaku". Strona w szkicu nie pokazuje klientowi
 * niczego, więc ostrzeganie o niej byłoby straszeniem na zapas — a ostrzeżenie,
 * które bywa nieprawdziwe, przestaje być czytane.
 *
 * Reguła „czy ta stopka przyjmie znak" NIE jest tu powtórzona: przychodzi
 * z rdzenia (`footerAcceptsMark`), z tej samej funkcji, którą stosuje render
 * sklepu. Dwie kopie reguły to dwie okazje, żeby ekran obiecał co innego, niż
 * robi strona — czyli ta sama wada, tylko odwrócona.
 */
import { footerAcceptsMark } from "@avably/core/site";

/** Dlaczego znak nie wejdzie do stopki tej strony. */
export type FooterMarkGapReason =
  /** Strona nie ma opublikowanej stopki — nie ma czego znakiem uzupełnić. */
  | "noFooter"
  /** Stopka na płótnie niesie WŁASNY obraz — znak byłby przy nim drugim. */
  | "ownImage";

export interface FooterMarkGap {
  /** Nazwa strony, tak jak widzi ją operator na liście. */
  page: string;
  reason: FooterMarkGapReason;
}

export interface FooterMarkPage {
  id: string;
  name: string;
  /** Czy klienci ją widzą (`sites.published_at is not null`). */
  live: boolean;
}

export interface FooterMarkSection {
  site_id: string;
  /** Treść OPUBLIKOWANEJ stopki — surowy `jsonb`, bez schematu. */
  content_published: unknown;
}

/**
 * Strony, na których znak do stopki nie dotrze. Pusta lista = przełącznik
 * działa wszędzie i ekran nie ma o czym mówić.
 *
 * Wejściem są sekcje JUŻ ZAWĘŻONE do opublikowanych stopek (`type = 'footer'`,
 * `enabled_published`, `content_published is not null`) — dokładnie ten sam
 * zbiór, który wypuszcza `app.get_published_page`. Zawężenie robi zapytanie,
 * a nie ta funkcja, żeby dało się ją sprawdzić bez bazy.
 */
export function footerMarkGaps(
  pages: readonly FooterMarkPage[],
  footers: readonly FooterMarkSection[],
): FooterMarkGap[] {
  const bySite = new Map(footers.map((section) => [section.site_id, section]));
  const gaps: FooterMarkGap[] = [];

  for (const page of pages) {
    if (!page.live) continue;
    const footer = bySite.get(page.id);
    if (!footer) {
      gaps.push({ page: page.name, reason: "noFooter" });
      continue;
    }
    if (!footerAcceptsMark(footer.content_published)) {
      gaps.push({ page: page.name, reason: "ownImage" });
    }
  }

  return gaps;
}
