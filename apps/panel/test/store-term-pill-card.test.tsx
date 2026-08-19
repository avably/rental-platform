// @vitest-environment jsdom

/**
 * KARTA „KALENDARZ TERMINU W PASKU SKLEPU" (ADR-203, migracja 0090).
 *
 * ===================== CO JEST MIERZONE =====================
 *
 *   1. PRZEŁĄCZNIK WOŁA WŁAŚCIWY CZASOWNIK z WŁAŚCIWĄ wartością — akcja
 *      dostaje dokładnie tę pozycję, którą operator wybrał;
 *   2. ODMOWA COFA PRZEŁĄCZNIK — karta nie ma prawa pokazywać stanu,
 *      którego nie zapisała (przełącznik w nowej pozycji po błędzie kłamie
 *      o zachowaniu sklepu);
 *   3. ZDANIE O SKUTKU zmienia się razem ze stanem („klienci widzą" /
 *      „klienci wybierają na stronie sprzętu");
 *   4. PARYTET PL/EN — komplet kluczy w obu językach, różnymi napisami.
 *
 * Izolację ZAPISU (własny tenant, żywe członkostwo, odmowa anonowi) mierzy
 * packages/db/test/store-term-flag.test.ts na żywej bazie — tu jest wyłącznie
 * warstwa widoku; skutek flagi w sklepie mierzą suity storefrontu
 * (product-template-route 3e, catalog-page-route).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

const actions = vi.hoisted(() => ({
  saveStoreTermCalendarAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(panel)/strona/term-pill-actions", () => actions);

const { StoreTermPillCard } = await import("@/app/[locale]/(panel)/strona/store-term-pill-card");

function renderCard(initialEnabled: boolean, locale: "pl" | "en" = "pl") {
  const messages = locale === "pl" ? plMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Warsaw">
      <StoreTermPillCard initialEnabled={initialEnabled} />
    </NextIntlClientProvider>,
  );
}

function card(): HTMLElement {
  const node = document.querySelector<HTMLElement>("[data-store-term-pill]");
  if (!node) throw new Error("karta pigułki nie powstała");
  return node;
}

function toggle(): HTMLElement {
  const node = document.querySelector<HTMLElement>("[data-store-term-pill-toggle]");
  if (!node) throw new Error("przełącznika nie ma na karcie");
  return node;
}

beforeEach(() => {
  actions.saveStoreTermCalendarAction.mockReset();
  actions.saveStoreTermCalendarAction.mockResolvedValue({ ok: true });
});

// jsdom trzyma dokument między plikami — bez cleanup() querySelector("#x")
// potrafi widzieć węzły z poprzedniego przypadku.
afterEach(() => cleanup());

describe("karta kalendarza terminu w pasku (ADR-203)", () => {
  it("FLAGA WŁĄCZONA: przełącznik zaznaczony, zdanie o skutku mówi o pasku", () => {
    renderCard(true);

    expect(card().getAttribute("data-store-term-pill-state")).toBe("on");
    expect(screen.getByText(plMessages.site.termPill.on)).toBeTruthy();
    expect(screen.getByText(plMessages.site.termPill.help)).toBeTruthy();
  });

  it("FLAGA WYŁĄCZONA W BAZIE: karta startuje w pozycji off — stan z odczytu, nie z domysłu", () => {
    renderCard(false);

    expect(card().getAttribute("data-store-term-pill-state")).toBe("off");
    expect(screen.getByText(plMessages.site.termPill.off)).toBeTruthy();
  });

  it("WYŁĄCZENIE woła akcję z FALSE i przestawia zdanie o skutku", async () => {
    renderCard(true);

    fireEvent.click(toggle());

    await waitFor(() => {
      expect(actions.saveStoreTermCalendarAction).toHaveBeenCalledExactlyOnceWith(false);
      expect(card().getAttribute("data-store-term-pill-state")).toBe("off");
    });
    expect(screen.getByText(plMessages.site.termPill.off)).toBeTruthy();
  });

  it("ODMOWA ZAPISU cofa przełącznik i pokazuje błąd — karta nie kłamie o stanie sklepu", async () => {
    actions.saveStoreTermCalendarAction.mockResolvedValue({
      ok: false,
      error: plMessages.site.termPill.error,
    });
    renderCard(true);

    fireEvent.click(toggle());

    await waitFor(() => {
      expect(document.querySelector("[data-store-term-pill-error]")).not.toBeNull();
    });
    expect(card().getAttribute("data-store-term-pill-state"), "przełącznik został w pozycji, której baza nie zapisała").toBe("on");
    expect(screen.getByText(plMessages.site.termPill.error)).toBeTruthy();
  });

  it("PARYTET PL/EN: komplet kluczy w obu językach, różnymi napisami", () => {
    const pl = plMessages.site.termPill as Record<string, string>;
    const en = enMessages.site.termPill as Record<string, string>;

    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
    for (const key of Object.keys(pl)) {
      expect(en[key], `klucz ${key} po angielsku brzmi jak po polsku`).not.toBe(pl[key]);
    }

    renderCard(false, "en");
    expect(screen.getByText(enMessages.site.termPill.off)).toBeTruthy();
  });
});
