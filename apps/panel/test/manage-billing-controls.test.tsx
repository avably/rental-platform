/**
 * Sterowanie abonamentem — markup sekcji zarządzania (J2 faza 3, ADR-152).
 *
 * Dwa kontrakty, oba dwustronne:
 *
 *   1. WZNOWIENIE POKAZUJE SIĘ TYLKO WTEDY, GDY JEST CO WZNAWIAĆ. Przycisk
 *      „wznów" przy abonamencie bez anulowania byłby zaproszeniem do akcji,
 *      która i tak odmawia — a to jest dokładnie ten rodzaj ekranu, który
 *      generuje zgłoszenie do wsparcia.
 *   2. OBECNY PLAN JEST OZNACZONY, ALE OBA INTERWAŁY ZOSTAJĄ KLIKALNE.
 *      Projekcja nie zna interwału (0067 trzyma plan i daty, nie lookup_key),
 *      więc miesiąc↔rok musi być osiągalny także na bieżącym planie.
 *
 * Asercje o BRAKU (np. „nie ma bloku wznowienia") stoją zawsze obok asercji
 * o OBECNOŚCI reszty sekcji — inaczej przeszłyby także wtedy, gdyby komponent
 * nie wyrenderował się w ogóle.
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SubscriptionControls } from "@/components/billing/subscription-controls";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

// Ten test bada MARKUP, nie wywołania. Moduł akcji („use server") wciągnąłby
// tu całą stronę serwerową (routing next-intl, klient Supabase) — atrapa
// zostawia w drzewie dokładnie to, co komponent renderuje.
vi.mock("@/lib/actions/billing-management", () => ({
  changeSaasPlanAction: async () => ({ ok: true as const }),
  reactivateSaasSubscriptionAction: async () => ({ ok: true as const }),
  openBillingPortalAction: async () => ({ url: "https://billing.test" }),
}));

function render(
  props: { currentPlanId?: string | null; canReactivate?: boolean } = {},
  locale: "pl" | "en" = "pl",
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pl" ? plMessages : enMessages}
      timeZone="Europe/Warsaw"
    >
      <SubscriptionControls
        currentPlanId={props.currentPlanId === undefined ? "standard" : props.currentPlanId}
        canReactivate={props.canReactivate ?? false}
      />
    </NextIntlClientProvider>,
  );
}

describe("blok wznowienia — tylko przy anulowaniu na koniec okresu", () => {
  it("cancel_at_period_end = true: blok i przycisk wznowienia są w markupie", () => {
    const html = render({ canReactivate: true });
    expect(html).toContain("data-subscription-reactivate-cta");
    expect(html).toContain("Wznów abonament");
  });

  it("cancel_at_period_end = false: bloku wznowienia NIE MA, reszta sekcji jest", () => {
    const html = render({ canReactivate: false });
    // Najpierw dowód, że sekcja się wyrenderowała…
    expect(html).toContain("data-subscription-plan-change");
    // …dopiero potem asercja o braku.
    expect(html).not.toContain("data-subscription-reactivate");
    expect(html).not.toContain("Wznów abonament");
  });
});

describe("zmiana planu — oznaczenie bieżącego planu i komplet przycisków", () => {
  it("bieżący plan oznaczony, oba interwały KLIKALNE na każdym planie", () => {
    const html = render({ currentPlanId: "standard" });
    expect(html).toContain('data-plan-change-current="standard"');
    for (const key of [
      "standard-monthly",
      "standard-yearly",
      "premium-monthly",
      "premium-yearly",
    ]) {
      expect(html, key).toContain(`data-plan-change-cta="${key}"`);
    }
  });

  it("projekcja bez planu: żaden wiersz nie udaje bieżącego", () => {
    const html = render({ currentPlanId: null });
    expect(html).toContain('data-plan-change-cta="standard-monthly"');
    expect(html).not.toContain("data-plan-change-current");
  });

  it("EN niesie ten sam komplet sterowania (parytet kluczy)", () => {
    const html = render({ canReactivate: true }, "en");
    expect(html).toContain("Resume subscription");
    expect(html).toContain('data-plan-change-cta="premium-yearly"');
    // Brak klucza w EN dałby w next-intl komunikat awaryjny zamiast treści.
    expect(html.toLowerCase()).not.toContain("organization.billing.manage");
  });

  it("żaden komunikat sekcji nie cytuje nazwy zmiennej środowiskowej", () => {
    const html = render({ canReactivate: true });
    expect(html.length).toBeGreaterThan(100);
    expect(html).not.toMatch(/AVABLY_[A-Z_]+/);
  });
});
