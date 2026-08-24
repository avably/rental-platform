import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

const state = vi.hoisted(() => ({ configured: false, documents: [] as Record<string, unknown>[], attempts: [] as Record<string, unknown>[] }));

function translation(path: string) {
  const values = path.split(".").reduce<unknown>((current, key) => (current as Record<string, unknown>)[key], messages);
  return (key: string) => key.split(".").reduce<unknown>((current, part) => (current as Record<string, unknown>)[part], values) as string;
}

vi.mock("next-intl/server", () => ({
  getLocale: async () => "pl",
  getTranslations: async (path: string) => translation(path),
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => createElement("a", { href, ...props }, children),
}));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => ({
    tenantId: "tenant-1",
    supabase: {
      from: (table: string) => {
        const result = table === "tenant_settings"
          ? { data: state.configured ? { key: "contract_document" } : null }
          : { data: table === "contract_documents" ? state.documents : state.attempts };
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq"]) chain[method] = () => chain;
        chain.maybeSingle = async () => result;
        chain.order = async () => result;
        return chain;
      },
    },
  }),
}));

vi.mock("@/app/[locale]/(panel)/zamowienia/[id]/contract-forms", () => ({
  GenerateContractForm: ({ orderId }: { orderId: string }) => createElement("button", null, `GENERATE:${orderId}`),
  SendContractForm: ({ retry }: { retry: boolean }) => createElement("button", null, retry ? "RETRY" : "SEND"),
}));

const { ContractSection } = await import("@/app/[locale]/(panel)/zamowienia/[id]/contract-section");

describe("ContractSection", () => {
  beforeEach(() => {
    state.configured = false;
    state.documents = [];
    state.attempts = [];
  });

  it("prowadzi do konfiguracji, gdy ustawień brakuje", async () => {
    const html = renderToStaticMarkup(await ContractSection({ orderId: "order-1" }));
    expect(html).toContain(messages.orders.contract.missingSettings);
    expect(html).toContain('href="/ustawienia-umow"');
    expect(html).not.toContain("GENERATE:order-1");
  });

  it("pokazuje hash, wersję, pobranie oraz retry po porażce", async () => {
    state.configured = true;
    state.documents = [{ id: "doc-1", sha256: "a".repeat(64), locale: "pl", terms_version: "2026-07", recipient: "anna@example.pl", created_at: "2026-07-22T10:00:00Z" }];
    state.attempts = [{ contract_document_id: "doc-1", status: "failed", error: "resend down", created_at: "2026-07-22T10:01:00Z" }];
    const html = renderToStaticMarkup(await ContractSection({ orderId: "order-1" }));
    expect(html).toContain("GENERATE:order-1");
    expect(html).toContain(`SHA-256: ${"a".repeat(64)}`);
    expect(html).toContain("2026-07");
    expect(html).toContain('href="/zamowienia/order-1/contract/doc-1"');
    // Link „podgląd" otwiera nową kartę (target=_blank) — musi nieść jawny
    // rel, żeby nowe okno nie dostało uchwytu window.opener ani nagłówka Referer.
    expect(html, "link podglądu umowy otwiera kartę bez rel=noopener").toMatch(
      /<a[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
    expect(html).toContain("RETRY");
    expect(html).toContain("resend down");
  });
});
