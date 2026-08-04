/**
 * PIN `force-dynamic` dla trasy kreatora (K1, ADR-083).
 *
 * Trasa `/strona/kreator` żyje pod layoutem locale, który ma
 * `generateStaticParams` — bez jawnego pinu Next.js wciągnąłby ją w statyczny
 * prerender. Konsekwencja jest CICHA i dlatego pilnuje jej test, a nie komentarz:
 * CSP panelu ma nonce per żądanie i `strict-dynamic`, więc skrypty wypieczone
 * z prerenderu (z nonce'em z czasu builda) przestają pasować do polityki
 * i przeglądarka odmawia ich wykonania. Dokument renderuje się, wygląda dobrze
 * i NIE hydratuje — bez jednego błędu w konsoli (odkrycie ze spike'u C0).
 * Kreator bez hydracji to martwe płótno: zero przeciągania, zero pasków
 * narzędzi, zero zapisu.
 *
 * Test czyta ŹRÓDŁO, a nie zachowanie, bo pin jest deklaracją modułu: to jedyne
 * miejsce, w którym da się go stracić przez przypadek.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const BUILDER_ROUTE = "app/[locale]/(kreator)/strona/[siteId]/kreator/page.tsx";

function source(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

describe("trasa kreatora jest przypięta do renderu na żądanie", () => {
  const route = source(BUILDER_ROUTE);

  it("plik trasy istnieje i nie jest atrapą", () => {
    // Kontrola po pustym zbiorze: asercje niżej przelatywałyby po pustym
    // stringu, gdyby ścieżka rozjechała się po przeniesieniu trasy.
    expect(route.length, `pusty plik trasy ${BUILDER_ROUTE}`).toBeGreaterThan(500);
    expect(route).toContain("export default async function");
  });

  it("ma jawny pin force-dynamic", () => {
    expect(route).toMatch(/export const dynamic = "force-dynamic";/);
  });

  it("nie próbuje prerenderować się przez generateStaticParams", () => {
    expect(route).not.toMatch(/export (async )?function generateStaticParams/);
  });

  it("stoi POZA grupą (panel), czyli poza powłoką panelu", () => {
    // Kreator jest pełnoekranowy: sidebar i belka panelu zabierałyby płótnu
    // szerokość, w której buduje się stronę, i dawały drugą drogę powrotną.
    expect(BUILDER_ROUTE).toContain("(kreator)");
    expect(BUILDER_ROUTE).not.toContain("(panel)");
  });

  it("wejście jest bramkowane tak samo jak reszta tras tenanta", () => {
    expect(route).toContain("requireMemberPage");
  });
});
