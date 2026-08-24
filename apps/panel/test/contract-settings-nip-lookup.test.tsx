// @vitest-environment jsdom

/**
 * BONUS (ADR-234, brief SPEC D): przycisk „Pobierz dane" przy polu NIP w
 * ustawieniach umów — sama akcja co w onboardingu, ale TU nic nie jest
 * zablokowane (NIP w contract_document zostaje opcjonalny, CHECK 0026
 * niezmieniony). Przycisk to wygoda: prefill adresu po udanej weryfikacji.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/ustawienia-umow",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/app/[locale]/(panel)/ustawienia-umow/actions", () => ({
  saveContractSettingsAction: async () => ({}),
}));

const lookupMock = vi.fn();
vi.mock("@/lib/registry/lookup-action", () => ({
  lookupCompanyByNipAction: (...args: unknown[]) => lookupMock(...args),
}));

const { ContractSettingsForm } = await import(
  "@/app/[locale]/(panel)/ustawienia-umow/contract-settings-form"
);

const messages = { contractSettings: plMessages.contractSettings };
const VALID_NIP = "7740001454";

function renderForm() {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <ContractSettingsForm defaults={null} />
    </NextIntlClientProvider>,
  );
}

function nipInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("input[name='nip']")!;
}
function addressField(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>("textarea[name='address']")!;
}
function lookupButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[data-nip-lookup-button]")!;
}

afterEach(cleanup);
beforeEach(() => lookupMock.mockReset());

describe("ustawienia-umow — bonus „Pobierz dane” przy NIP", () => {
  it("przycisk nieaktywny bez poprawnej sumy kontrolnej, NIP zostaje opcjonalny (formularz da się zapisać bez niego)", () => {
    renderForm();
    expect(lookupButton().disabled).toBe(true);
    // Pole NIP i tak NIE jest `required` — bonus nie zmienia CHECK-u 0026.
    expect(nipInput().required).toBe(false);
  });

  it("udana weryfikacja PREFILLUJE adres, zostawiając go edytowalnym", async () => {
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

    await waitFor(() => {
      expect(addressField().value).toBe("Chemików 7, 09-411 Płock");
    });
    expect(screen.getByText(/Znaleziono: ORLEN SA/)).toBeTruthy();

    // Edytowalny — bonus nie zamyka pola na sztywno.
    fireEvent.change(addressField(), { target: { value: "Inny adres 5" } });
    expect(addressField().value).toBe("Inny adres 5");
  });

  it("błąd rejestru pokazuje komunikat i NIE rusza adresu", async () => {
    lookupMock.mockResolvedValue({ ok: false, reason: "not_found", message: "x" });

    renderForm();
    fireEvent.change(addressField(), { target: { value: "Adres wpisany ręcznie" } });
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => {
      expect(screen.getByText(messages.contractSettings.nipErrorNotFound)).toBeTruthy();
    });
    expect(addressField().value).toBe("Adres wpisany ręcznie");
  });
});
