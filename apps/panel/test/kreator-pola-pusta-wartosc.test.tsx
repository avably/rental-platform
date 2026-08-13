// @vitest-environment jsdom

/**
 * POLA SZUFLADY DAJĄ SIĘ OPRÓŻNIĆ, A ODMOWA MÓWI, ŻE ODMAWIA (K3, ADR-169).
 *
 * Etykieta przycisku, opis zdjęcia i treść napisu odrzucały pustkę BEZ SŁOWA:
 * `onChange` wracał, wartość przychodziła z modelu w tym samym renderze, a pole
 * wyglądało na zamarłe. Operator, żeby przepisać treść od zera, musiał zaznaczyć
 * całość i nadpisać jednym ruchem — inaczej kreator „nie reagował".
 *
 * Kontrakt: pustka jest dozwolonym stanem POŚREDNIM (pole ją pokazuje), do
 * szkicu NIE idzie (schemat i tak by ją odrzucił) i ma przy sobie zdanie, które
 * to nazywa. Pierwszy niepusty znak wraca do zapisu normalnie.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/actions/site", () => ({
  upsertSection: vi.fn(async () => ({ ok: true })),
  updateSectionContent: vi.fn(async () => ({ ok: true })),
}));

const { SectionSettingsDrawer } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/kreator/section-settings-drawer"
);
const { sectionCanvasSchema } = await import("@avably/core/site");

const canvas = sectionCanvasSchema.parse({
  version: 2,
  rows: 20,
  background: "default",
  elements: [
    {
      id: "przycisk-1",
      kind: "button",
      label: "Zarezerwuj",
      href: "/rezerwacja",
      variant: "solid",
      align: "left",
      layout: { desktop: { x: 4, y: 2, w: 12, h: 4, z: 0 } },
    },
  ],
});

const SECTION = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  type: "freeform",
  position: 0,
  enabled: true,
  content: canvas,
} as unknown as Parameters<typeof SectionSettingsDrawer>[0]["section"];

const canv = plMessages.site.canvas;

/**
 * Szuflada dostaje szkic OD RODZICA i rodzic go stosuje — tak jak w kreatorze
 * (`editor.mutate`). Bez tego pole resynchronizowałoby się do wartości sprzed
 * zmiany i test mierzyłby harness, a nie komponent.
 */
function Harness({ onChange }: { onChange: () => void }) {
  const [current, setCurrent] = useState(canvas);
  return (
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SectionSettingsDrawer
        siteId="99999999-9999-4999-8999-999999999999"
        currency="PLN"
        section={SECTION}
        canvas={current}
        selectedElementId="przycisk-1"
        onCanvasChange={(update) => {
          onChange();
          setCurrent((c) => update(c));
        }}
        onStructuredChange={() => {}}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </NextIntlClientProvider>
  );
}

function renderDrawer(onChange: () => void) {
  return render(<Harness onChange={onChange} />);
}

afterEach(() => cleanup());

describe("pole etykiety przyjmuje pustkę jako stan pośredni", () => {
  it("skasowanie treści ZOSTAJE w polu i mówi wprost, że tego nie zapisze", () => {
    const changes: number[] = [];
    renderDrawer(() => changes.push(1));

    const pole = within(screen.getByRole("dialog")).getByLabelText(canv.label) as HTMLInputElement;
    expect(pole.value).toBe("Zarezerwuj");

    fireEvent.change(pole, { target: { value: "" } });

    expect(pole.value, "pole cofnęło się do starej wartości — pustki nie da się wpisać").toBe("");
    expect(changes, "pustka poszła do szkicu, choć schemat by ją odrzucił").toHaveLength(0);
    expect(screen.getByText(canv.emptyNotSaved)).toBeTruthy();
  });

  it("pierwszy niepusty znak po opróżnieniu wraca do zapisu i gasi komunikat", () => {
    const changes: number[] = [];
    renderDrawer(() => changes.push(1));

    const pole = within(screen.getByRole("dialog")).getByLabelText(canv.label) as HTMLInputElement;
    fireEvent.change(pole, { target: { value: "" } });
    fireEvent.change(pole, { target: { value: "Rezerwuj teraz" } });

    expect(pole.value).toBe("Rezerwuj teraz");
    expect(changes, "wpisana treść nie doszła do szkicu").toHaveLength(1);
    expect(screen.queryByText(canv.emptyNotSaved)).toBeNull();
  });
});
