// @vitest-environment jsdom

/**
 * Przełącznik ban / unban na karcie klienta (R6b, ADR-080) — kontrakt warstwy
 * klienta. Egzekwowanie banu w bazie dowodzi packages/db/test/customer-bans.test.ts
 * (żywy Supabase, dowody mutacyjne); TU pilnujemy UI:
 *
 *  1. stan „aktywny": badge „Aktywny", CTA „Zablokuj klienta";
 *  2. stan „zablokowany": badge „Zablokowany", CTA „Odblokuj klienta";
 *  3. zmiana stanu WYMAGA potwierdzenia w oknie — dopiero submit woła akcję;
 *  4. akcja jest tą związaną server-side (komponent nie wybiera ban vs unban —
 *     dostaje jedną akcję i ją wywołuje).
 *
 * Dowód mutacyjny (opis w raporcie): odwrócenie ternary `banned ? … : …` przy
 * etykiecie CTA → testy 1/2 czerwone (CTA pokaże odwrotną akcję do stanu).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { CustomerBanToggle } from "@/app/[locale]/(panel)/klienci/[id]/customer-ban-toggle";
import type { FormState } from "@/lib/form-state";

import plMessages from "../messages/pl.json";

/** Radix Dialog woła API, których jsdom nie implementuje. */
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

const messages = { customers: { card: { ban: plMessages.customers.card.ban } } };

function renderToggle(
  banned: boolean,
  action: (p: FormState, f: FormData) => Promise<FormState>,
) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <CustomerBanToggle banned={banned} action={action} />
    </NextIntlClientProvider>,
  );
}

const ban = plMessages.customers.card.ban;
const ok = (result: FormState) => async (_p: FormState, _f: FormData): Promise<FormState> => result;

afterEach(() => cleanup());

describe("CustomerBanToggle — stan i etykiety", () => {
  it("klient AKTYWNY: badge stanu aktywnego i CTA blokady", () => {
    renderToggle(false, ok({ success: "banned" }));
    expect(screen.getByText(ban.statusActive)).toBeTruthy();
    expect(screen.getByRole("button", { name: ban.blockCta })).toBeTruthy();
    // NIE pokazuje etykiet stanu przeciwnego.
    expect(screen.queryByText(ban.statusBanned)).toBeNull();
    expect(screen.queryByRole("button", { name: ban.unblockCta })).toBeNull();
  });

  it("klient ZABLOKOWANY: badge stanu zablokowanego i CTA odblokowania", () => {
    renderToggle(true, ok({ success: "unbanned" }));
    expect(screen.getByText(ban.statusBanned)).toBeTruthy();
    expect(screen.getByRole("button", { name: ban.unblockCta })).toBeTruthy();
    expect(screen.queryByText(ban.statusActive)).toBeNull();
    expect(screen.queryByRole("button", { name: ban.blockCta })).toBeNull();
  });
});

describe("CustomerBanToggle — potwierdzenie woła akcję", () => {
  it("blokada: dopiero potwierdzenie w oknie woła akcję (nie sam klik CTA)", async () => {
    const action = vi.fn(ok({ success: "banned" }));
    renderToggle(false, action);

    // Sam klik CTA otwiera okno, ale NIE woła akcji.
    fireEvent.click(screen.getByRole("button", { name: ban.blockCta }));
    expect(action).not.toHaveBeenCalled();

    // Okno pokazuje pytanie potwierdzenia.
    expect(await screen.findByText(ban.confirmBlockTitle)).toBeTruthy();

    // Potwierdzenie (przycisk submit „Zablokuj", dokładna nazwa ≠ „Zablokuj klienta").
    const confirm = screen.getByRole("button", { name: ban.confirmBlock });
    fireEvent.submit(confirm.closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    // Akcja wołana z (prevState, formData) — kontrakt useActionState.
    expect(action.mock.calls[0]!.length).toBe(2);
  });

  it("odblokowanie: potwierdzenie woła (tę samą, związaną) akcję", async () => {
    const action = vi.fn(ok({ success: "unbanned" }));
    renderToggle(true, action);

    fireEvent.click(screen.getByRole("button", { name: ban.unblockCta }));
    expect(await screen.findByText(ban.confirmUnblockTitle)).toBeTruthy();

    const confirm = screen.getByRole("button", { name: ban.confirmUnblock });
    fireEvent.submit(confirm.closest("form")!);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});
