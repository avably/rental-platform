import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SITE_STYLE } from "@avably/core/site";

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
  // Kreator odświeża RSC po udanej mutacji (K1) — poza <AppRouterContext>
  // useRouter rzuca, a render kontraktu routera nie potrzebuje.
  useRouter: () => ({ refresh: () => {} }),
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
vi.mock("@/app/[locale]/(panel)/ustawienia-platnosci/payments-actions", () => ({
  startPaymentOnboardingAction: noopAction,
  refreshPaymentAccountAction: noopAction,
  disconnectPaymentAccountAction: noopAction,
}));
vi.mock("@/app/[locale]/(panel)/bezpieczenstwo/actions", () => ({
  enrollTotpAction: noopAction,
  verifyTotpAction: noopAction,
}));
vi.mock("@/app/[locale]/(panel)/bezpieczenstwo/wyzwanie/actions", () => ({
  challengeTotpAction: noopAction,
}));
vi.mock("@/lib/actions/site", () => ({
  duplicateSection: noopAction,
  deleteSection: noopAction,
  publishSite: noopAction,
  reorderSections: noopAction,
  toggleSection: noopAction,
  updateTemplate: noopAction,
  upsertSection: noopAction,
}));
// Edytor strony odświeża RSC po udanej akcji — poza `<AppRouterContext>`
// `useRouter` rzuca, a render kontraktu routera nie potrzebuje.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRouter: () => ({ refresh: () => {} }),
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
const { SitePages } = await import("@/app/[locale]/(panel)/strona/site-pages");
const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { SiteLoadError } = await import("@/app/[locale]/(panel)/strona/site-load-error");
const { PaymentsPanel } = await import(
  "@/app/[locale]/(panel)/ustawienia-platnosci/payments-panel"
);

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

/** Styl szkicu w motywie zastanym — dokładnie to, czym strona jest bez wyboru. */
const STYL = DEFAULT_SITE_STYLE;

describe("ekran domen — sekwencja stanów rejestracji i DNS", () => {
  const html = render(
    <DomainsPanel
      domains={domains}
      cnameTarget="shops.example.invalid"
      registrationAvailable
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
      />,
    );
    expect(chips(blocked)).toContain("domain-provider/unavailable");
    // U1 (audyt W3): zamiast surowego powodu (nazwy zmiennych) — neutralne
    // zdanie ze słownika, bez zadania dla najemcy.
    expect(blocked).toContain(messages.domainSettings.registrationUnavailable);
    expect(blocked).toContain(messages.domainSettings.retryUnavailable);
    expect(blocked).toContain("data-domain-add-form");
  });

  it("awaria platformy nie jest porażką subdomeny najemcy (U1, audyt 6.6)", () => {
    const blocked = render(
      <DomainsPanel
        domains={domains}
        cnameTarget="shops.example.invalid"
        registrationAvailable={false}
      />,
    );
    // Subdomena w stanie faktycznym registration_failed pokazuje się jako
    // „czekamy na konfigurację platformy" — chip problemu znika z ekranu…
    expect(chips(blocked)).toContain("domain/awaiting_platform");
    expect(chips(blocked)).not.toContain("domain/registration_failed");
    expect(blocked).toContain(messages.domainSettings.platformPending);
    // …a razem z nim surowy last_error, bo nie ma w nim zadania najemcy.
    expect(blocked).not.toContain("nie udało się zarejestrować hosta");
  });

  it("zapis awarii konfiguracji platformy w last_error nie schodzi na ekran", () => {
    // Rejestracja już DZIAŁA (platforma naprawiona), ale wiersz subdomeny
    // trzyma jeszcze zapis z czasu awarii — w brzmieniu technicznym.
    const stale = render(
      <DomainsPanel
        domains={[
          {
            ...domains[0]!,
            lastError: "Rejestracja domen jest niedostępna: brak AVABLY_VERCEL_API_TOKEN",
          },
        ]}
        cnameTarget="shops.example.invalid"
        registrationAvailable
      />,
    );
    expect(chips(stale)).toContain("domain/awaiting_platform");
    expect(stale).not.toContain("AVABLY_VERCEL_API_TOKEN");
    expect(stale).toContain(messages.domainSettings.platformPending);
    // Ponowienie jest dostępne — przycisk zostaje aktywny.
    expect(stale).not.toContain(messages.domainSettings.retryUnavailable);
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
    const warned = render(<InviteMemberForm emailUnavailable />);
    expect(warned).toContain("data-email-warning");
    // U1 (audyt W3): treść w całości ze słownika — bez powodu z serwera.
    expect(warned).toContain(messages.invitations.emailUnavailable);
    expect(warned).toContain(messages.invitations.emailUnavailableConsequence);
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

// ===== 9. Strona sklepu: launcher + kreator (secondary-site-editor) =====

/**
 * Kontrakt DWUKIERUNKOWY, tak jak miara formularza: kotwice stanów czytamy z
 * ARTEFAKTU i dopiero potem sprawdzamy w renderze. Lista `toContain` na samym
 * renderze broniłaby tylko kodu — mockup mógłby zgubić stan i nikt by się nie
 * dowiedział, że kod pilnuje rzeczy, której projekt już nie zawiera.
 *
 * K1 (ADR-083) ROZDZIELIŁ ten ekran na dwa: zakładka „Strona sklepu" jest dziś
 * LAUNCHEREM (status publikacji, wejście do kreatora, publikacja), a cała
 * edycja przeniosła się na pełnoekranową trasę `/strona/kreator`. Kotwice
 * z mockupu NIE ZNIKAJĄ — zmieniają adres, i właśnie tego pilnują asercje
 * niżej: każda strona dostaje tę część kontraktu, którą naprawdę realizuje.
 */
const artifact = readFileSync(
  resolve(process.cwd(), "../..", "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);
const siteMockup =
  artifact.match(/<article[^>]*data-screen="secondary-site-editor"[\s\S]*?<\/article>/)?.[0] ?? "";

const SITE_MOCKUP_ANCHORS = [
  "data-publish-status",
  "data-site-load-error-state",
  "data-site-editor-controls",
  "data-form-line-measure",
  "data-template-form",
  "data-add-section-form",
  "data-site-sections",
  "data-site-sections-empty",
  "data-section-type",
  "data-section-order",
  "data-faq-row",
  "data-site-preview",
  "data-preview-empty-state",
] as const;

type BuilderProps = Parameters<typeof SiteBuilder>[0];

const siteSections: BuilderProps["sections"] = [
  { id: "s1", type: "hero", position: 0, enabled: true, deletedInDraft: false, published: true, content: { heading: "Sprzęt na już" } },
  { id: "s2", type: "products", position: 1, enabled: true, deletedInDraft: false, published: true, content: { heading: "Popularny sprzęt" } },
  { id: "s3", type: "pricing", position: 2, enabled: false, deletedInDraft: false, published: true, content: { heading: "Warunki cenowe" } },
  { id: "s4", type: "faq", position: 3, enabled: true, deletedInDraft: false, published: true, content: { heading: "Pytania", items: [{ q: "Jak rezerwować?", a: "Fikcyjna odpowiedź." }] } },
  { id: "s5", type: "contact", position: 4, enabled: true, deletedInDraft: false, published: true, content: { heading: "Kontakt" } },
  { id: "s6", type: "freeform", position: 5, enabled: false, deletedInDraft: false, published: true, content: { heading: "O nas", body: "Fikcyjna treść własna." } },
  // Sekcja USP (0043) — jej pole ikony to PanelSelect, czyli JEDYNY select
  // widocznej kontrolki w formularzu treści (dziś: w szufladzie kreatora).
  { id: "s7", type: "usp", position: 6, enabled: true, deletedInDraft: false, published: true, content: { heading: "Atuty", items: [{ icon: "truck", title: "Szybko", text: "Od ręki." }] } },
];

const siteProducts: BuilderProps["products"] = [
  {
    id: "p1",
    name: "Produkt demonstracyjny A",
    description: null,
    priceLabel: "od 120,00 zł / doba",
    imageUrl: null,
    imageAlt: "Produkt demonstracyjny A",
  },
];

function renderLauncher(publishedAtLabel: string | null = "22.07.2026, 10:30"): string {
  // Po 0048 (ADR-093) ekran „Strona sklepu" jest LISTĄ wersji, a nie launcherem
  // jednej strony. Kontrakt spójności ekranów dostaje ten sam przypadek co
  // przedtem — jedną stronę widoczną w sklepie — tylko w nowym kształcie.
  return render(
    <SitePages
      rows={[
        {
          id: "site-1",
          name: "Strona sklepu",
          live: publishedAtLabel !== null,
          publishedAtLabel,
          createdAtLabel: "22.07.2026, 10:00",
        },
      ]}
    />,
  );
}

function renderBuilder(overrides: Partial<BuilderProps> = {}): string {
  return render(
    <SiteBuilder
      siteId="site-1"
      siteName="Strona sklepu"
      style={STYL}
      sections={siteSections}
      products={siteProducts}
      money={{ currency: "PLN", locale: "pl" }}
      {...overrides}
    />,
  );
}

describe("ekran strony sklepu — mockup niesie komplet kotwic stanów", () => {
  it("sekcja artefaktu jest na miejscu i nazywa każdy stan ekranu", () => {
    // Kontrola po pustym zbiorze: bez niej pętla niżej przelatywałaby po
    // pustym stringu i świeciła na zielono z niczego.
    expect(siteMockup.length, "brak sekcji secondary-site-editor w artefakcie").toBeGreaterThan(
      2000,
    );
    for (const anchor of SITE_MOCKUP_ANCHORS) {
      expect(siteMockup, `mockup zgubił kotwicę ${anchor}`).toContain(anchor);
    }
  });
});

describe("launcher: publikacja i wejście do kreatora — ZERO formularzy edycji", () => {
  const html = renderLauncher();

  it("publikacja jest osobna od zapisu: własna karta, własny stan, własny przycisk", () => {
    expect(html).toContain("data-publish-status");
    expect(chips(html)).toContain("site-publish/published");
    expect(html).toContain(messages.site.publish.publish);
  });

  it("strona nigdy nieopublikowana nie dostaje chipa udającego stan spoza mapy", () => {
    const never = renderLauncher(null);
    expect(chips(never)).not.toContain("site-publish/published");
    // KOTWICA PRZENIESIONA (0048, ADR-093): zdanie o wersji roboczej mówi
    // o stanie BIEŻĄCYM, bo po zdjęciu strony ze sklepu `published_at` jest
    // NULL i „nie była jeszcze publikowana" bywałoby nieprawdą. Asercja
    // pilnuje tego samego, czego pilnowała: że stan bez chipa dostaje ZDANIE.
    expect(never).toContain(messages.site.pages.notLive);
    expect(never).toContain("data-publish-status");
  });

  it("prowadzi do kreatora jednym, wyraźnym wejściem", () => {
    expect(html).toContain("data-open-builder");
    expect(html).toContain(messages.site.builder.open);
    // KOTWICA PRZENIESIONA (0048, ADR-093): wejście do kreatora niesie
    // identyfikator WERSJI, bo bez niego kreator nie ma czym wybrać strony.
    expect(html).toContain('href="/strona/site-1/kreator"');
  });

  it("nie ma tu ANI JEDNEGO formularza edycji strony", () => {
    // Sedno zmiany K1: dwa miejsca edycji tego samego szkicu znaczyłyby, że
    // jedno z nich zawsze jest o krok w tyle. Launcher przestaje edytować.
    expect(html, "launcher renderuje formularz").not.toContain("<form");
    for (const anchor of [
      "data-site-editor-layout",
      "data-site-editor-controls",
      "data-template-form",
      "data-add-section-form",
      "data-site-sections",
      "data-section-actions",
      "data-site-preview",
    ]) {
      expect(html, `pozostałość edytora na launcherze: ${anchor}`).not.toContain(anchor);
    }
    // Kontrola po pustym zbiorze: launcher NA PEWNO coś renderuje.
    expect(html.length).toBeGreaterThan(300);
  });
});

describe("kreator przejmuje kotwice edycji z mockupu", () => {
  const html = renderBuilder();

  it("skorupa jest pełnoekranowa: pasek, paleta, płótno", () => {
    for (const anchor of [
      "data-site-builder",
      "data-builder-topbar",
      'data-builder-palette="expanded"',
      "data-builder-canvas",
      "data-builder-stage",
    ]) {
      expect(html, `kreator zgubił kotwicę ${anchor}`).toContain(anchor);
    }
  });

  it("każda sekcja szkicu jest kafelkiem płótna z typem i numerem", () => {
    expect([...html.matchAll(/data-canvas-section="/g)]).toHaveLength(siteSections.length);
    expect([...html.matchAll(/data-section-type="/g)]).toHaveLength(siteSections.length);
    expect([...html.matchAll(/data-section-order="/g)]).toHaveLength(siteSections.length);
  });

  it("płótno pokazuje RÓWNIEŻ sekcje wyłączone — oznaczone chipem osi", () => {
    // Płótno jest edytorem, a nie podglądem: sekcja wyłączona musi dać się
    // znaleźć i włączyć. Gwarancję „klient tego nie zobaczy" niesie
    // app.get_published_site (0019, dowód w packages/db/test/site-model),
    // a nie filtr w interfejsie.
    const disabled = siteSections.filter((section) => !section.enabled);
    expect(disabled.length, "fixture bez sekcji wyłączonej niczego nie dowodzi").toBeGreaterThan(0);
    expect([...html.matchAll(/data-section-hidden="/g)]).toHaveLength(disabled.length);
    expect(chips(html)).toContain("site-section/disabled");
    // Treść wyłączonej sekcji ZOSTAJE na płótnie — to jej jedyne miejsce edycji.
    expect(html).toContain("Warunki cenowe");
  });

  it("między sekcjami i pod ostatnią stoi miejsce na „+ Dodaj sekcję”", () => {
    // Jedno „+" przed każdą sekcją i jedno na końcu strony.
    expect([...html.matchAll(/data-insert-at="/g)]).toHaveLength(siteSections.length + 1);
    expect(html).toContain(`data-insert-at="${siteSections.length}"`);
  });

  it("pasek niesie powrót, viewport, szkielet historii, stan zapisu i publikację", () => {
    expect(html).toContain("data-builder-back");
    expect(html).toContain("data-builder-viewport-switch");
    expect([...html.matchAll(/data-builder-history-button/g)]).toHaveLength(2);
    expect(html).toContain("data-builder-save-state");
    expect(html).toContain("data-builder-publish");
    expect(html).toContain(messages.site.publish.publish);
  });

  it("puste płótno jest STANEM, a nie zniknięciem kreatora", () => {
    const empty = renderBuilder({ sections: [] });
    expect(empty).toContain("data-builder-canvas-empty");
    expect(empty).toContain(messages.site.builder.emptyTitle);
    expect(empty).not.toContain("data-canvas-section=");
    // Paleta zostaje: pusta strona to nie powód, żeby chować narzędzia.
    expect(empty).toContain('data-builder-palette="expanded"');
  });

  it("selekty idą przez PanelSelect — zero natywnych kontrolek", () => {
    // Jedyny `<select>` w renderze to most Radiksa (aria-hidden, dla
    // autofillu) — widoczna kontrolka nie ma prawa nim być (ADR-060).
    for (const [tag] of html.matchAll(/<select[^>]*>/g)) {
      expect(tag, `natywny select w kreatorze: ${tag}`).toContain('aria-hidden="true"');
    }
    // Druga strona: w ŹRÓDŁACH obu ekranów natywnego selecta nie ma w ogóle.
    const files = [
      "app/[locale]/(panel)/strona/site-pages.tsx",
      "app/[locale]/(panel)/strona/section-content-form.tsx",
      "app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder.tsx",
      "app/[locale]/(kreator)/strona/[siteId]/kreator/builder-canvas.tsx",
      "app/[locale]/(kreator)/strona/[siteId]/kreator/builder-palette.tsx",
      "app/[locale]/(kreator)/strona/[siteId]/kreator/section-settings-drawer.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source.length, `pusty plik ${file}`).toBeGreaterThan(200);
      expect(source, `natywny <select> w ${file}`).not.toMatch(/<select\b/);
    }
  });
});

describe("błąd ładowania szkicu nie udaje pustego edytora", () => {
  const html = render(
    <SiteLoadError
      backLabel="← Panel"
      title={messages.site.loadErrorTitle}
      message={messages.site.loadError}
    />,
  );

  it("stan błędu ma własną kotwicę i mówi, co się stało", () => {
    expect(html).toContain("data-site-load-error-state");
    expect(html).toContain(messages.site.loadError);
    expect(html).toContain('role="alert"');
  });

  it("ekran błędu NIE renderuje edytora ani podglądu", () => {
    for (const anchor of ["data-site-editor-layout", "data-site-sections", "data-site-preview"]) {
      expect(html, `atrapa edytora w stanie błędu: ${anchor}`).not.toContain(anchor);
    }
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

// ===== 9. Płatności (oś payment-account, Z2/ADR-065) =====

const restrictedAccount = {
  providerAccountId: "acct_demo_fikcyjne",
  chargesEnabled: true,
  payoutsEnabled: false,
  detailsSubmitted: true,
  requirementsDue: ["external_account"],
  lastError: null,
  lastSyncedAt: "2026-07-22T09:14:00Z",
};

describe("ekran płatności — dwie osi gotowości nie zwijają się w jedną", () => {
  it("konto restricted ma własny stan, nie „gotowe” i nie „w toku”", () => {
    const html = render(
      <PaymentsPanel
        account={restrictedAccount}
        stage="payouts_blocked"
        isOwner
        configAvailable
      />,
    );

    expect(chips(html)).toContain("payment-account/payouts_blocked");
    // Obie zdolności widoczne OSOBNO i z własną wartością — to jest jedyny
    // sposób, w jaki najemca dowie się, że pieniądze utknęły.
    expect(html).toContain('data-payment-capability="charges" data-enabled="true"');
    expect(html).toContain('data-payment-capability="payouts" data-enabled="false"');
  });

  it("brakujące wymagania dostawcy są wypisane, nie streszczone", () => {
    const html = render(
      <PaymentsPanel
        account={restrictedAccount}
        stage="payouts_blocked"
        isOwner
        configAvailable
      />,
    );

    expect(html).toContain("data-payment-requirements");
    expect(html).toContain('data-requirement="external_account"');
  });

  it("bez konfiguracji przycisk onboardingu jest wyłączony Z POWODEM", () => {
    const html = render(
      <PaymentsPanel account={null} stage="missing" isOwner configAvailable={false} />,
    );

    expect(chips(html)).toContain("payment-account/missing");
    expect(html).toContain('data-payment-blocked="config"');
    // U1 (audyt W3): powód jest neutralny i ze słownika — bez nazw zmiennych.
    expect(html).toContain(messages.paymentSettings.unavailable);
    expect(html).not.toContain("AVABLY_STRIPE_SECRET_KEY");
    // Cicho nieklikalna kontrolka jest gorsza od jej braku.
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("pracownik widzi powód, dla którego nie może podpiąć konta", () => {
    const html = render(
      <PaymentsPanel
        account={null}
        stage="missing"
        isOwner={false}
        configAvailable
      />,
    );

    expect(html).toContain('data-payment-blocked="role"');
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("konto gotowe nie pokazuje już zaproszenia do weryfikacji", () => {
    const html = render(
      <PaymentsPanel
        account={{ ...restrictedAccount, payoutsEnabled: true, requirementsDue: [] }}
        stage="ready"
        isOwner
        configAvailable
      />,
    );

    expect(chips(html)).toContain("payment-account/ready");
    expect(html).not.toContain("data-payment-onboarding");
  });
});
