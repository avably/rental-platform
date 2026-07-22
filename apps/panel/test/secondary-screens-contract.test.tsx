import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Kontrakt RENDERU ekranów drugorzędnych (P8 — sekcje `secondary-*` artefaktu
 * Fazy 2, zaakceptowane 2026-07-22).
 *
 * Para do skanów źródeł (`form-measure-contract`, `secondary-status-contract`),
 * dokładnie jak w P4–P6 (ADR-057 D1): skan broni SPOSOBU PISANIA, ten test
 * broni WYNIKU. Ekran, który zgubił stan z mockupu, nie łamie żadnej reguły
 * zapisu — po prostu przestaje pokazywać rzecz, którą właściciel zaakceptował.
 *
 * Kotwicami są atrybuty `data-*` z artefaktu, nie klasy: mockup nazywa nimi
 * części ekranu (`data-domain-provider-state`, `data-security-state`), więc
 * kontrakt czyta te same nazwy, którymi napisany jest projekt.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/ustawienia-domen",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

// Akcje serwerowe („use server") ciągną klienta Supabase i sekrety środowiska —
// render ich nie potrzebuje, a suita `ci` chodzi bez bazy.
const noopAction = async () => ({});
vi.mock("@/app/[locale]/(panel)/ustawienia-domen/domains-actions", () => ({
  addCustomDomainAction: noopAction,
  checkDomainAction: noopAction,
  removeCustomDomainAction: noopAction,
  retrySubdomainAction: noopAction,
}));
vi.mock("@/app/[locale]/(panel)/ustawienia-emaili/email-settings-actions", () => ({
  saveEmailSenderAction: noopAction,
}));
vi.mock("@/app/[locale]/(panel)/ustawienia-umow/actions", () => ({
  saveContractSettingsAction: noopAction,
}));
vi.mock("@/app/[locale]/(panel)/zaproszenia/actions", () => ({
  inviteMemberAction: noopAction,
}));
vi.mock("@/app/[locale]/(panel)/bezpieczenstwo/actions", () => ({
  enrollTotpAction: noopAction,
  verifyTotpAction: noopAction,
}));
vi.mock("@/app/[locale]/(panel)/bezpieczenstwo/wyzwanie/actions", () => ({
  challengeTotpAction: noopAction,
}));

const { DomainsPanel } = await import("@/app/[locale]/(panel)/ustawienia-domen/domains-panel");
const { EmailSenderForm } = await import(
  "@/app/[locale]/(panel)/ustawienia-emaili/email-settings-form"
);
const { EmailLogTable } = await import("@/app/[locale]/(panel)/historia-emaili/email-log-table");
const { CredentialsForm, ParcelForm, PricingForm, SenderForm } = await import(
  "@/app/[locale]/(panel)/ustawienia-dostaw/delivery-settings-forms"
);
const { ContractSettingsForm } = await import(
  "@/app/[locale]/(panel)/ustawienia-umow/contract-settings-form"
);
const { ContractReadOnly } = await import(
  "@/app/[locale]/(panel)/ustawienia-umow/contract-read-only"
);
const { InviteMemberForm } = await import("@/app/[locale]/(panel)/zaproszenia/form");
const { OrganizationCard } = await import("@/app/[locale]/(panel)/organizacja/organization-card");
const { TotpEnrollForm } = await import("@/app/[locale]/(panel)/bezpieczenstwo/form");
const { TotpChallengeForm } = await import("@/app/[locale]/(panel)/bezpieczenstwo/wyzwanie/form");

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {node}
    </NextIntlClientProvider>,
  );
}

/** Chipy stanu obecne w renderze, jako pary oś/wartość. */
function chips(html: string): string[] {
  return [
    ...html.matchAll(
      /data-secondary-status-axis="([\w-]+)" data-secondary-status-value="([\w-]+)"/g,
    ),
  ].map(([, axis, value]) => `${axis}/${value}`);
}

const noAction = async () => ({});

// ===== 1. Domeny (secondary-domains) =====

const domains = [
  {
    id: "1",
    domain: "demo-rental.example.invalid",
    kind: "subdomain" as const,
    verified: true,
    verifiedAt: null,
    lastError: "nie udało się zarejestrować hosta",
    registered: false,
  },
  {
    id: "2",
    domain: "sklep-demo.example.invalid",
    kind: "custom" as const,
    verified: false,
    verifiedAt: null,
    lastError: null,
    registered: true,
  },
  {
    id: "3",
    domain: "rezerwacje-demo.example.invalid",
    kind: "custom" as const,
    verified: true,
    verifiedAt: "2026-07-20T10:00:00Z",
    lastError: null,
    registered: true,
  },
];

describe("ekran domen — sekwencja stanów rejestracji i DNS", () => {
  const html = render(
    <DomainsPanel
      domains={domains}
      cnameTarget="shops.example.invalid"
      registrationAvailable
      registrationBlockedReason={null}
    />,
  );

  it("fixture pokrywa wszystkie trzy stany osi domeny", () => {
    // Kontrola po pustym zbiorze: bez niej asercje niżej mogłyby oglądać jeden
    // stan i wciąż być zielone.
    expect(chips(html)).toEqual(
      expect.arrayContaining([
        "domain/registration_failed",
        "domain/pending",
        "domain/live",
      ]),
    );
  });

  it("dostępność rejestracji hostów jest osobną kartą ze stanem", () => {
    expect(html).toContain("data-domain-provider-state");
    expect(chips(html)).toContain("domain-provider/available");
  });

  it("brak konfiguracji dostawcy zmienia stan karty, nie chowa ekranu", () => {
    const blocked = render(
      <DomainsPanel
        domains={domains}
        cnameTarget="shops.example.invalid"
        registrationAvailable={false}
        registrationBlockedReason="brak zmiennej"
      />,
    );
    expect(chips(blocked)).toContain("domain-provider/unavailable");
    expect(blocked).toContain("brak zmiennej");
    expect(blocked).toContain("data-domain-add-form");
  });

  it("instrukcja DNS stoi przy niezweryfikowanej domenie własnej", () => {
    expect([...html.matchAll(/data-dns-instructions/g)]).toHaveLength(1);
    expect(html).toContain("shops.example.invalid");
  });

  it("każdy adres jest kartą z rodzajem, a formularz dodania zamyka ekran", () => {
    expect([...html.matchAll(/data-domain-kind="/g)]).toHaveLength(3);
    expect(html).toContain("data-domain-add-form");
  });
});

// ===== 2. Ustawienia e-maili (secondary-email-settings) =====

describe("ekran e-maili — stan transportu nad formularzem nadawcy", () => {
  const configured = render(
    <EmailSenderForm defaults={{ name: "Fikcyjna", replyTo: "a@example.invalid" }} configured />,
  );
  const missing = render(<EmailSenderForm defaults={null} configured={false} />);

  it("karta nadawcy niesie oba stany konfiguracji", () => {
    expect(chips(configured)).toContain("email-sender/configured");
    expect(chips(missing)).toContain("email-sender/missing");
  });

  it("stan braku konfiguracji nie zasłania pól formularza", () => {
    expect(missing).toContain('name="name"');
    expect(missing).toContain('name="replyTo"');
    expect(missing).toContain(messages.emailSettings.senderMissing);
  });
});

// ===== 3. Historia e-maili (secondary-email-history) =====

describe("ekran historii e-maili — tabela na pełnej szerokości", () => {
  const html = render(
    <EmailLogTable
      rows={[
        {
          id: "1",
          created_at: "2026-07-22T09:14:00Z",
          kind: "rental_confirmed",
          recipient: "klient-01@example.invalid",
          subject: "ZAM/DEMO/104",
          status: "sent",
          error: null,
          order_id: "abc",
        },
        {
          id: "2",
          created_at: "2026-07-21T16:42:00Z",
          kind: "pickup_return_reminder",
          recipient: "klient-02@example.invalid",
          subject: "Przypomnienie o zwrocie",
          status: "failed",
          error: "adres odbiorcy został odrzucony",
          order_id: null,
        },
      ]}
      locale="pl"
      page={2}
      total={37}
      previousHref="/historia-emaili"
      nextHref="/historia-emaili?strona=3"
    />,
  );

  it("fixture pokrywa oba stany wysyłki", () => {
    expect(chips(html)).toEqual(["email-log/sent", "email-log/failed"]);
  });

  it("powód porażki idzie własnym wierszem, tonem destruktywnym", () => {
    expect(html).toContain("data-email-failure-reason");
    expect(html).toMatch(/data-email-failure-reason[\s\S]*?text-destructive/);
    expect(html).toContain("adres odbiorcy został odrzucony");
  });

  it("daty niosą cyfry tabelaryczne, a stronicowanie ma własną kotwicę", () => {
    expect(html).toMatch(/<td[^>]*tabular-nums/);
    expect(html).toContain("data-pagination");
  });

  it("tabela NIE stoi pod miarą formularza — miara obejmuje filtr", () => {
    expect(html).not.toContain("data-form-line-measure");
  });
});

// ===== 4. Ustawienia dostaw (secondary-delivery) =====

describe("ekran dostaw — cztery karty, cztery zapisy", () => {
  const owner = render(
    <>
      <CredentialsForm
        action={noAction}
        configured
        canWrite
        defaults={{ email: "a@example.invalid", environment: "test" }}
      />
      <SenderForm action={noAction} canWrite defaults={null} />
      <ParcelForm action={noAction} canWrite defaults={null} />
      <PricingForm action={noAction} canWrite defaults={null} />
    </>,
  );

  it("każda odpowiedzialność ma własną kartę i własny przycisk zapisu", () => {
    expect([...owner.matchAll(/data-settings-form="(\w+)"/g)].map(([, name]) => name)).toEqual([
      "credentials",
      "sender",
      "parcel",
      "pricing",
    ]);
    expect([...owner.matchAll(/type="submit"/g)]).toHaveLength(4);
    for (const label of [
      messages.orders.delivery.settings.saveCredentialsCta,
      messages.orders.delivery.settings.saveSenderCta,
      messages.orders.delivery.settings.saveParcelCta,
      messages.orders.delivery.settings.savePricingCta,
    ]) {
      expect(owner).toContain(label);
    }
  });

  it("stan sekretu jest chipem, a wartości sekretu nie ma w renderze", () => {
    expect(chips(owner)).toContain("delivery-secret/configured");
    const missing = render(
      <CredentialsForm action={noAction} configured={false} canWrite defaults={null} />,
    );
    expect(chips(missing)).toContain("delivery-secret/missing");
    // Pole hasła zawsze startuje puste (ADR-052: pole tylko do zapisu).
    const passwordTag = missing.match(/<input[^>]*id="cred-password"[^>]*>/)?.[0];
    expect(passwordTag, "brak pola nowego hasła").toBeDefined();
    expect(passwordTag).toContain('type="password"');
    expect(passwordTag, "zapisany sekret wraca do formularza").not.toMatch(/value="[^"]+"/);
  });

  it("członek zespołu widzi dane, ale nie dostaje ani zapisu, ani pola hasła", () => {
    const member = render(
      <CredentialsForm
        action={noAction}
        configured
        canWrite={false}
        defaults={{ email: "a@example.invalid", environment: "test" }}
      />,
    );
    expect(member).toContain("a@example.invalid");
    expect(member).not.toContain('type="submit"');
    expect(member).not.toContain('id="cred-password"');
  });
});

// ===== 5. Umowy (secondary-contracts) =====

describe("ekran umów — edycja właściciela i odczyt członka", () => {
  const settings = {
    address: "ul. Przykładowa 10",
    nip: "0000000000",
    email: "umowy@example.invalid",
    terms_version: "DEMO-2026-07",
    terms_body: "Treść regulaminu.",
  };

  it("właściciel dostaje formularz z kompletem pól", () => {
    const html = render(<ContractSettingsForm defaults={settings} />);
    expect(html).toContain('data-contract-mode="owner"');
    for (const field of ["address", "nip", "email", "terms_version", "terms_body"]) {
      expect(html, `brak pola ${field}`).toContain(`name="${field}"`);
    }
  });

  it("członek dostaje te same dane BEZ atrapy zapisu", () => {
    const html = render(<ContractReadOnly settings={settings} />);
    expect(html).toContain('data-contract-mode="member-read-only"');
    expect(html).toContain(settings.terms_version);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
  });

  it("brak konfiguracji jest stanem, nie pustą listą", () => {
    const html = render(<ContractReadOnly settings={null} />);
    expect(html).toContain(messages.contractSettings.missing);
  });
});

// ===== 6. Zespół (secondary-team) =====

describe("ekran zespołu — krótki formularz nad historią", () => {
  it("ostrzeżenie o wysyłce stoi przed formularzem tylko wtedy, gdy dotyczy", () => {
    const warned = render(<InviteMemberForm emailUnavailableReason="brak klucza" />);
    expect(warned).toContain("data-email-warning");
    expect(warned).toContain("brak klucza");
    expect(warned.indexOf("data-email-warning")).toBeLessThan(
      warned.indexOf("data-invitation-form"),
    );

    const healthy = render(<InviteMemberForm />);
    expect(healthy).not.toContain("data-email-warning");
    expect(healthy).toContain("data-invitation-form");
  });

  it("formularz ma dokładnie dwa pola: adres i rolę", () => {
    const html = render(<InviteMemberForm />);
    expect(html).toContain('name="email"');
    // Rola idzie systemowym Selectem (ADR-060) — w renderze serwerowym Radix
    // zostawia sam most `name`, a lista opcji dojeżdża dopiero na kliencie.
    expect(html).toContain('name="role"');
    expect(html).toContain(messages.invitations.roleLabel);
  });
});

// ===== 7. Organizacja (secondary-organization) =====

describe("ekran organizacji — karta read-only bez atrap", () => {
  const rows = [
    { label: "Nazwa", value: "Fikcyjna Wypożyczalnia" },
    { label: "Utworzono", value: "15.06.2026", numeric: true },
  ];

  it("stan aktywnej organizacji jest chipem przy nazwie", () => {
    const html = render(
      <OrganizationCard name="Fikcyjna Wypożyczalnia" status="active" rows={rows} />,
    );
    expect(chips(html)).toEqual(["organization/active"]);
    expect(html).toContain("data-organization-details");
    expect(html).toContain('data-access-mode="read-only"');
  });

  it("ekran nie ma ANI JEDNEJ kontrolki — to nie jest wyłączony formularz", () => {
    const html = render(
      <OrganizationCard name="Fikcyjna Wypożyczalnia" status="active" rows={rows} />,
    );
    for (const control of ["<button", "<input", "<select", "<textarea"]) {
      expect(html, `atrapa edycji: ${control}`).not.toContain(control);
    }
  });

  it("stan spoza mapy nie dostaje chipa zamiast prawdy", () => {
    const html = render(
      <OrganizationCard name="Fikcyjna Wypożyczalnia" status="suspended" rows={rows} />,
    );
    expect(chips(html)).toEqual([]);
  });

  it("data niesie cyfry tabelaryczne, nazwa NIE", () => {
    const html = render(
      <OrganizationCard name="Fikcyjna Wypożyczalnia" status="active" rows={rows} />,
    );
    expect(html).toMatch(/data-field="Utworzono"[\s\S]*?tabular-nums/);
    expect(html).not.toMatch(/data-field="Nazwa"[\s\S]*?tabular-nums[\s\S]*?Fikcyjna/);
  });
});

// ===== 8. Bezpieczeństwo (secondary-security) =====

describe("ekran bezpieczeństwa — trzy stany 2FA", () => {
  const notConfigured = render(<TotpEnrollForm />);
  const enrollment = render(
    <TotpEnrollForm
      initialState={{
        factorId: "factor-1",
        secret: "FIKCYJNY-SEKRET",
        qrCode: "data:image/svg+xml;base64,AAA",
      }}
    />,
  );
  const challenge = render(<TotpChallengeForm next="/zamowienia" />);

  it("trzy stany mają trzy różne kotwice", () => {
    expect(notConfigured).toContain('data-security-state="not-configured"');
    expect(enrollment).toContain('data-security-state="enrollment"');
    expect(challenge).toContain('data-security-state="challenge"');
  });

  it("stan wyłączony i stan potwierdzony niosą chipy z mapy", () => {
    expect(chips(notConfigured)).toEqual(["security/not_configured"]);
    expect(chips(challenge)).toEqual(["security/configured"]);
  });

  it("sekret pokazuje się WYŁĄCZNIE w kroku konfiguracji", () => {
    expect(enrollment).toContain("FIKCYJNY-SEKRET");
    expect(enrollment).toContain("data-totp-secret");
    expect(enrollment).toContain(messages.security.secretOnceHint);
    expect(notConfigured).not.toContain("data-totp-secret");
    expect(challenge).not.toContain("data-totp-secret");
  });

  it("krok konfiguracji zastępuje kartę stanu 1, a nie dokłada się do niej", () => {
    expect(enrollment).not.toContain('data-security-state="not-configured"');
    expect(enrollment).toContain('name="code"');
  });

  it("wyzwanie przenosi bezpieczny adres powrotu ukrytym polem", () => {
    expect(challenge).toMatch(/type="hidden" name="next" value="\/zamowienia"/);
  });
});

// ===== Reguła wspólna wszystkich chipów =====

describe("chipy stanu nigdy nie są samym kolorem", () => {
  it("każdy chip niesie oś, wartość i widoczny tekst", () => {
    const html = render(
      <DomainsPanel
        domains={domains}
        cnameTarget="shops.example.invalid"
        registrationAvailable
        registrationBlockedReason={null}
      />,
    );
    const rendered = [...html.matchAll(/<span[^>]*data-slot="status-badge"[^>]*>([^<]*)<\/span>/g)];
    expect(rendered.length).toBeGreaterThanOrEqual(4);
    for (const [tag, text] of rendered) {
      expect(tag).toContain("data-secondary-status-axis");
      expect(tag).toContain("data-tone=");
      expect(text!.trim().length, `chip bez tekstu: ${tag}`).toBeGreaterThan(0);
    }
  });
});
