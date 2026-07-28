// @vitest-environment jsdom

/**
 * Wejście w przedłużenie PRZY TERMINIE (R4) — relokacja UI do karty
 * podsumowania. Mechanikę wyceny/akcji/bramki 0010 dowodzą osobne suity
 * (extension-pricing, extensions, packages/db/order-extension); TU pilnujemy
 * DWÓCH rzeczy, których tamte nie widzą:
 *
 *  1. wejście widać TYLKO w statusach, w których przedłużenie jest dozwolone
 *     (asercja na WARTOŚCI predykatu dla KAŻDEGO statusu, nie na obecności);
 *  2. wybór nowej daty końca przelicza dopłatę NA ŻYWO z extension-pricing
 *     (asercja na WARTOŚĆ dopłaty równą silnikowi) i niesie tę datę do submitu.
 *
 * Dowód mutacyjny (opis w raporcie): wyłączenie przeliczania w memo formularza
 * (`if (false && newEndDate)`) gasi dopłatę → test „przelicza dopłatę" czerwony.
 */

import {
  AVAILABILITY_BLOCKING_ORDER_STATUSES,
  ORDER_STATUSES,
  formatMoney,
  type PriceParams,
} from "@avably/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canExtendOrder,
  quoteOrderExtension,
} from "@/app/[locale]/(panel)/zamowienia/[id]/extension-pricing";
import { ExtensionForm } from "@/app/[locale]/(panel)/zamowienia/[id]/extension-form";

/** Tylko przestrzenie, których dotyka to wejście — reszta katalogu bez znaczenia. */
const messages = {
  common: {
    dateField: { placeholder: "Wybierz datę", rangePlaceholder: "Wybierz termin" },
  },
  orders: {
    extension: {
      trigger: "Przedłuż",
      newEndLabel: "Nowa data końca",
      quoteDays: "Dodatkowe dni: {days}",
      quoteSurcharge: "Dopłata: {amount}",
      pickDateHint: "Wybierz datę po obecnym końcu najmu, aby zobaczyć dopłatę.",
      cta: "Przedłuż najem",
      cancel: "Anuluj",
    },
  },
};

/** Cennik jak w extensions.test.ts: baza 100 zł, próg 7 dni ×6.5, kaucja 50 zł. */
const ZAGESZCZARKA: PriceParams = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  autoIncrementMultiplier: 1.0,
  tiers: [{ tierDays: 7, multiplier: 6.5 }],
};

const ORDER_ID = "00000000-0000-4000-8000-000000000001";
const START = "2027-03-01";
const END = "2027-03-05";
const ITEMS = [{ itemId: "i1", params: ZAGESZCZARKA }];

function Harness() {
  return (
    <NextIntlClientProvider locale="pl" messages={messages}>
      <ExtensionForm
        orderId={ORDER_ID}
        startDate={START}
        endDate={END}
        items={ITEMS}
        currency="PLN"
        locale="pl"
        action={async () => ({})}
      />
    </NextIntlClientProvider>
  );
}

/** Przycisk dnia w kalendarzu react-day-picker (atrybut `data-day`). */
function dayButton(year: number, monthIndex: number, day: number): HTMLButtonElement {
  const label = new Date(year, monthIndex, day).toLocaleDateString("pl-PL");
  const button = document.querySelector<HTMLButtonElement>(`button[data-day="${label}"]`);
  if (!button) throw new Error(`Brak przycisku dnia ${label}`);
  return button;
}

function hidden(name: string): string | undefined {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })),
  });
});

afterEach(() => cleanup());

describe("canExtendOrder — wejście tylko w statusach, w których przedłużenie jest dozwolone", () => {
  it("dla KAŻDEGO statusu predykat == przynależność do AVAILABILITY_BLOCKING", () => {
    for (const status of ORDER_STATUSES) {
      expect(canExtendOrder(status), status).toBe(
        AVAILABILITY_BLOCKING_ORDER_STATUSES.includes(status),
      );
    }
    // Twarde piny, żeby test nie był tautologią (gdyby ktoś podmienił OBIE
    // strony na to samo puste kryterium): terminalne NIE, aktywny TAK.
    expect(canExtendOrder("returned")).toBe(false);
    expect(canExtendOrder("cancelled")).toBe(false);
    expect(canExtendOrder("reserved")).toBe(true);
    expect(canExtendOrder("picked_up")).toBe(true);
  });
});

describe("ExtensionForm — przycisk „Przedłuż” przy terminie odsłania wybór daty", () => {
  it("na wejściu widać tylko przycisk, kalendarza i dopłaty jeszcze nie ma", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Przedłuż" })).toBeTruthy();
    expect(document.querySelector("[data-extension-form]")).toBeNull();
  });

  it("wybór nowej daty końca przelicza dopłatę NA ŻYWO z extension-pricing", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Przedłuż" }));
    expect(document.querySelector("[data-extension-form]")).not.toBeNull();
    // Przed wyborem daty: podpowiedź, żadnej kwoty.
    expect(screen.getByText(messages.orders.extension.pickDateHint)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Nowa data końca" }));
    fireEvent.click(dayButton(2027, 2, 8)); // 2027-03-08

    // Dopłata liczona z tego samego czystego modułu, którego używa akcja —
    // asercja na WARTOŚĆ, nie na samą obecność napisu.
    const expected = quoteOrderExtension({ startDate: START, endDate: END }, "2027-03-08", ITEMS);
    expect(expected.additionalRentalGrosze).toBe(25_000); // pin: 5→8 dni przy progu 7
    const amount = formatMoney(expected.additionalRentalGrosze, "PLN", "pl");

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`Dopłata:\\s*${amount.replace(/\s/g, "\\s")}`))).toBeTruthy();
    });
    expect(screen.getByText(/Dodatkowe dni:\s*3/)).toBeTruthy();
  });

  it("submit niesie NOWĄ datę końca oraz optymistyczną współbieżność", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Przedłuż" }));
    fireEvent.click(screen.getByRole("button", { name: "Nowa data końca" }));
    fireEvent.click(dayButton(2027, 2, 8));

    await waitFor(() => expect(hidden("newEndDate")).toBe("2027-03-08"));
    expect(hidden("orderId")).toBe(ORDER_ID);
    expect(hidden("expectedEndDate")).toBe(END);
    // CTA odblokowane, bo jest wycena.
    expect((screen.getByRole("button", { name: "Przedłuż najem" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
