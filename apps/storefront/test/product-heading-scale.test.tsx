// @vitest-environment jsdom
/**
 * HIERARCHIA NA STRONIE SPRZĘTU: TYTUŁ NIGDY MNIEJSZY OD NAGŁÓWKA SEKCJI
 * (S-24 audytu 2026-08-25).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * `h1` z nazwą sprzętu stał na płaskim `text-3xl` (30 px), a nagłówek sekcji
 * szablonu POD nim — na `landing-heading`, czyli clamp do 48 px. Tytuł
 * dokumentu przegrywał więc wizualnie z podtytułem treści dołożonej pod spodem.
 *
 * ==================== JAK TO MIERZYMY ====================
 *
 * Nie po nazwach klas („czy jest text-5xl"), tylko po LICZBACH: klasa `h1`
 * przekłada się na kroki skali Tailwinda w `rem`, a `landing-heading` niesie
 * `clamp(min, …, max)` w arkuszu `@avably/ui`. Porównujemy oba końce zakresu.
 * Dzięki temu test pyta o RELACJĘ ROZMIARÓW — czyli o to, co zgłosił audyt —
 * a nie o zapis, który da się spełnić dowolną inną klasą.
 *
 * MUTACJE, KTÓRE MAJĄ TU SPŁONĄĆ: powrót `h1` do płaskiego `text-3xl` (dolny
 * i górny koniec zrównują się z nagłówkiem sekcji, ale górny spada poniżej),
 * zdjęcie górnego kroku skali, oraz podniesienie `landing-heading` bez
 * podniesienia tytułu.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProductDetail } from "@/components/storefront/product-detail";
import { getStorefrontCopy } from "@/lib/storefront/copy";
import type { ProductDetailView } from "@/lib/catalog/present";

/** Kroki skali Tailwinda używane przez tytuły sklepu, w `rem`. */
const KROKI: Record<string, number> = {
  "text-2xl": 1.5,
  "text-3xl": 1.875,
  "text-4xl": 2.25,
  "text-5xl": 3,
  "text-6xl": 3.75,
};

const ARKUSZ = "../../packages/ui/src/site/site.css";

const copy = await getStorefrontCopy("pl");

const produkt: ProductDetailView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Nagrzewnica olejowa 30 kW",
  description: null,
  images: [],
  basePriceLabel: "od 120,00 zł / doba",
  depositFormatted: "300,00 zł",
  perDayFormatted: "120,00 zł",
  priceParams: { basePriceDayGrosze: 12_000, depositGrosze: 30_000, autoIncrementMultiplier: 1, tiers: [] },
  specs: [],
};

/** Klasy `h1` z PRAWDZIWEGO renderu bloku, nie ze źródła komponentu. */
function h1Classes(): string[] {
  const html = renderToStaticMarkup(
    <ProductDetail product={produkt} copy={copy} booking={null} />,
  );
  const tag = /<h1\b[^>]*>/.exec(html)?.[0] ?? "";
  const className = /class="([^"]*)"/.exec(tag)?.[1] ?? "";
  return className.split(/\s+/).filter(Boolean);
}

/** Kroki skali w klasie `h1`, w kolejności rosnących progów kontenera. */
function scaleSteps(classes: string[]): number[] {
  const steps: number[] = [];
  for (const cls of classes) {
    const bare = cls.includes(":") ? cls.slice(cls.lastIndexOf(":") + 1) : cls;
    const rem = KROKI[bare];
    if (rem !== undefined) steps.push(rem);
  }
  return steps;
}

/** Granice `clamp()` nagłówka sekcji, prosto z arkusza motywu. */
function landingHeadingClamp(): { min: number; max: number } {
  const css = readFileSync(resolve(process.cwd(), ARKUSZ), "utf8");
  const block = /\.landing-heading\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const clamp = /font-size:\s*clamp\(\s*([\d.]+)rem\s*,[^,]+,\s*([\d.]+)rem\s*\)/.exec(block);
  if (!clamp) throw new Error("nie znaleziono clamp() nagłówka sekcji w site.css");
  return { min: Number(clamp[1]), max: Number(clamp[2]) };
}

describe("skala tytułu strony sprzętu (S-24)", () => {
  it("KONTROLA PRZYRZĄDU: render oddaje h1 z rozpoznawalnymi krokami skali", () => {
    const steps = scaleSteps(h1Classes());
    expect(steps.length, "w klasie h1 nie ma ani jednego kroku skali").toBeGreaterThan(0);
  });

  it("tytuł nie jest mniejszy od nagłówka sekcji na ŻADNYM końcu zakresu", () => {
    const steps = scaleSteps(h1Classes());
    const sekcja = landingHeadingClamp();

    expect(Math.min(...steps), "tytuł mniejszy od nagłówka sekcji na wąskim ekranie").toBeGreaterThanOrEqual(
      sekcja.min,
    );
    expect(
      Math.max(...steps),
      "tytuł mniejszy od nagłówka sekcji na szerokim ekranie — to jest S-24",
    ).toBeGreaterThanOrEqual(sekcja.max);
  });

  it("skala ROŚNIE z kontenerem, a progi są kontenerowe (ADR-085), nie viewportowe", () => {
    const classes = h1Classes();
    const steps = scaleSteps(classes);

    expect(steps.length, "tytuł ma jeden płaski rozmiar — skala nie rośnie").toBeGreaterThan(1);
    expect([...steps].sort((a, b) => a - b), "kroki skali nie rosną").toEqual(steps);

    const responsive = classes.filter((cls) => cls.includes(":") && KROKI[cls.split(":").pop()!]);
    expect(responsive.length, "brak kroków warunkowych").toBeGreaterThan(0);
    for (const cls of responsive) {
      expect(cls, `próg viewportowy zamiast kontenerowego: ${cls}`).toMatch(/@min-\[[^\]]+\]\/site:/);
    }
  });
});
