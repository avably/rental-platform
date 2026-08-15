/**
 * PIN `force-dynamic` dla tras SKLEPU rysujących sekcje (Faza 2, ADR-158).
 *
 * Trasy sklepu leżą pod layoutem, którego sąsiad (`app/[locale]/layout.tsx`) ma
 * `generateStaticParams` — bez jawnego pinu Next.js wciąga trasę w statyczny
 * prerender. Konsekwencja jest CICHA i dlatego pilnuje jej test, a nie
 * komentarz: CSP sklepu ma nonce per żądanie, więc skrypty wypieczone
 * z prerenderu (z nonce'em z czasu builda) przestają pasować do polityki
 * i przeglądarka odmawia ich wykonania. Dokument renderuje się, wygląda dobrze
 * i NIE hydratuje — bez jednego błędu w konsoli.
 *
 * Do Fazy 2 sekcje rysowała DOKŁADNIE JEDNA trasa i pin wisiał w jej ciele.
 * Od tej fazy tras jest więcej, więc pin dostaje własny plik i listę — nowa
 * trasa dopisana bez pinu pali build, zamiast produkować martwe płótno.
 *
 * Test czyta ŹRÓDŁO, a nie zachowanie, bo pin jest deklaracją modułu: to jedyne
 * miejsce, w którym da się go stracić przez przypadek.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Trasy grupy (tenant), które renderują sekcje kreatora. */
const SECTION_ROUTES = [
  "app/(tenant)/store/page.tsx",
  "app/(tenant)/store/[slug]/page.tsx",
  // [ADR-186] Strona katalogu rysuje kafle sekcji sprzętu i powłokę najemcy,
  // więc obowiązuje ją ten sam pin: bez niego dokument wypiekłby się z nonce'em
  // z czasu builda i przestał hydratować, bez jednego błędu w konsoli.
  "app/(tenant)/katalog/page.tsx",
] as const;

function source(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), "utf8");
}

describe("trasy sklepu są przypięte do renderu na żądanie", () => {
  it.each(SECTION_ROUTES)("%s istnieje i nie jest atrapą", (route) => {
    // Kontrola po pustym zbiorze: asercje niżej przelatywałyby po pustym
    // stringu, gdyby ścieżka rozjechała się po przeniesieniu trasy.
    const zrodlo = source(route);
    expect(zrodlo.length, `pusty plik trasy ${route}`).toBeGreaterThan(500);
    expect(zrodlo).toContain("export default async function");
  });

  it.each(SECTION_ROUTES)("%s ma jawny pin force-dynamic", (route) => {
    expect(source(route)).toMatch(/export const dynamic = "force-dynamic";/);
  });

  it.each(SECTION_ROUTES)("%s nie próbuje prerenderować się przez generateStaticParams", (route) => {
    expect(source(route)).not.toMatch(/export (async )?function generateStaticParams/);
  });

  it("trasa strony treściowej stoi pod segmentem ZAREZERWOWANYM, nie w korzeniu", () => {
    // `app/(tenant)/[slug]` obok `app/[locale]` to twardy błąd builda Next 16
    // (dwie różne nazwy parametru na tym samym poziomie ścieżki), a prefiks
    // spoza listy rezerwacji dałby najemcy adres przejmujący trasę wewnętrzną.
    expect(SECTION_ROUTES).toContain("app/(tenant)/store/[slug]/page.tsx");
  });
});
