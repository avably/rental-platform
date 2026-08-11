/**
 * Karta „Zacznij tutaj" (UX1, ADR-140) — dwa kontrakty:
 *
 *  1. MODEL (startSteps/isStartComplete, czyste funkcje): stan każdego kroku
 *     wynika WYŁĄCZNIE z danych (świeży tenant 0/6 → wszystko otwarte;
 *     częściowy — dokładnie te kroki, które mówią sygnały; komplet →
 *     isStartComplete, czyli karta znika). Zero odhaczania ręcznie.
 *  2. RENDER (DashboardStartCard): postęp jawny „N z 6", krok zrobiony ze
 *     znacznikiem i bez linku, PIERWSZY niezrobiony jako jedyny wyróżniony
 *     przycisk, pozostałe jako zwykłe linki do właściwych ekranów.
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import type { StartCardSignals } from "@/lib/dashboard/start-card";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { startSteps, isStartComplete, START_STEP_KEYS } = await import(
  "@/lib/dashboard/start-card"
);
const { DashboardStartCard } = await import(
  "@/app/[locale]/(panel)/dashboard-start-card"
);

/** Sygnały świeżego tenanta — dzień zero, nic nie zrobione. */
function freshSignals(overrides: Partial<StartCardSignals> = {}): StartCardSignals {
  return {
    firstProductName: null,
    unitCount: 0,
    publishedAt: null,
    hasContractDocument: false,
    hasEmailSender: false,
    chargesEnabled: false,
    ordersCount: 0,
    ...overrides,
  };
}

function renderCard(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("model stanów kroków (liczony z danych, nie odhaczany)", () => {
  it("świeży tenant: 0 z 6, kolejność kroków ze spec-u (zamówienie ZAMYKA listę)", () => {
    const steps = startSteps(freshSignals());

    expect(steps.map((step) => step.key)).toEqual([...START_STEP_KEYS]);
    expect(steps.map((step) => step.key)).toEqual([
      "product",
      "store",
      "contract",
      "emails",
      "payments",
      "firstOrder",
    ]);
    expect(steps.every((step) => !step.done)).toBe(true);
    expect(isStartComplete(steps)).toBe(false);
  });

  it("stan częściowy: dokładnie te kroki, o których mówią dane", () => {
    const steps = startSteps(
      freshSignals({
        firstProductName: "Rower gravel (rama M)",
        unitCount: 3,
        publishedAt: "2026-08-01T10:00:00Z",
        hasContractDocument: true,
        hasEmailSender: true,
      }),
    );

    expect(steps.map((step) => [step.key, step.done])).toEqual([
      ["product", true],
      ["store", true],
      ["contract", true],
      ["emails", true],
      ["payments", false],
      ["firstOrder", false],
    ]);
    expect(isStartComplete(steps)).toBe(false);
  });

  it("produkt BEZ egzemplarza to krok NIEzrobiony (bez egzemplarza nie ma dostępności)", () => {
    const steps = startSteps(freshSignals({ firstProductName: "Rower", unitCount: 0 }));
    expect(steps[0]).toEqual({ key: "product", done: false });
  });

  it("płatności liczą się dopiero od charges_enabled (sam wiersz konta to rozpoczęty onboarding)", () => {
    const notEnabled = startSteps(freshSignals({ chargesEnabled: false }));
    const enabled = startSteps(freshSignals({ chargesEnabled: true }));
    expect(notEnabled[4].done).toBe(false);
    expect(enabled[4].done).toBe(true);
  });

  it("komplet 6/6 → isStartComplete (karta znika w całości)", () => {
    const steps = startSteps(
      freshSignals({
        firstProductName: "Rower",
        unitCount: 1,
        publishedAt: "2026-08-01T10:00:00Z",
        hasContractDocument: true,
        hasEmailSender: true,
        chargesEnabled: true,
        ordersCount: 1,
      }),
    );
    expect(steps.every((step) => step.done)).toBe(true);
    expect(isStartComplete(steps)).toBe(true);
  });
});

describe("render karty", () => {
  it("dzień zero: postęp „0 z 6”, pierwszy krok jako JEDYNY wyróżniony przycisk, reszta zwykłe linki do właściwych ekranów", () => {
    const html = renderCard(<DashboardStartCard steps={startSteps(freshSignals())} />);

    expect(html).toContain("Zacznij tutaj");
    expect(html).toContain("0 z 6 zrobione");
    // Dokładnie jeden wyróżniony CTA — pierwszy otwarty krok.
    expect(html.match(/data-start-step-cta="/g)).toHaveLength(1);
    expect(html).toContain('data-start-step-cta="product"');
    const cta = html.match(/<a[^>]*data-start-step-cta="product"[^>]*>/);
    expect(cta?.[0]).toContain('href="/katalog/nowy"');
    // Pozostałe kroki: zwykłe linki do swoich ekranów.
    for (const [key, href] of [
      ["store", "/strona"],
      ["contract", "/ustawienia-umow"],
      ["emails", "/ustawienia-emaili"],
      ["payments", "/ustawienia-platnosci"],
      ["firstOrder", "/zamowienia/nowe"],
    ] as const) {
      const link = html.match(new RegExp(`<a[^>]*data-start-step-link="${key}"[^>]*>`));
      expect(link, `brak linku kroku ${key}`).not.toBeNull();
      expect(link?.[0]).toContain(`href="${href}"`);
    }
  });

  it("stan częściowy 4/6: kroki zrobione ze znacznikiem „Zrobione” i BEZ linku; wyróżnienie przechodzi na pierwszy otwarty", () => {
    const steps = startSteps(
      freshSignals({
        firstProductName: "Rower gravel (rama M)",
        unitCount: 3,
        publishedAt: "2026-08-01T10:00:00Z",
        hasContractDocument: true,
        hasEmailSender: true,
      }),
    );
    const html = renderCard(
      <DashboardStartCard steps={steps} productDetail="Rower gravel (rama M), 3 egzemplarze" />,
    );

    expect(html).toContain("4 z 6 zrobione");
    expect(html.match(/data-start-step-done/g)).toHaveLength(4);
    expect(html.match(/data-start-step-cta="/g)).toHaveLength(1);
    expect(html).toContain('data-start-step-cta="payments"');
    // Krok zrobiony nie jest już wejściem: żadnego linku w jego wierszu.
    const productRow = html.slice(
      html.indexOf('data-start-step="product"'),
      html.indexOf('data-start-step="store"'),
    );
    expect(productRow).not.toContain("<a ");
    expect(productRow).toContain("Rower gravel (rama M), 3 egzemplarze");
    expect(productRow).toContain("Zrobione");
  });
});
