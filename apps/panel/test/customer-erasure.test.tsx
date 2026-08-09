// @vitest-environment jsdom

/**
 * Sekcja usunięcia danych klienta (C2b, ADR-116) — kontrakt warstwy klienta.
 * Zasięg operacji i izolację dowodzi packages/db/test/customer-erasure.test.ts
 * (żywy Supabase); TU pilnujemy jedynej rzeczy, której baza nie obroni:
 * ŻEBY OPERACJA NIEODWRACALNA NIE WYDARZYŁA SIĘ JEDNYM PRZYPADKOWYM KLIKNIĘCIEM.
 *
 *  1. sama sekcja nie wywołuje niczego — akcja rusza dopiero po potwierdzeniu;
 *  2. przycisk potwierdzenia jest MARTWY przy pustym polu (nie da się „kliknąć
 *     dalej" bez świadomego przepisania adresu);
 *  3. treść mówi WPROST, co znika, a co zostaje — to jedyne miejsce, gdzie
 *     operator dowiaduje się o notatkach i o zachowanych rozliczeniach;
 *  4. odmowa z serwera zostaje w oknie przy polu, a okno się NIE zamyka —
 *     inaczej operator zobaczyłby zniknięcie okna i uznał, że usunięto dane.
 *
 * Dowód mutacyjny (opis w raporcie): zdjęcie `typed.trim().length === 0`
 * z `disabled` przycisku potwierdzenia → test 2 czerwony.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CustomerErasure } from "@/app/[locale]/(panel)/klienci/[id]/customer-erasure";
import type { FormState } from "@/lib/form-state";

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

const messages = { customers: { card: { erasure: plMessages.customers.card.erasure } } };
const copy = plMessages.customers.card.erasure;
const EMAIL = "anna@example.com";

function renderSection(action: (p: FormState, f: FormData) => Promise<FormState>) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <CustomerErasure email={EMAIL} action={action} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("CustomerErasure — bramka świadomego potwierdzenia", () => {
  it("mówi wprost, co znika i co zostaje", () => {
    renderSection(async () => ({}));

    expect(screen.getByText(copy.heading)).toBeTruthy();
    expect(screen.getByText(copy.scope)).toBeTruthy();
  });

  it("samo otwarcie okna NIE wywołuje akcji", async () => {
    const action = vi.fn(async (): Promise<FormState> => ({ success: "erased" }));
    renderSection(action);

    fireEvent.click(screen.getByText(copy.cta));
    await screen.findByText(copy.confirmTitle);

    expect(action).not.toHaveBeenCalled();
  });

  it("przycisk potwierdzenia jest MARTWY, dopóki pole jest puste", async () => {
    const action = vi.fn(async (): Promise<FormState> => ({ success: "erased" }));
    renderSection(action);

    fireEvent.click(screen.getByText(copy.cta));
    const confirm = (await screen.findByText(copy.confirm)).closest("button")!;

    expect(confirm.hasAttribute("disabled")).toBe(true);

    const input = document.querySelector("[data-customer-erasure-input]") as HTMLInputElement;
    fireEvent.change(input, { target: { value: EMAIL } });

    await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
  });

  it("odmowa z serwera zostaje przy polu, a okno NIE znika", async () => {
    const action = vi.fn(
      async (): Promise<FormState> => ({ fieldErrors: { confirmation: "Wpisz dokładnie adres." } }),
    );
    renderSection(action);

    fireEvent.click(screen.getByText(copy.cta));
    const input = (await screen.findByLabelText(
      copy.confirmLabel.replace("{email}", EMAIL),
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "cos-innego" } });
    fireEvent.click(screen.getByText(copy.confirm));

    await screen.findByText("Wpisz dokładnie adres.");
    // Tytuł okna nadal na ekranie = okno się nie zamknęło.
    expect(screen.getByText(copy.confirmTitle)).toBeTruthy();
  });
});
