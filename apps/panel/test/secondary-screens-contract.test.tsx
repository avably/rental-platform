import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
  // Ramka podglądu (kreator A3) buduje adres trasy podglądu przez getPathname.
  getPathname: ({ href }: { href: { pathname: string } | string }) =>
    typeof href === "string" ? href : href.pathname,
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
const { SiteEditor } = await import("@/app/[locale]/(panel)/strona/site-editor");
const { SiteLoadError } = await import("@/app/[locale]/(panel)/strona/site-load-error");
const { SitePreview } = await import("@/app/[locale]/(panel)/strona/site-preview");
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

// ===== 9. Strona sklepu (secondary-site-editor) =====

/**
 * Kontrakt DWUKIERUNKOWY, tak jak miara formularza: kotwice stanów czytamy z
 * ARTEFAKTU i dopiero potem sprawdzamy w renderze. Lista `toContain` na samym
 * renderze broniłaby tylko kodu — mockup mógłby zgubić stan i nikt by się nie
 * dowiedział, że kod pilnuje rzeczy, której projekt już nie zawiera.
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

type SiteEditorProps = Parameters<typeof SiteEditor>[0];

const siteSections: SiteEditorProps["sections"] = [
  { id: "s1", type: "hero", position: 0, enabled: true, content: { heading: "Sprzęt na już" } },
  { id: "s2", type: "products", position: 1, enabled: true, content: { heading: "Popularny sprzęt" } },
  { id: "s3", type: "pricing", position: 2, enabled: false, content: { heading: "Warunki cenowe" } },
  { id: "s4", type: "faq", position: 3, enabled: true, content: { heading: "Pytania", items: [{ q: "Jak rezerwować?", a: "Fikcyjna odpowiedź." }] } },
  { id: "s5", type: "contact", position: 4, enabled: true, content: { heading: "Kontakt" } },
  { id: "s6", type: "freeform", position: 5, enabled: false, content: { heading: "O nas", body: "Fikcyjna treść własna." } },
  // Sekcja USP (0043) — jej pole ikony to PanelSelect, czyli JEDYNY select
  // widocznej kontrolki w edytorze po zamianie „Dodaj sekcję" na galerię-modal.
  { id: "s7", type: "usp", position: 6, enabled: true, content: { heading: "Atuty", items: [{ icon: "truck", title: "Szybko", text: "Od ręki." }] } },
];

const siteProducts: Parameters<typeof SitePreview>[0]["products"] = [
  {
    id: "p1",
    name: "Produkt demonstracyjny A",
    description: null,
    priceLabel: "od 120,00 zł / doba",
    imageUrl: null,
    imageAlt: "Produkt demonstracyjny A",
  },
];

function renderSiteEditor(overrides: Partial<SiteEditorProps> = {}): string {
  return render(
    <SiteEditor
      siteId="site-1"
      template="classic"
      sections={siteSections}
      publishedAtLabel="22.07.2026, 10:30"
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

describe("ekran strony sklepu — edytor obok podglądu szkicu", () => {
  const html = renderSiteEditor();

  it("układ ma dwie kolumny: kontrolki pod miarą i podgląd szkicu", () => {
    expect(html).toContain("data-site-editor-layout");
    expect(html).toMatch(/data-form-line-measure[^>]*data-site-editor-controls/);
    // Podgląd jest RAMKĄ z osobnym dokumentem (kreator A3) — własny viewport,
    // więc przełącznik szerokości pokazuje prawdziwy układ mobilny, a nie
    // desktopowy ściśnięty do kolumny.
    expect(html).toContain('data-site-preview="frame"');
    expect(html).toContain("data-preview-frame");
    // Podgląd stoi POZA miarą — to widok sklepu, nie wiersz do czytania.
    expect(html.indexOf("data-site-preview")).toBeGreaterThan(
      html.indexOf("data-site-editor-controls"),
    );
  });

  it("publikacja jest osobna od zapisu: własna karta, własny stan, własny przycisk", () => {
    expect(html).toContain("data-publish-status");
    expect(chips(html)).toContain("site-publish/published");
    expect(html).toContain(messages.site.publish.publish);
    // Zapis szablonu i zapis KAŻDEJ sekcji to osobne akcje, nie „Publikuj".
    expect(html).toContain(messages.site.template.save);
    expect([...html.matchAll(/data-section-actions/g)]).toHaveLength(siteSections.length);
  });

  it("strona nigdy nieopublikowana nie dostaje chipa udającego stan spoza mapy", () => {
    const never = renderSiteEditor({ publishedAtLabel: null });
    expect(chips(never)).not.toContain("site-publish/published");
    expect(never).toContain(messages.site.publish.notPublished);
    expect(never).toContain("data-publish-status");
  });

  it("każda sekcja jest wierszem z typem, numerem i chipem stanu", () => {
    expect(html).toContain("data-site-sections");
    expect([...html.matchAll(/data-section-type="/g)]).toHaveLength(siteSections.length);
    expect([...html.matchAll(/data-section-order="/g)]).toHaveLength(siteSections.length);
    // Fixture pokrywa OBA stany osi — bez tego asercje niżej oglądałyby jeden.
    expect(chips(html)).toEqual(
      expect.arrayContaining(["site-section/enabled", "site-section/disabled"]),
    );
  });

  it("komplet możliwości edytora zostaje: kolejność, włączenie, usunięcie, FAQ", () => {
    for (const label of [
      messages.site.sections.moveUp,
      messages.site.sections.moveDown,
      messages.site.sections.disable,
      messages.site.sections.enable,
      messages.site.sections.remove,
      messages.site.sections.add,
      messages.site.sections.addBelow,
      messages.site.fields.saveSection,
      messages.site.fields.faqAdd,
    ]) {
      expect(html, `zgubiona możliwość: ${label}`).toContain(label);
    }
    expect(html).toContain("data-faq-row");
    // Komplet typów do dodania siedzi w galerii-modalu „Dodaj sekcję" (zamknięty
    // w SSR) — pełną listę 12 kafli pilnuje add-section-gallery.test.tsx.
  });

  it("selekty idą przez PanelSelect — zero natywnych kontrolek", () => {
    // Po zamianie „Dodaj sekcję" na galerię-modal jedynym selectem widocznej
    // kontrolki jest picker ikony USP — nadal PanelSelect, nie natywny.
    expect(html).toContain('data-slot="select-trigger"');
    // Jedyny `<select>` w renderze to most Radix (aria-hidden, dla autofillu) —
    // widoczna kontrolka nie ma prawa nim być (ADR-060).
    for (const [tag] of html.matchAll(/<select[^>]*>/g)) {
      expect(tag, `natywny select w edytorze: ${tag}`).toContain('aria-hidden="true"');
    }
    // Druga strona: w ŹRÓDLE ekranu natywnego selecta nie ma w ogóle.
    for (const file of [
      "site-editor.tsx",
      "section-content-form.tsx",
      "site-preview.tsx",
      "site-preview-frame.tsx",
    ]) {
      const source = readFileSync(
        resolve(process.cwd(), "app/[locale]/(panel)/strona", file),
        "utf8",
      );
      expect(source, `natywny <select> w ${file}`).not.toMatch(/<select\b/);
    }
  });

  it("brak sekcji jest STANEM, a nie zniknięciem edytora", () => {
    const empty = renderSiteEditor({ sections: [] });
    expect(empty).toContain("data-site-sections-empty");
    expect(empty).not.toContain("data-site-sections=");
    expect(empty).toContain(messages.site.sections.empty);
    // Selektor „Dodaj sekcję" pozostaje pierwszą dostępną akcją (mockup).
    expect(empty).toContain("data-add-section-form");
  });
});

describe("podgląd szkicu nie pokazuje treści, której klient nie zobaczy", () => {
  // Podgląd jest ciałem osobnej trasy (`/podglad-strony`) osadzonej w ramce
  // edytora, więc renderujemy go wprost — reguła została ta sama, zmieniło się
  // tylko, po której stronie ramki mieszka.
  function renderPreview(sections: SiteEditorProps["sections"]): string {
    return render(<SitePreview sections={sections} template="classic" products={siteProducts} />);
  }

  it("wszystkie sekcje wyłączone → pusty podgląd BEZ fikcyjnej zawartości", () => {
    const preview = renderPreview(siteSections.map((section) => ({ ...section, enabled: false })));

    expect(preview).toContain('data-site-preview="draft"');
    expect(preview).toContain("data-preview-empty-state");
    expect(preview).toContain(messages.site.preview.empty);
    // Treść wyłączonych sekcji i kafle katalogu nie mają prawa tu być: podgląd
    // kłamałby o jedynej rzeczy, dla której istnieje.
    expect(preview, "podgląd pokazuje treść wyłączonej sekcji").not.toContain("Sprzęt na już");
    expect(preview, "podgląd pokazuje kafle produktów").not.toContain("Produkt demonstracyjny A");
  });

  it("włączone sekcje wracają do podglądu razem z realnym katalogiem", () => {
    const preview = renderPreview(siteSections);

    expect(preview).not.toContain("data-preview-empty-state");
    expect(preview).toContain("Sprzęt na już");
    expect(preview).toContain("Produkt demonstracyjny A");
    // Sekcja wyłączona zostaje w edytorze, ale nie w podglądzie.
    expect(preview).not.toContain("Warunki cenowe");
  });

  it("każda sekcja podglądu ma kotwicę, po której podgląd da się przewinąć", () => {
    // Kotwice (`data-section-id`) niesie renderer wspólny ze storefrontem —
    // bez nich skok do właśnie zapisanej sekcji nie ma czego szukać.
    const preview = renderPreview(siteSections);
    const enabled = siteSections.filter((section) => section.enabled);
    for (const section of enabled) {
      expect(preview, `brak kotwicy sekcji ${section.id}`).toContain(
        `data-section-id="${section.id}"`,
      );
    }
    expect([...preview.matchAll(/data-section-id="/g)]).toHaveLength(enabled.length);
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
        configBlockedReason={null}
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
        configBlockedReason={null}
      />,
    );

    expect(html).toContain("data-payment-requirements");
    expect(html).toContain('data-requirement="external_account"');
  });

  it("bez konfiguracji przycisk onboardingu jest wyłączony Z POWODEM", () => {
    const html = render(
      <PaymentsPanel
        account={null}
        stage="missing"
        isOwner
        configAvailable={false}
        configBlockedReason="brak AVABLY_STRIPE_SECRET_KEY"
      />,
    );

    expect(chips(html)).toContain("payment-account/missing");
    expect(html).toContain('data-payment-blocked="config"');
    expect(html).toContain("brak AVABLY_STRIPE_SECRET_KEY");
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
        configBlockedReason={null}
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
        configBlockedReason={null}
      />,
    );

    expect(chips(html)).toContain("payment-account/ready");
    expect(html).not.toContain("data-payment-onboarding");
  });
});
