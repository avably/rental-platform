// @vitest-environment jsdom

/**
 * Ekran ustawień umów po U10 (ADR-151) — warstwa widoku.
 *
 * Audyt UX zmierzył tu dwie usterki (2.18 i 6.3): brak podglądu wygenerowanej
 * umowy („operator zapisuje warunki w ciemno") oraz pola bez instrukcji
 * („Wersja warunków" jako wolne pole tekstowe bez przykładu). Ten plik broni
 * WYNIKU obu poprawek — sama obecność kluczy w `messages/*.json` niczego nie
 * dowodzi, dopóki ekran ich nie renderuje.
 *
 * Podpowiedź jest sprawdzana WRAZ Z WIĄZANIEM (`aria-describedby` → `id`):
 * akapit postawiony obok pola, ale z nim niezwiązany, wygląda w zrzucie
 * identycznie, a dla czytnika ekranu nie istnieje.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/ustawienia-umow",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
// Akcja serwerowa ciągnie klienta Supabase — render jej nie potrzebuje.
vi.mock("@/app/[locale]/(panel)/ustawienia-umow/actions", () => ({
  saveContractSettingsAction: async () => ({}),
}));

const { ContractSettingsForm } = await import(
  "@/app/[locale]/(panel)/ustawienia-umow/contract-settings-form"
);
const { ContractPreviewCard } = await import(
  "@/app/[locale]/(panel)/ustawienia-umow/contract-preview-card"
);
const { CompanyIdentityCard } = await import(
  "@/app/[locale]/(panel)/ustawienia-umow/company-identity-card"
);

const messages = { contractSettings: plMessages.contractSettings };
const t = plMessages.contractSettings;

afterEach(cleanup);

function markup(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {node}
    </NextIntlClientProvider>,
  );
}

function mount(node: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {node}
    </NextIntlClientProvider>,
  );
}

describe("pola warunków mówią, co robią", () => {
  const hints = [
    ["contract-address-hint", t.addressHint],
    ["contract-nip-hint", t.nipHint],
    ["contract-email-hint", t.emailHint],
    ["contract-terms-version-hint", t.termsVersionHint],
    ["contract-terms-body-hint", t.termsBodyHint],
  ] as const;

  it("skan obejmuje wszystkie pola formularza", () => {
    // Kontrola po pustym zbiorze: skurczenie listy do zera zamieniłoby test
    // niżej w pętlę po niczym.
    expect(hints).toHaveLength(5);
  });

  it.each(hints)("%s jest na ekranie i związany z polem", (id, text) => {
    const html = markup(<ContractSettingsForm defaults={null} />);
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain(`aria-describedby="${id}"`);
    expect(html).toContain(text);
  });

  it("wersja warunków ma propozycję, ale zostaje polem do wpisania", () => {
    mount(<ContractSettingsForm defaults={null} />);
    const input = screen.getByLabelText(t.termsVersion) as HTMLInputElement;
    expect(input.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: t.termsVersionSuggest }));
    // Propozycja to DZISIEJSZA data w zapisie RRRR-MM-DD — sprawdzamy kształt
    // i to, że jest z dzisiaj, a nie konkretny łańcuch znaków wpisany na sztywno.
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(input.value).toBe(new Date().toLocaleDateString("sv-SE"));

    // I dalej daje się nadpisać własnym schematem wersjonowania.
    fireEvent.change(input, { target: { value: "1.2" } });
    expect(input.value).toBe("1.2");
  });

  it("zapisana wersja wraca do pola przy kolejnym wejściu na ekran", () => {
    mount(
      <ContractSettingsForm
        defaults={{
          address: "ul. Portowa 4",
          nip: null,
          email: "umowy@example.pl",
          terms_version: "2026-07",
          terms_body: "Warunki.",
        }}
      />,
    );
    expect((screen.getByLabelText(t.termsVersion) as HTMLInputElement).value).toBe("2026-07");
  });
});

describe("karta podglądu umowy", () => {
  it("prowadzi do trasy podglądu w nowej karcie, gdy ustawienia są zapisane", () => {
    const html = markup(<ContractPreviewCard available />);
    expect(html).toContain('data-contract-preview="ready"');
    expect(html).toContain('href="/pl/ustawienia-umow/podglad"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain(t.previewOpen);
    // Obietnica, którą trasa musi utrzymać (test w contract-preview.test.ts).
    expect(html).toContain(t.previewNoTrace);
  });

  it("bez zapisanych ustawień prosi o ich uzupełnienie ZAMIAST dawać martwy odnośnik", () => {
    const html = markup(<ContractPreviewCard available={false} />);
    // Najpierw dowód, że karta w ogóle się wyrenderowała — inaczej asercja
    // „nie ma odnośnika" przeszłaby także dla pustego ekranu.
    expect(html).toContain('data-contract-preview="missing"');
    expect(html).toContain(t.previewMissing);
    expect(html).not.toContain("/pl/ustawienia-umow/podglad");
  });

});

describe("karta danych firmowych (uwagi właściciela #1 i #3)", () => {
  const identity = {
    name: "Wypożyczalnia Pod Lasem",
    legalName: "WYPOŻYCZALNIA POD LASEM SP. Z O.O.",
    nip: "7740001454",
    regon: "610188201",
  };

  it("pokazuje nazwę firmy, NIP i REGON z rejestru", () => {
    const html = markup(<CompanyIdentityCard identity={identity} />);
    expect(html).toContain('data-company-identity="present"');
    expect(html).toContain(identity.legalName);
    expect(html).toContain(identity.nip);
    expect(html).toContain(identity.regon);
  });

  it("mówi, skąd te dane pochodzą i gdzie się je zmienia (uwaga #3)", () => {
    // Uwaga #3: „napisać, że są do zmiany — gdzie, i link". Nazwa firmy w umowie
    // pochodzi z organizacji; link prowadzi tam, gdzie się ją zmienia.
    const html = markup(<CompanyIdentityCard identity={identity} />);
    expect(html).toContain(t.companyDataNote);
    expect(html).toContain(t.companyNameSource);
    expect(html).toContain('href="/organizacja"');
  });

  it("organizacja bez danych z rejestru dostaje wyjaśnienie, nie puste myślniki", () => {
    const html = markup(
      <CompanyIdentityCard identity={{ name: "Nowa", legalName: null, nip: null, regon: null }} />,
    );
    expect(html).toContain('data-company-identity="empty"');
    expect(html).toContain(t.companyDataEmpty);
  });
});
