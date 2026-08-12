import { describe, expect, it } from "vitest";

import { RESERVED_CATEGORY_SLUGS } from "../catalog/categories";
import {
  HOME_PAGE_SLUG,
  INTERNAL_PAGE_PREFIX,
  PAGE_SLUG_MAX_LENGTH,
  PAGE_SLUG_PATTERN,
  RESERVED_PAGE_SLUGS,
  internalPagePathname,
  isReservedPageSlug,
  isValidPageSlug,
  pagePathFromSlug,
  suggestPageSlug,
} from "./page-slug";

describe("normalizacja nazwy strony na slug", () => {
  it("NORMALIZUJE polskie znaki zamiast odrzucać wejście", () => {
    expect(suggestPageSlug("Rowery górskie")).toBe("rowery-gorskie");
    expect(suggestPageSlug("Łódki i kajaki")).toBe("lodki-i-kajaki");
    expect(suggestPageSlug("Zażółć gęślą jaźń")).toBe("zazolc-gesla-jazn");
  });

  it("zbija znaki specjalne i białe znaki do pojedynczych myślników", () => {
    expect(suggestPageSlug("  Jak działa   wynajem?  ")).toBe("jak-dziala-wynajem");
    expect(suggestPageSlug("Wynajem — Kraków / Nowa Huta")).toBe("wynajem-krakow-nowa-huta");
  });

  it("nie zostawia myślnika na końcu po przycięciu do limitu", () => {
    const name = `${"a".repeat(PAGE_SLUG_MAX_LENGTH - 1)} bcd`;
    const slug = suggestPageSlug(name);
    expect(slug.length).toBeLessThanOrEqual(PAGE_SLUG_MAX_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("z nazwy bez ani jednego znaku ASCII wychodzi PUSTY slug, nie wyjątek", () => {
    // To jest kontrakt, na którym stoi walidacja w panelu: pusty wynik znaczy
    // „nie da się wyprowadzić adresu z tej nazwy", a NIE „to strona główna".
    expect(suggestPageSlug("???")).toBe("");
    expect(suggestPageSlug("・・・")).toBe("");
  });

  it("propozycja z dowolnej nazwy jest zapisywalna albo pusta — trzeciej opcji nie ma", () => {
    const nazwy = [
      "Kontakt",
      "O nas",
      "Wynajem Kraków",
      "  --- Ł ---  ",
      "2026",
      "Cennik & dostawa",
      "ą".repeat(200),
    ];
    for (const nazwa of nazwy) {
      const slug = suggestPageSlug(nazwa);
      expect(slug === "" || isValidPageSlug(slug), `nazwa „${nazwa}" dała slug „${slug}"`).toBe(
        true,
      );
    }
  });
});

describe("kształt sluga", () => {
  it("przepuszcza slug strony treściowej i sentinel strony głównej", () => {
    expect(isValidPageSlug("kontakt")).toBe(true);
    expect(isValidPageSlug("wynajem-krakow")).toBe(true);
    expect(isValidPageSlug(HOME_PAGE_SLUG)).toBe(true);
  });

  it("odrzuca wszystko, czego adres nie zniesie", () => {
    for (const zly of [
      "Kontakt",
      "kontakt ",
      "kon takt",
      "-kontakt",
      "kontakt-",
      "kon--takt",
      "kontakt/podstrona",
      "kontakt.html",
      "kontakt_2",
      "kontąkt",
      "a".repeat(PAGE_SLUG_MAX_LENGTH + 1),
    ]) {
      expect(isValidPageSlug(zly), `„${zly}" nie powinien przejść`).toBe(false);
    }
  });

  it("wzorzec NIE dopuszcza pustego stringa — sentinel jest osobną gałęzią", () => {
    // Gdyby wzorzec przepuszczał pustkę, formularz przyjąłby pusty slug jako
    // poprawny adres i najemca dostałby drugą stronę główną.
    expect(PAGE_SLUG_PATTERN.test("")).toBe(false);
  });
});

describe("lista slugów zarezerwowanych", () => {
  it("czujnik działa: lista nie jest pusta", () => {
    expect(RESERVED_PAGE_SLUGS.length).toBeGreaterThan(10);
  });

  it("jest NADZBIOREM listy kategorii — trasy sklepu chronią strony za darmo", () => {
    // Bramka anty-gnilna: apps/storefront/test/reserved-category-slugs.test.ts
    // czyta drzewo tras i wymusza wpis w RESERVED_CATEGORY_SLUGS. Ta asercja
    // przenosi tamtą ochronę na strony bez drugiej listy do pilnowania.
    const brakujace = RESERVED_CATEGORY_SLUGS.filter(
      (slug) => !RESERVED_PAGE_SLUGS.includes(slug),
    );
    expect(brakujace, "slug zarezerwowany dla kategorii, ale nie dla stron").toEqual([]);
  });

  it("jest posortowana i bez duplikatów", () => {
    expect([...RESERVED_PAGE_SLUGS]).toEqual([...new Set(RESERVED_PAGE_SLUGS)].sort());
  });

  it("każdy wpis jest slugiem zapisywalnym — inaczej rezerwacja broniłaby pustki", () => {
    // Wpis, którego CHECK i tak by nie przepuścił, nie broni ŻADNEGO adresu:
    // bramka rezerwacji nigdy by go nie zobaczyła.
    for (const slug of RESERVED_PAGE_SLUGS) {
      expect(isValidPageSlug(slug), `zarezerwowano „${slug}", ale slug jest niezapisywalny`).toBe(
        true,
      );
    }
  });

  it("rozpoznaje rezerwację po normalizacji, tak jak baza", () => {
    expect(isReservedPageSlug("checkout")).toBe(true);
    expect(isReservedPageSlug("  CHECKOUT ")).toBe(true);
    expect(isReservedPageSlug("pl")).toBe(true);
    expect(isReservedPageSlug("store")).toBe(true);
    expect(isReservedPageSlug("kontakt")).toBe(false);
  });
});

describe("adres publiczny i trasa wewnętrzna", () => {
  it("strona główna ma adres `/`, strona treściowa `/{slug}`", () => {
    expect(pagePathFromSlug(HOME_PAGE_SLUG)).toBe("/");
    expect(pagePathFromSlug("kontakt")).toBe("/kontakt");
  });

  it("trasa wewnętrzna siedzi pod segmentem zarezerwowanym, nie w korzeniu", () => {
    // Cel rewrite'u w korzeniu (`/kontakt` → `/[slug]`) jest w Next 16
    // niebudowalny obok `app/[locale]`; a gdyby prefiks nie był zarezerwowany,
    // najemca mógłby założyć stronę, która przejmuje trasę wewnętrzną.
    expect(internalPagePathname("kontakt")).toBe("/store/kontakt");
    expect(isReservedPageSlug(INTERNAL_PAGE_PREFIX.slice(1))).toBe(true);
  });

  it("adres publiczny NIGDY nie jest adresem wewnętrznym", () => {
    for (const slug of ["kontakt", "o-nas", "wynajem-krakow"]) {
      expect(pagePathFromSlug(slug)).not.toBe(internalPagePathname(slug));
    }
  });
});
