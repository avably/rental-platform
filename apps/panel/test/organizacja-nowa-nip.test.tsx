// @vitest-environment jsdom

/**
 * NIP WYMAGANY przy zakładaniu organizacji (ADR-234) + DRUGA DROGA: DANE
 * RĘCZNE, gdy rejestr nie potwierdza firmy (ADR-276).
 *
 * Gate zachowaniowy formularza: przycisk „Utwórz organizację" jest
 * NIEAKTYWNY, dopóki `lookupCompanyByNipAction` nie odpowie, i WRACA do
 * nieaktywnego stanu, gdy pole NIP zmieni się PO odpowiedzi (żeby stan nie
 * został po cichu przy innym NIP-ie niż ten, który faktycznie poszedł do
 * serwera). Od ADR-276 odblokować go może DWOJE: udana weryfikacja ALBO
 * otwarta sekcja ręczna. Prawdziwa bramka bezpieczeństwa stoi w RPC
 * (packages/db/test/manual-company-identity.test.ts) — ten plik dowodzi
 * WYŁĄCZNIE zachowania formularza, z zamockowaną akcją serwerową.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

vi.mock("@/app/[locale]/(panel)/organizacja/nowa/actions", () => ({
  createTenantAction: async () => ({}),
}));

const lookupMock = vi.fn();
vi.mock("@/lib/registry/lookup-action", () => ({
  lookupCompanyByNipAction: (...args: unknown[]) => lookupMock(...args),
}));

const { CreateTenantForm } = await import("@/app/[locale]/(panel)/organizacja/nowa/form");

function renderForm() {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <CreateTenantForm terms={null} />
    </NextIntlClientProvider>,
  );
}

const VALID_NIP = "7740001454"; // PKN ORLEN — zweryfikowany na żywo w MF Białej liście
const INVALID_CHECKSUM_NIP = "7740001450";

function nipInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("input[name='nip']")!;
}

function lookupButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[data-nip-lookup-button]")!;
}

function submitButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[data-submit-create-tenant]")!;
}

function manualSection(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-manual-company-section]");
}

function manualLegalNameInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>("input[name='legalName']");
}

/** Odpowiedź POZYTYWNA hybrydy MF/GUS — wspólna dla przypadków ścieżki szczęśliwej. */
const FOUND_RESULT = {
  ok: true,
  nip: "7740001454",
  legalName: "POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA",
  regon: "610188201",
  krs: "0000028860",
  address: { street: "Chemików 7", zip: "09-411", city: "Płock" },
  statusVat: "Czynny",
  source: "mf",
  fetchedAt: "2026-08-24T00:00:00Z",
  requestId: "abc",
} as const;

afterEach(cleanup);
beforeEach(() => {
  lookupMock.mockReset();
});

describe("pole NIP + przycisk „Pobierz dane” (ADR-234)", () => {
  it("submit jest NIEAKTYWNY na starcie, zanim ktokolwiek dotknie NIP-u", () => {
    renderForm();
    expect(submitButton().disabled).toBe(true);
  });

  it("przycisk „Pobierz dane” jest nieaktywny, dopóki suma kontrolna NIP-u jest zła", () => {
    renderForm();
    fireEvent.change(nipInput(), { target: { value: INVALID_CHECKSUM_NIP } });
    expect(lookupButton().disabled).toBe(true);
  });

  it("poprawna suma kontrolna odblokowuje przycisk, ale submit ZOSTAJE zablokowany do sukcesu", () => {
    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    expect(lookupButton().disabled).toBe(false);
    expect(submitButton().disabled).toBe(true);
  });

  it("udana weryfikacja pokazuje znalezioną firmę i ODBLOKOWUJE submit", async () => {
    lookupMock.mockResolvedValue({
      ok: true,
      nip: VALID_NIP,
      legalName: "POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA",
      regon: "610188201",
      krs: "0000028860",
      address: { street: "Chemików 7", zip: "09-411", city: "Płock" },
      statusVat: "Czynny",
      source: "mf",
      fetchedAt: "2026-08-24T00:00:00Z",
      requestId: "abc",
    });

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => {
      expect(screen.getByText(/POLSKI KONCERN NAFTOWY ORLEN/)).toBeTruthy();
    });
    expect(lookupMock).toHaveBeenCalledWith(VALID_NIP);
    expect(submitButton().disabled).toBe(false);
  });

  it("zmiana NIP-u PO udanej weryfikacji cofa gate — submit znów nieaktywny", async () => {
    lookupMock.mockResolvedValue({
      ok: true,
      nip: VALID_NIP,
      legalName: "ORLEN SA",
      regon: "610188201",
      krs: null,
      address: { street: "Chemików 7", zip: "09-411", city: "Płock" },
      statusVat: "Czynny",
      source: "mf",
      fetchedAt: "2026-08-24T00:00:00Z",
      requestId: "abc",
    });

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());
    await waitFor(() => expect(submitButton().disabled).toBe(false));

    fireEvent.change(nipInput(), { target: { value: "1111111111" } });
    expect(submitButton().disabled).toBe(true);
  });

  it("ścieżka szczęśliwa: udana weryfikacja NIE pokazuje sekcji ręcznej", async () => {
    lookupMock.mockResolvedValue(FOUND_RESULT);

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => expect(submitButton().disabled).toBe(false));
    // ADR-276 zmienia WYŁĄCZNIE ścieżki nieszczęśliwe — kto ma firmę w
    // rejestrze, nie przepisuje niczego z palca.
    expect(manualSection()).toBeNull();
    expect(manualLegalNameInput()).toBeNull();
  });
});

/**
 * ADR-276 — DRUGA DROGA. Każdy powód odmowy rejestru poza złą sumą kontrolną
 * otwiera sekcję ręczną i ODBLOKOWUJE submit. Komunikaty są rozróżnione:
 * do ADR-276 trzy z czterech powodów wyświetlały to samo „Rejestr chwilowo
 * niedostępny, spróbuj ponownie" — radę, która w żadnym z nich nie działała.
 */
describe("dane firmowe wpisane ręcznie (ADR-276)", () => {
  const MANUAL_CASES = [
    { reason: "not_found", messageKey: "nipErrorNotFound" },
    { reason: "unavailable", messageKey: "nipErrorUnavailable" },
    { reason: "unconfigured", messageKey: "nipErrorUnconfigured" },
    { reason: "rate_limited", messageKey: "nipErrorRateLimited" },
  ] as const;

  for (const { reason, messageKey } of MANUAL_CASES) {
    it(`„${reason}” pokazuje WŁASNY komunikat, otwiera sekcję ręczną i ODBLOKOWUJE submit`, async () => {
      lookupMock.mockResolvedValue({ ok: false, reason, message: "z serwera" });

      renderForm();
      fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
      fireEvent.click(lookupButton());

      await waitFor(() => {
        expect(screen.getByText(messages.newOrganization[messageKey])).toBeTruthy();
      });
      expect(manualSection()).not.toBeNull();
      expect(submitButton().disabled).toBe(false);

      // Nazwa rejestrowa jest WYMAGANA dopiero tutaj — pole nie istnieje,
      // dopóki sekcja nie jest wyrenderowana.
      const legalName = manualLegalNameInput();
      expect(legalName).not.toBeNull();
      expect(legalName!.required).toBe(true);
      // REGON zostaje opcjonalny (GUS wystawia go nie każdemu).
      const regon = document.querySelector<HTMLInputElement>("input[name='regon']");
      expect(regon).not.toBeNull();
      expect(regon!.required).toBe(false);
    });
  }

  it("komunikaty czterech powodów są RÓŻNE — żaden nie zlewa się z innym", () => {
    const texts = MANUAL_CASES.map(({ messageKey }) => messages.newOrganization[messageKey]);
    expect(new Set(texts).size).toBe(texts.length);
    // Kontrola pozytywna zdania z briefu: „nie znaleziono" mówi o wykazie
    // VAT (a nie „o tym NIP"), bo to jest realna przyczyna u podatnika
    // zwolnionego podmiotowo.
    expect(messages.newOrganization.nipErrorNotFound).toContain("wykazie VAT");
  });

  it("zła suma kontrolna NIE otwiera sekcji ręcznej i NIE odblokowuje submitu", async () => {
    // Jedyny powód, który użytkownik naprawia sam i w miejscu: dane firmowe
    // nie mają czym uzupełnić NIP-u, którego baza i tak odrzuci.
    lookupMock.mockResolvedValue({
      ok: false,
      reason: "invalid_checksum",
      message: "Nieprawidłowy NIP.",
    });

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => {
      expect(screen.getByText(messages.newOrganization.nipErrorInvalidChecksum)).toBeTruthy();
    });
    expect(manualSection()).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it("zmiana NIP-u PO otwarciu sekcji ręcznej cofa ją RAZEM z odblokowanym submitem", async () => {
    lookupMock.mockResolvedValue({ ok: false, reason: "not_found", message: "z serwera" });

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());
    await waitFor(() => expect(submitButton().disabled).toBe(false));
    expect(manualSection()).not.toBeNull();

    // Inaczej user odblokowałby formularz NIP-em A, wpisał NIP B i wysłał
    // dane firmowe, które tego drugiego nie dotyczą.
    fireEvent.change(nipInput(), { target: { value: "1111111111" } });
    expect(submitButton().disabled).toBe(true);
    expect(manualSection()).toBeNull();
  });

  it("sekcja ręczna mówi WPROST, że dane zostaną zweryfikowane później", async () => {
    lookupMock.mockResolvedValue({ ok: false, reason: "unconfigured", message: "z serwera" });

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => expect(manualSection()).not.toBeNull());
    expect(screen.getByText(messages.newOrganization.manualNote)).toBeTruthy();
    expect(messages.newOrganization.manualNote).toContain("zweryfikujemy je później");
  });
});
