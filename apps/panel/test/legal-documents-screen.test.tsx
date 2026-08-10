/**
 * EKRAN DOKUMENTÓW PRAWNYCH — render trasy (B4, ADR-129).
 *
 * Para do `legal-documents-actions`: tamten broni tego, co akcja robi z bazą,
 * ten — tego, co ekran POKAZUJE. Trzy rzeczy, których nie widać w typach:
 *
 *   1. OSTRZEŻENIE „sklep sprzedaje bez opublikowanego regulaminu" pojawia
 *      się dokładnie wtedy, gdy dokument `terms` nie ma żywej wersji —
 *      i znika po publikacji. Sam SZKIC go nie gasi, bo publiczny odczyt
 *      czyta wyłącznie rejestr wersji;
 *   2. FORK RÓL JEST SERWEROWY: personel dostaje listę odczytową, a nie
 *      wyłączony formularz — w renderze nie ma ANI JEDNEJ kontrolki zapisu;
 *   3. ostrzeżenie NICZEGO NIE BLOKUJE: formularze i tak są na ekranie.
 *
 * Wołamy komponent trasy tak, jak woła go Next (`await Page()`), więc bramka
 * mierzy prawdziwe złożenie strony, a nie atrapę zbudowaną w teście.
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

const session = vi.hoisted(() => ({
  role: "owner" as "owner" | "staff",
  documents: [] as Record<string, unknown>[],
  versions: [] as Record<string, unknown>[],
}));

function translation(path: string) {
  const values = path
    .split(".")
    .reduce<unknown>((current, key) => (current as Record<string, unknown>)[key], messages);
  return (key: string, params?: Record<string, unknown>) => {
    const raw = key
      .split(".")
      .reduce<unknown>((current, part) => (current as Record<string, unknown>)[part], values);
    return String(raw).replace(/\{(\w+)\}/g, (_match, name) => String(params?.[name] ?? ""));
  };
}

vi.mock("next-intl/server", () => ({
  getTranslations: async (path: string) => translation(path),
  getFormatter: async () => ({
    dateTime: (value: Date) => value.toISOString().slice(0, 10),
  }),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/dokumenty-prawne",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const noopAction = async () => ({});
vi.mock("@/app/[locale]/(panel)/dokumenty-prawne/actions", () => ({
  saveLegalDocumentDraftAction: noopAction,
  publishLegalDocumentAction: noopAction,
}));

function table(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) chain[method] = () => chain;
  chain.then = <R,>(resolve: (value: { data: unknown; error: null }) => R) =>
    Promise.resolve({ data: rows, error: null }).then(resolve);
  return chain;
}

vi.mock("@/lib/member-page", () => ({
  requireMemberPage: async () => ({
    tenantId: "tenant-1",
    role: session.role,
    supabase: {
      from: (name: string) =>
        name === "legal_documents" ? table(session.documents) : table(session.versions),
    },
  }),
}));

const { default: LegalDocumentsPage } = await import(
  "@/app/[locale]/(panel)/dokumenty-prawne/page"
);

async function renderScreen(): Promise<string> {
  const screen = await LegalDocumentsPage();
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {screen}
    </NextIntlClientProvider>,
  );
}

const draftTerms = {
  id: "doc-terms",
  kind: "terms",
  title: "Regulamin",
  body_draft: "Fikcyjna treść regulaminu.",
  locale: "pl",
  current_version_id: null,
};

const publishedVersion = {
  id: "ver-1",
  kind: "terms",
  version_no: 1,
  version_label: "v1",
  sha256: "abc123def4567890".padEnd(64, "0"),
  published_at: "2026-08-08T10:30:00Z",
};

beforeEach(() => {
  session.role = "owner";
  session.documents = [];
  session.versions = [];
});

describe("ostrzeżenie: sklep sprzedaje bez opublikowanego regulaminu", () => {
  it("stoi na ekranie, gdy regulaminu nie ma w ogóle", async () => {
    const html = await renderScreen();

    expect(html).toContain("data-legal-terms-warning");
    expect(html).toContain(messages.legalDocuments.warningTitle);
    // Ostrzeżenie mówi o SKUTKU, nie o brakującym polu.
    expect(html).toContain(messages.legalDocuments.warningBody);
  });

  it("SAM SZKIC go nie gasi — klient widzi wyłącznie opublikowaną wersję", async () => {
    session.documents = [draftTerms];
    const html = await renderScreen();

    expect(html).toContain("data-legal-terms-warning");
    // Kontrola po pustym zbiorze: szkic NAPRAWDĘ jest na ekranie.
    expect(html).toContain("Fikcyjna treść regulaminu.");
  });

  it("znika po publikacji — i wtedy stan mówi, którą wersję widzi klient", async () => {
    session.documents = [{ ...draftTerms, current_version_id: "ver-1" }];
    session.versions = [publishedVersion];
    const html = await renderScreen();

    expect(html, "ostrzeżenie zostało po publikacji").not.toContain("data-legal-terms-warning");
    expect(html).toContain("v1");
    expect(html).toContain('data-legal-version="v1"');
    // Skrót treści z rejestru — 12 znaków, nie cały hash.
    expect(html).toContain("abc123def456");
    expect(html).not.toContain(publishedVersion.sha256);
  });

  it("opublikowana POLITYKA PRYWATNOŚCI nie gasi ostrzeżenia o regulaminie", async () => {
    // Dwie osobne sprawy: brak regulaminu jest problemem checkoutu niezależnie
    // od tego, ile innych dokumentów najemca opublikował.
    session.documents = [
      {
        id: "doc-privacy",
        kind: "privacy",
        title: "Polityka prywatności",
        body_draft: "Fikcyjna polityka.",
        locale: "pl",
        current_version_id: "ver-p1",
      },
    ];
    session.versions = [
      { ...publishedVersion, id: "ver-p1", kind: "privacy", version_label: "v1" },
    ];
    const html = await renderScreen();

    expect(html).toContain("data-legal-terms-warning");
  });

  it("NICZEGO nie blokuje — formularze zostają na ekranie", async () => {
    const html = await renderScreen();

    expect(html).toContain('data-legal-document="terms"');
    expect(html).toContain('data-legal-document="privacy"');
    expect(html).toContain("<form");
  });
});

describe("fork ról jest serwerowy", () => {
  it("właściciel dostaje formularz obu dokumentów", async () => {
    session.documents = [draftTerms];
    const html = await renderScreen();

    expect([...html.matchAll(/data-legal-mode="owner"/g)]).toHaveLength(2);
    expect(html).not.toContain('data-legal-mode="read-only"');
    expect(html).toContain('name="body_draft"');
  });

  it("personel dostaje widok ODCZYTOWY — bez formularza i bez przycisków", async () => {
    session.role = "staff";
    session.documents = [draftTerms];
    const html = await renderScreen();

    expect([...html.matchAll(/data-legal-mode="read-only"/g)]).toHaveLength(2);
    expect(html).not.toContain('data-legal-mode="owner"');
    for (const control of ["<form", "<button", "<input", "<textarea"]) {
      expect(html, `atrapa edycji dla personelu: ${control}`).not.toContain(control);
    }
    // Treść widzi — bo odpowiada na pytania klientów.
    expect(html).toContain("Fikcyjna treść regulaminu.");
    expect(html).toContain(messages.legalDocuments.readOnly);
  });

  it("personel też widzi ostrzeżenie o braku regulaminu", async () => {
    session.role = "staff";
    const html = await renderScreen();

    expect(html).toContain("data-legal-terms-warning");
  });
});

describe("ekran stoi pod wspólną miarą formularza", () => {
  it("blok miary opakowuje treść (ADR-060/P8)", async () => {
    const html = await renderScreen();
    expect(html).toContain("data-form-line-measure");
  });

  it("treść dokumentu jest TEKSTEM — znaczniki nie wychodzą do DOM-u", async () => {
    session.role = "staff";
    session.documents = [
      { ...draftTerms, body_draft: '<img src=x onerror="alert(1)">Treść regulaminu.' },
    ];
    const html = await renderScreen();

    expect(html).toContain("Treść regulaminu.");
    expect(html, "treść najemcy trafiła do DOM-u jako HTML").not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
