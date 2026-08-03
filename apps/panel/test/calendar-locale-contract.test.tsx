// @vitest-environment jsdom

/**
 * JĘZYK KALENDARZA = JĘZYK INTERFEJSU (R3-1c, uwaga 5 — znalezisko PM).
 *
 * ================== CO BYŁO NIE TAK ==================
 *
 * `packages/ui/src/components/calendar.tsx` miał `locale = pl` jako wartość
 * DOMYŚLNĄ propa, polskie etykiety nawigacji wpisane z palca i dwa formatery
 * przybite do `"pl-PL"`. W interfejsie angielskim nad angielskim formularzem
 * stało więc „sierpień 2026", a nagłówki dni brzmiały „pon wto śro". Że to
 * jedyny widżet dat całego panelu (`lib/fields/date-fields.tsx`, zakazu
 * natywnego pola pilnuje `panel-date-fields-contract`), wyciek dotyczył
 * KAŻDEGO ekranu z datą — nie jednego.
 *
 * ================== DLACZEGO TEST JEST DWUSTRONNY ==================
 *
 * Asercja „po angielsku jest August" sama w sobie przechodziłaby też wtedy,
 * gdyby ktoś przestawił domyślny język na angielski i zepsuł polski. Dlatego
 * każdy przypadek ma parę: EN mówi po angielsku ORAZ nie mówi po polsku, PL
 * mówi po polsku ORAZ nie po angielsku. Do tego skan źródła — komponent nie
 * ma prawa znać ANI JEDNEGO języka z palca, bo mutacja „wróćmy do `pl`"
 * przechodziłaby przez sam render w locale `pl`.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

import { InlineDateRangeField } from "@/lib/fields/date-fields";

afterEach(cleanup);

/** Kalendarz terminu (kreator zamówienia) w zadanym języku interfejsu. */
function renderCalendar(locale: "pl" | "en") {
  render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pl" ? plMessages : enMessages}
      timeZone="Europe/Warsaw"
    >
      <InlineDateRangeField
        id="term"
        fromName="startDate"
        toName="endDate"
        from="2026-08-10"
        to="2026-08-14"
        onChange={() => {}}
      />
    </NextIntlClientProvider>,
  );
  return screen.getByRole("grid");
}

/** Podpis miesiąca stojący nad siatką dni. */
function caption(): string {
  return document.querySelector('[class*="caption_label"], .rdp-caption_label')?.textContent
    ?? document.querySelector("[data-slot=calendar]")!.textContent!;
}

/**
 * Pierwszy render kalendarza wciąga `react-day-picker` i całą powłokę pól —
 * na zimnym runnerze CI przekracza domyślne 5 s (ten sam powód, co przy
 * `protected-routes`). Limit dotyczy KOSZTU IMPORTU, nie oczekiwania na coś,
 * co ma się wydarzyć — asercje niżej są synchroniczne.
 */
const RENDER_TIMEOUT_MS = 20_000;

describe("kalendarz panelu mówi językiem interfejsu", () => {
  it("interfejs EN: miesiąc po angielsku i ANI ŚLADU polskiego", () => {
    const grid = renderCalendar("en");

    expect(caption()).toContain("August");
    expect(caption()).not.toContain("sierpień");
    // Nagłówki dni tygodnia to druga połowa tego samego wycieku.
    expect(grid.textContent).toContain("Mo");
    expect(grid.textContent).not.toContain("pon");
  }, RENDER_TIMEOUT_MS);

  it("interfejs PL: miesiąc po polsku (kontrola pozytywna)", () => {
    const grid = renderCalendar("pl");

    expect(caption()).toContain("sierpień");
    expect(caption()).not.toContain("August");
    expect(grid.textContent).toContain("pon");
    expect(grid.textContent).not.toContain("Mo");
  }, RENDER_TIMEOUT_MS);

  it("etykiety nawigacji też idą za językiem, a nie za jednym wpisanym tekstem", () => {
    renderCalendar("en");
    expect(screen.getByRole("button", { name: /next month/i })).toBeTruthy();
    cleanup();

    renderCalendar("pl");
    expect(screen.getByRole("button", { name: /następnego miesiąca/i })).toBeTruthy();
  }, RENDER_TIMEOUT_MS);
});

describe("źródło kalendarza nie zna żadnego języka z palca", () => {
  const uiRoot = resolve(process.cwd(), "../../packages/ui/src/components");
  const calendar = readFileSync(resolve(uiRoot, "calendar.tsx"), "utf8");

  /** Komentarze OPISUJĄ dawny błąd i cytują `pl-PL` — skan patrzy na KOD. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  }

  const code = stripComments(calendar);

  it("skan ma na czym pracować (kontrola po pustym zbiorze)", () => {
    expect(code.length).toBeGreaterThan(1_000);
    expect(code).toContain("DayPicker");
  });

  it("komponent nie importuje ani nie ustawia domyślnego locale", () => {
    expect(code, "kalendarz wciąga locale z biblioteki").not.toMatch(
      /from "react-day-picker\/locale"/,
    );
    expect(code, "prop locale ma z powrotem wartość domyślną").not.toMatch(/locale\s*=\s*\w/);
  });

  it("żaden formater nie ma języka wpisanego z palca", () => {
    expect(code, "twardy kod języka w formaterze").not.toMatch(/["'](?:pl|en)(?:-[A-Z]{2})?["']/);
  });

  it("mapa języków jest jedna i mapuje na obie strony", () => {
    // Kontrola pozytywna skanu wyżej: gdzieś te kody MUSZĄ być — w mapie,
    // czyli w jednym pliku, a nie rozsypane po komponentach.
    const map = stripComments(readFileSync(resolve(uiRoot, "calendar-locale.ts"), "utf8"));
    expect(map).toContain("enUS");
    expect(map).toContain("pl");
  });
});
