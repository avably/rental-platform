// @vitest-environment jsdom

/**
 * NIP WYMAGANY I WERYFIKOWANY przy zakładaniu organizacji (ADR-234).
 *
 * Gate zachowaniowy formularza: przycisk „Załóż organizację" jest
 * NIEAKTYWNY, dopóki `lookupCompanyByNipAction` nie zwróci sukcesu, i WRACA
 * do nieaktywnego stanu, gdy pole NIP zmieni się PO udanej weryfikacji (żeby
 * „zielona" etykieta nie została po cichu przy innym NIP-ie niż ten, który
 * faktycznie poszedł do serwera). Prawdziwa bramka bezpieczeństwa stoi w RPC
 * (packages/db/test/nip-lookup-cache.test.ts) — ten plik dowodzi WYŁĄCZNIE
 * UX gate'u formularza, z zamockowaną akcją serwerową.
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

  it("„nie znaleziono” pokazuje komunikat i submit ZOSTAJE zablokowany", async () => {
    lookupMock.mockResolvedValue({
      ok: false,
      reason: "not_found",
      message: "Nie znaleźliśmy firmy o tym NIP.",
    });

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => {
      expect(screen.getByText(messages.newOrganization.nipErrorNotFound)).toBeTruthy();
    });
    expect(submitButton().disabled).toBe(true);
  });

  it("„rejestr niedostępny” pokazuje odpowiedni komunikat (rozróżnienie od „nie znaleziono”)", async () => {
    lookupMock.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Rejestr chwilowo niedostępny, spróbuj ponownie.",
    });

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => {
      expect(screen.getByText(messages.newOrganization.nipErrorUnavailable)).toBeTruthy();
    });
    expect(screen.queryByText(messages.newOrganization.nipErrorNotFound)).toBeNull();
  });
});
