// @vitest-environment jsdom

/**
 * EDYTOR „WYGLĄDU SKLEPU" (ADR-230) — kontrakt warstwy klienta, z DOWODEM
 * MUTACYJNYM na NIEDESTRUKCYJNOŚCI zmiany motywu.
 *
 * ===================== CO TEN PLIK PILNUJE =====================
 *
 * Decyzja właściciela: motyw ma się dać zmienić z tego ekranu BEZ kasowania
 * treści stron. Dziś jedyną drogą zmiany motywu jest `applyStarterTemplate` —
 * ścieżka DESTRUKCYJNA (kasuje sekcje szkicu). Ten ekran rozprzęga to: klik
 * motywu jedzie przez `saveStyle` (wpięte w `updateStoreStyle` →
 * `app.set_tenant_style`) z PEŁNYM stylem `{theme, accent, fontPair}`, a sekcje
 * stron nie są w tym wywołaniu ani wspomniane.
 *
 * Akcje wchodzą PROPEM (nie importem), więc dowód podstawia szpiega bez
 * mockowania modułu — i widać wprost, że klik motywu woła zapis STYLU, a nie
 * zapis sekcji.
 *
 * ===================== DOWÓD MUTACYJNY (opis w raporcie) =====================
 *
 * Mutacja podpina klik motywu pod destrukcyjną ścieżkę (w `store-appearance-
 * editor.tsx` `chooseTheme` woła `applyStarterTemplate` zamiast `save`):
 * `saveStyle` przestaje być wołane → test „klik motywu woła zapis STYLU"
 * czerwony. Przywrócenie → zielony.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SITE_STYLE,
  SELECTABLE_THEMES,
  themeTokens,
  type ResolvedSiteStyle,
} from "@avably/core/site";

import { StoreAppearanceEditor } from "@/app/[locale]/(panel)/strona/wyglad/store-appearance-editor";

import plMessages from "../messages/pl.json";

/** Radix (PanelSelect w reużytym StylePanel) woła API, których jsdom nie ma. */
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

type Result = { ok: true } | { ok: false; error: string };
const ok = (): Result => ({ ok: true });

/** Szkic w motywie SELEKTOWALNYM — inaczej klik innego motywu byłby zmianą. */
const START: ResolvedSiteStyle = {
  theme: "gridline",
  accent: themeTokens("gridline").defaultAccent,
  fontPair: "poster",
};

function renderEditor(overrides?: {
  saveStyle?: (style: ResolvedSiteStyle) => Promise<Result>;
  publish?: () => Promise<Result>;
}) {
  const saveStyle = vi.fn(overrides?.saveStyle ?? (async () => ok()));
  const publish = vi.fn(overrides?.publish ?? (async () => ok()));
  const utils = render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <StoreAppearanceEditor
        initialDraft={START}
        initialPublished={START}
        saveStyle={saveStyle}
        publish={publish}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, saveStyle, publish };
}

afterEach(() => cleanup());

describe("StoreAppearanceEditor — zmiana motywu jest NIEDESTRUKCYJNA", () => {
  it("klik motywu woła ZAPIS STYLU (set_tenant_style), a nie zapis sekcji", async () => {
    const { container, saveStyle } = renderEditor();

    // Klik w motyw INNY niż bieżący (bieżący to `gridline`).
    const target = container.querySelector<HTMLElement>('[data-appearance-theme="industrial-noir"]')!;
    expect(target, "brak próbki motywu na ekranie").not.toBeNull();
    fireEvent.click(target);

    await waitFor(() => expect(saveStyle).toHaveBeenCalledTimes(1));

    const payload = saveStyle.mock.calls[0]![0] as unknown as Record<string, unknown>;
    // 1) Pełny STYL — dokładnie kształt `set_tenant_style` (theme+accent+fontPair).
    expect(Object.keys(payload).sort()).toEqual(["accent", "fontPair", "theme"]);
    // 2) To NIE jest kształt `applyStarterTemplate` (siteId/starterId/locale) —
    //    czyli nie ma ani jednego argumentu ścieżki DESTRUKCYJNEJ.
    expect(payload).not.toHaveProperty("siteId");
    expect(payload).not.toHaveProperty("starterId");
    // 3) Motyw = wybrany; akcent zresetowany do DOMYŚLNEGO nowego motywu;
    //    para krojów NIETKNIĘTA (jest wspólna dla motywów).
    expect(payload.theme).toBe("industrial-noir");
    expect(payload.accent).toBe(themeTokens("industrial-noir").defaultAccent);
    expect(payload.fontPair).toBe("poster");
  });

  it("każda selektowalna próbka motywu jest na ekranie i klikalna", () => {
    const { container } = renderEditor();
    for (const id of SELECTABLE_THEMES) {
      expect(
        container.querySelector(`[data-appearance-theme="${id}"]`),
        `brak próbki motywu ${id}`,
      ).not.toBeNull();
    }
    // Kontrola po pustym zbiorze: lista motywów NIE jest pusta.
    expect(SELECTABLE_THEMES.length).toBeGreaterThan(0);
  });

  it("„Opublikuj wygląd” pojawia się dopiero po zmianie i woła publish (istniejące RPC)", async () => {
    const { container, publish } = renderEditor();

    // Bez różnicy (draft === published) przycisku publikacji NIE ma.
    expect(container.querySelector("[data-appearance-publish]")).toBeNull();
    expect(container.querySelector("[data-appearance-editor]")!.getAttribute("data-appearance-state")).toBe(
      "live",
    );

    fireEvent.click(container.querySelector<HTMLElement>('[data-appearance-theme="confetti"]')!);

    // Przycisk publikacji POJAWIA się przy zmianie, ale jest ZABLOKOWANY na czas
    // tranzycji zapisu (`loading`/`disabled` przez pending). Klik w zablokowany
    // przycisk NIE odpala akcji — dlatego czekamy, aż zapis się domknie i
    // przycisk odblokuje. Lokalnie tranzycja mija natychmiast; na wolnym CI
    // klik wyprzedzał jej koniec (izolacja/async, nie wada produktu).
    const publishBtn = await waitFor(() => {
      const btn = container.querySelector<HTMLButtonElement>("[data-appearance-publish]");
      expect(btn, "brak wejścia publikacji po zmianie wyglądu").not.toBeNull();
      expect(btn!.disabled, "przycisk publikacji jeszcze w tranzycji zapisu").toBe(false);
      return btn!;
    });
    fireEvent.click(publishBtn);
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  });
});

describe("kontrola pozytywna fikstury", () => {
  it("motyw startowy jest selektowalny, a domyślny motyw aplikacji zastany", () => {
    expect(SELECTABLE_THEMES).toContain(START.theme);
    // `classic` (DEFAULT_SITE_STYLE) jest motywem ZASTANYM — nie ma go w wyborze,
    // więc fikstura startowa NIE jest nim przypadkiem.
    expect(SELECTABLE_THEMES).not.toContain(DEFAULT_SITE_STYLE.theme);
  });
});
