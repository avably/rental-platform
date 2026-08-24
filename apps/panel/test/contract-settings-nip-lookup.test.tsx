// @vitest-environment jsdom

/**
 * „Pobierz z GUS" przy adresie firmy (uwagi właściciela #1) — ta sama akcja
 * serwerowa co w onboardingu (ADR-234), ale TU nic nie jest zablokowane: NIP
 * w contract_document zostaje opcjonalny (CHECK 0026 niezmieniony), a przycisk
 * to wygoda — prefill ROZBITEGO adresu (ulica / kod / miasto). Adres kanoniczny
 * idzie ukrytym polem `address` złożonym z tych trzech pól.
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

function renderForm(props: Parameters<typeof ContractSettingsForm>[0] = { defaults: null }) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <ContractSettingsForm {...props} />
    </NextIntlClientProvider>,
  );
}

function nipInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("input[name='nip']")!;
}
function streetInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("#contract-address-street")!;
}
function zipInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("#contract-address-zip")!;
}
function cityInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("#contract-address-city")!;
}
/** Ukryte pole kanoniczne, które faktycznie trafia do server action. */
function addressHidden(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("input[type='hidden'][name='address']")!;
}
function lookupButton(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>("[data-nip-lookup-button]")!;
}

const ORLEN = {
  ok: true as const,
  nip: VALID_NIP,
  legalName: "ORLEN SA",
  regon: "610188201",
  krs: null,
  address: { street: "Chemików 7", zip: "09-411", city: "Płock" },
  statusVat: "Czynny",
  source: "mf" as const,
  fetchedAt: "2026-08-24T00:00:00Z",
  requestId: "abc",
};

afterEach(cleanup);
beforeEach(() => lookupMock.mockReset());

describe("ustawienia-umow — „Pobierz z GUS” przy adresie", () => {
  it("przycisk nieaktywny bez poprawnego NIP; pole NIP zostaje opcjonalne", () => {
    renderForm();
    expect(lookupButton().disabled).toBe(true);
    // Pole NIP i tak NIE jest `required` — bonus nie zmienia CHECK-u 0026.
    expect(nipInput().required).toBe(false);
  });

  it("zweryfikowany NIP organizacji (companyNip) włącza przycisk bez wpisywania NIP-u", () => {
    renderForm({ defaults: null, companyNip: VALID_NIP });
    expect(lookupButton().disabled).toBe(false);
  });

  it("udana weryfikacja ROZBIJA adres na pola i składa go w ukrytym polu", async () => {
    lookupMock.mockResolvedValue(ORLEN);

    renderForm();
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => {
      expect(streetInput().value).toBe("Chemików 7");
    });
    expect(zipInput().value).toBe("09-411");
    expect(cityInput().value).toBe("Płock");
    // Kanoniczny łańcuch złożony z trzech pól — to on idzie do bazy.
    expect(addressHidden().value).toBe("Chemików 7, 09-411 Płock");
    expect(screen.getByText(/Znaleziono: ORLEN SA/)).toBeTruthy();

    // Edytowalne — bonus nie zamyka pól na sztywno.
    fireEvent.change(streetInput(), { target: { value: "Inna 5" } });
    expect(streetInput().value).toBe("Inna 5");
    expect(addressHidden().value).toBe("Inna 5, 09-411 Płock");
  });

  it("companyNip ma pierwszeństwo nad NIP-em wpisanym w polu", async () => {
    lookupMock.mockResolvedValue(ORLEN);
    renderForm({ defaults: null, companyNip: VALID_NIP });
    // Pole NIP puste, ale przycisk pyta o zweryfikowany NIP organizacji.
    fireEvent.click(lookupButton());
    await waitFor(() => expect(lookupMock).toHaveBeenCalledWith(VALID_NIP));
  });

  it("błąd rejestru pokazuje komunikat i NIE rusza adresu", async () => {
    lookupMock.mockResolvedValue({ ok: false, reason: "not_found", message: "x" });

    renderForm();
    fireEvent.change(streetInput(), { target: { value: "Adres wpisany ręcznie" } });
    fireEvent.change(nipInput(), { target: { value: VALID_NIP } });
    fireEvent.click(lookupButton());

    await waitFor(() => {
      expect(screen.getByText(messages.contractSettings.nipErrorNotFound)).toBeTruthy();
    });
    expect(streetInput().value).toBe("Adres wpisany ręcznie");
  });

  it("wchodzi z zapisanym adresem rozbitym na pola", () => {
    renderForm({
      defaults: {
        address: "Chemików 7, 09-411 Płock",
        nip: null,
        email: "a@b.pl",
        terms_version: "2026-07",
        terms_body: "Treść.",
      },
    });
    expect(streetInput().value).toBe("Chemików 7");
    expect(zipInput().value).toBe("09-411");
    expect(cityInput().value).toBe("Płock");
  });
});
