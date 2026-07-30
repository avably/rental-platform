// @vitest-environment jsdom

/**
 * Galeria „Dodaj sekcję" (kreator A2, ADR-082) — kontrakt warstwy klienta:
 *   1. modal wystawia kafel KAŻDEGO typu z SECTION_TYPES (nazwa + jednozdaniowy
 *      opis) — zamknięta lista, kompletu pilnuje ten test (nie mockup, bo modal
 *      jest zamknięty w SSR kontraktu ekranu);
 *   2. klik kafla woła onAdd z TYM typem i zamyka modal.
 */
import { SECTION_TYPES } from "@avably/core/site";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AddSectionDialog } from "@/app/[locale]/(panel)/strona/add-section-gallery";

import plMessages from "../messages/pl.json";

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

afterEach(() => cleanup());

function renderGallery(onAdd = vi.fn()) {
  render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <AddSectionDialog onAdd={onAdd} trigger={<button type="button">Dodaj sekcję</button>} />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Dodaj sekcję" }));
  return onAdd;
}

describe("galeria Dodaj sekcję", () => {
  it("po otwarciu wystawia kafel każdego typu — nazwa + opis", () => {
    renderGallery();
    const gallery = screen.getByRole("dialog");
    const tiles = gallery.querySelectorAll("[data-add-section-tile]");
    expect(tiles).toHaveLength(SECTION_TYPES.length);

    for (const type of SECTION_TYPES) {
      const tile = gallery.querySelector(`[data-add-section-tile="${type}"]`) as HTMLElement;
      expect(tile, `brak kafla dla typu ${type}`).not.toBeNull();
      expect(tile.textContent, `kafel ${type} bez nazwy`).toContain(plMessages.site.sectionTypes[type]);
      expect(tile.textContent, `kafel ${type} bez opisu`).toContain(
        plMessages.site.sectionTypeDescriptions[type],
      );
    }
  });

  it("klik kafla woła onAdd z jego typem i zamyka modal", () => {
    const onAdd = renderGallery();
    const tile = screen.getByRole("dialog").querySelector('[data-add-section-tile="testimonials"]') as HTMLElement;
    fireEvent.click(tile);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith("testimonials");
    // Modal znika po wyborze.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
