// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

import { DateRangeField } from "@/lib/fields/date-fields";

const messages = {
  common: {
    dateField: {
      placeholder: "Wybierz datę",
      rangePlaceholder: "Wybierz termin",
    },
  },
};

let desktop = false;
const mediaListeners = new Set<() => void>();

function setDesktop(next: boolean) {
  desktop = next;
  act(() => {
    for (const listener of mediaListeners) listener();
  });
}

function RangeHarness() {
  const [range, setRange] = React.useState({ from: "", to: "" });

  return (
    <NextIntlClientProvider locale="pl" messages={messages}>
      <DateRangeField
        id="termin"
        fromName="od"
        toName="do"
        from={range.from}
        to={range.to}
        onChange={setRange}
      />
    </NextIntlClientProvider>
  );
}

function dayButton(day: number): HTMLButtonElement {
  const label = new Date(2026, 6, day).toLocaleDateString("pl-PL");
  const button = document.querySelector<HTMLButtonElement>(`button[data-day="${label}"]`);
  if (!button) throw new Error(`Brak przycisku dnia ${label}`);
  return button;
}

beforeEach(() => {
  desktop = false;
  mediaListeners.clear();
  vi.setSystemTime(new Date(2026, 6, 1, 12));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(min-width: 768px)" ? desktop : false,
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => mediaListeners.delete(listener),
      addListener: (listener: () => void) => mediaListeners.add(listener),
      removeListener: (listener: () => void) => mediaListeners.delete(listener),
      dispatchEvent: () => true,
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DateRangeField", () => {
  it("po pierwszym kliknięciu zostawia popover otwarty, a zamyka go po wyborze końca", async () => {
    render(<RangeHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Wybierz termin" }));
    fireEvent.click(dayButton(9));

    expect(screen.getByRole("grid")).toBeTruthy();
    expect(document.querySelector<HTMLInputElement>('input[name="od"]')?.value).toBe("2026-07-09");

    fireEvent.click(dayButton(11));

    await waitFor(() => expect(screen.queryByRole("grid")).toBeNull());
    expect(document.querySelector<HTMLInputElement>('input[name="do"]')?.value).toBe("2026-07-11");
  });

  it("renderuje jeden miesiąc na mobile i dwa od 768 px", async () => {
    render(<RangeHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Wybierz termin" }));
    expect(screen.getAllByRole("grid")).toHaveLength(1);

    setDesktop(true);

    await waitFor(() => expect(screen.getAllByRole("grid")).toHaveLength(2));
  });
});
