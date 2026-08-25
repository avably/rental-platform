/**
 * MARTWA KOTWICA W PRZYCISKU PROWADZI DO KATALOGU (S-10 audytu 2026-08-25).
 *
 * ==================== CO TEN PLIK PILNUJE ====================
 *
 * Presety i szablony startowe wpisują w przycisk hero `#produkty`. Kotwica
 * `produkty` powstaje w dokumencie WYŁĄCZNIE tam, gdzie na stronie stoi sekcja
 * sprzętu (`sectionAnchorIds`), więc na stronie bez tej sekcji przycisk nie
 * robił NIC: bez błędu, bez zmiany adresu, bez śladu w konsoli.
 *
 * ==================== MUTACJE, KTÓRE MAJĄ TU SPŁONĄĆ ====================
 *
 *   1. przekształcenie wyłączone / nie wołane przez trasę → przycisk zostaje
 *      z `#produkty` na stronie bez sekcji sprzętu (test 1 i test „trasa woła"),
 *   2. przekształcenie zbyt gorliwe → podmienia kotwicę, której cel NA TEJ
 *      STRONIE stoi (test 2) albo adres, który kotwicą nie jest (test 4),
 *   3. przekształcenie sięga tylko po klucz `href` → treść v1 (`ctaHref`)
 *      zostaje martwa (test 3),
 *   4. przekształcenie mutuje treść najemcy zamiast zbudować kopię (test 5) —
 *      to jest różnica między naprawą RENDERU a naprawą danych, a naprawa
 *      danych zamroziłaby stan z chwili, w której akurat patrzyliśmy.
 *
 * Ostatni test jest przejściem CAŁEJ drogi: preset → przekształcenie →
 * `SiteRenderer` → HTML. Bez niego wszystkie powyższe mogą być zielone przy
 * rendererze, który i tak wystawia inny atrybut.
 */
import { presetContentFor, type PublishedSection } from "@avably/core/site";
import { SiteRenderer, type RenderSection } from "@avably/ui";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { withCatalogFallbackAnchors } from "@/lib/site/page-sections";

const KATALOG = "/katalog";

/** Sekcja z presetu — treść startowa jest tą, która niesie adresy kotwic. */
const sekcja = (id: string, type: "hero" | "products" | "contact"): PublishedSection =>
  ({ id, position: 0, type, content: presetContentFor(type, "pl") }) as PublishedSection;

/** Wszystkie wartości `href`/`ctaHref` z treści, niezależnie od zagnieżdżenia. */
function cele(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) cele(item, out);
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if ((key === "href" || key === "ctaHref") && typeof value === "string") out.push(value);
    else cele(value, out);
  }
  return out;
}

describe("kotwica bez celu na tej stronie → katalog", () => {
  it("KONTROLA WYJŚCIOWA: preset hero naprawdę niesie kotwicę `#produkty`", () => {
    // Bez tego zdania każda asercja niżej mogłaby przechodzić po pustym
    // zbiorze — treść presetu zmienia się poza tym plikiem.
    expect(cele(sekcja("h", "hero").content)).toContain("#produkty");
  });

  it("strona BEZ sekcji sprzętu: przycisk hero prowadzi do katalogu", () => {
    const out = withCatalogFallbackAnchors([sekcja("h", "hero")], KATALOG);

    expect(cele(out[0]!.content)).toContain(KATALOG);
    expect(cele(out[0]!.content), "martwa kotwica przeżyła przekształcenie").not.toContain(
      "#produkty",
    );
  });

  it("strona Z sekcją sprzętu: `#produkty` zostaje bez zmian", () => {
    const out = withCatalogFallbackAnchors(
      [sekcja("h", "hero"), sekcja("p", "products")],
      KATALOG,
    );

    expect(cele(out[0]!.content), "żywa kotwica podmieniona na katalog").toContain("#produkty");
    expect(cele(out[0]!.content)).not.toContain(KATALOG);
  });

  it("treść v1 też jest naprawiana — klucz nazywa się tam `ctaHref`", () => {
    const v1 = {
      id: "h1",
      position: 0,
      type: "hero",
      content: { heading: "Wynajmij sprzęt", ctaText: "Zobacz ofertę", ctaHref: "#produkty" },
    } as PublishedSection;

    const out = withCatalogFallbackAnchors([v1], KATALOG);
    expect(cele(out[0]!.content)).toEqual([KATALOG]);
  });

  it("adresy, które kotwicami nie są, zostają nietknięte", () => {
    const sekcje = [
      {
        id: "s",
        position: 0,
        type: "freeform",
        content: {
          links: [
            { href: "/regulamin" },
            { href: "https://example.test/cennik" },
            { href: "mailto:biuro@example.test" },
            { href: "tel:+48111222333" },
            { href: "#produkty" },
          ],
        },
      } as unknown as PublishedSection,
    ];

    expect(cele(withCatalogFallbackAnchors(sekcje, KATALOG)[0]!.content)).toEqual([
      "/regulamin",
      "https://example.test/cennik",
      "mailto:biuro@example.test",
      "tel:+48111222333",
      KATALOG,
    ]);
  });

  it("przekształcenie jest CZYSTE — treść najemcy zostaje bez zmian", () => {
    const wejscie = [sekcja("h", "hero")];
    const przed = JSON.stringify(wejscie);

    const out = withCatalogFallbackAnchors(wejscie, KATALOG);

    expect(JSON.stringify(wejscie), "przekształcenie zmutowało treść na wejściu").toBe(przed);
    expect(out[0], "przekształcenie oddało TEN SAM obiekt").not.toBe(wejscie[0]);
  });

  it("CAŁA DROGA: render strony bez sekcji sprzętu nie zawiera martwego `#produkty`", () => {
    const sekcje = withCatalogFallbackAnchors(
      [sekcja("h", "hero"), sekcja("k", "contact")],
      KATALOG,
    ) as unknown as RenderSection[];

    const html = renderToStaticMarkup(<SiteRenderer sections={sekcje} anchors />);

    expect(html.length, "render pusty — asercje niżej po pustym zbiorze").toBeGreaterThan(200);
    expect(html).toContain(`href="${KATALOG}"`);

    const adresy = [...new Set([...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!))];
    const martwe = adresy.filter((cel) => !html.includes(`id="${cel}"`));
    expect(martwe, `adres bez celu na opublikowanej stronie: ${martwe.join(", ")}`).toEqual([]);
  });
});

describe("trasy sklepu WOŁAJĄ przekształcenie", () => {
  /*
   * Mechanizm ma własne testy wyżej i jest całkowicie bezużyteczny, dopóki
   * trasa go nie zawoła — dokładnie ta sama lekcja, co przy fladze `anchors`
   * w `site-anchors.test.tsx`. Czytamy kod BEZ komentarzy, żeby akapit
   * z uzasadnieniem nie spełniał tego zdania po zniknięciu wywołania.
   */
  const bezKomentarzy = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|\s)\/\/[^\n]*/g, "$1");

  it.each([
    ["strona główna", "app/(tenant)/store/page.tsx"],
    ["strona treściowa", "app/(tenant)/store/[slug]/page.tsx"],
    ["strona sprzętu", "lib/catalog/product-page.tsx"],
  ])("%s przepuszcza sekcje przez fallback kotwic", (_nazwa, path) => {
    const kod = bezKomentarzy(path);
    expect(kod.length, "pusty plik trasy — kontrola po pustym zbiorze").toBeGreaterThan(500);
    expect(kod, "trasa renderuje sekcje z martwymi kotwicami").toContain(
      "withCatalogFallbackAnchors(",
    );
  });
});
