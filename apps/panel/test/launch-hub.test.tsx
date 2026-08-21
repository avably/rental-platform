/**
 * RENDER huba „Uruchomienie" (ADR-228): pierścień + odpowiednik tekstowy,
 * fazy jako karty, kroki jako lista, i SOFT-GATE publikacji (disabled + lista
 * braków ⇄ aktywny deep-link do /strona). Plus kompaktowy baner pulpitu i
 * warunkowa pozycja nawigacji z badge.
 *
 * `renderToStaticMarkup` w środowisku node (jak `sidebar-nav.test.tsx`): to
 * PRAWDZIWY render — asercje patrzą na wyjściowy HTML, nie na źródło.
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import type { LaunchSignals } from "@/lib/onboarding/launch";

const pathname = vi.hoisted(() => ({ current: "/uruchomienie" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { LaunchHub } = await import("@/app/[locale]/(panel)/uruchomienie/launch-hub");
const { DashboardLaunchBanner } = await import(
  "@/app/[locale]/(panel)/dashboard-launch-banner"
);
const { SidebarNav } = await import("@/components/shell/sidebar-nav");

function freshSignals(overrides: Partial<LaunchSignals> = {}): LaunchSignals {
  return {
    firstProductName: null,
    unitCount: 0,
    publishedAt: null,
    hasContractDocument: false,
    hasEmailSender: false,
    chargesEnabled: false,
    ordersCount: 0,
    legalReady: false,
    hasDelivery: false,
    activeProductCount: 0,
    customDomainReady: false,
    ...overrides,
  };
}

function renderPl(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("hub /uruchomienie — nagłówek i fazy", () => {
  it("cztery fazy jako karty, w kolejności config-first", () => {
    const html = renderPl(<LaunchHub signals={freshSignals()} />);
    const phases = [...html.matchAll(/data-launch-phase="(\d)"/g)].map((m) => m[1]);
    expect(phases).toEqual(["1", "2", "3", "4"]);
  });

  it("pierścień jest aria-hidden, a jego odpowiednik jest TEKSTEM (a11y)", () => {
    const html = renderPl(<LaunchHub signals={freshSignals()} />);
    // Świeży tenant: „Dane organizacji" ✓ z seedu → 1 z 7.
    expect(html).toContain("1 z 7 wymaganych kroków gotowych");
    const ring = html.match(/<svg[^>]*data-launch-ring[^>]*>/);
    expect(ring?.[0]).toContain('aria-hidden="true"');
  });

  it("regulamin i polityka: wyróżnienie bramki sprzedaży i JEDYNY wyróżniony CTA", () => {
    const html = renderPl(<LaunchHub signals={freshSignals()} />);
    // Krok legal ma znacznik bramki.
    const legalRow = html.slice(
      html.indexOf('data-launch-step="legal"'),
      html.indexOf('data-launch-step="contract"'),
    );
    expect(legalRow).toContain('data-launch-tag="gate"');
    // Dokładnie jeden wyróżniony CTA (pierwszy otwarty wymagany = legal).
    expect(html.match(/data-launch-step-cta="/g)).toHaveLength(1);
    expect(html).toContain('data-launch-step-cta="legal"');
    const cta = html.match(/<a[^>]*data-launch-step-cta="legal"[^>]*>/);
    expect(cta?.[0]).toContain('href="/dokumenty-prawne"');
  });

  it("kroki opcjonalne (płatności, domena) mają znacznik Opcjonalne", () => {
    const html = renderPl(<LaunchHub signals={freshSignals()} />);
    for (const key of ["payments", "domain"]) {
      const row = html.match(new RegExp(`data-launch-step="${key}"[^>]*data-launch-optional="true"`));
      expect(row, `krok ${key} bez znacznika opcjonalności`).not.toBeNull();
    }
  });

  it("deep-linki kroków celują w istniejące ekrany", () => {
    const html = renderPl(<LaunchHub signals={freshSignals()} />);
    for (const [key, href] of [
      ["delivery", "/ustawienia-dostaw"],
      ["product", "/katalog/nowy"],
      ["appearance", "/strona"],
    ] as const) {
      const link = html.match(new RegExp(`<a[^>]*data-launch-step-(?:cta|link|edit)="${key}"[^>]*>`));
      expect(link, `brak linku kroku ${key}`).not.toBeNull();
      expect(link?.[0]).toContain(`href="${href}"`);
    }
  });

  it("krok zrobiony niesie link Edytuj, nie przycisk konfiguracji", () => {
    const html = renderPl(
      <LaunchHub signals={freshSignals({ hasContractDocument: true })} />,
    );
    expect(html).toContain('data-launch-step-edit="contract"');
    expect(html).not.toContain('data-launch-step-cta="contract"');
  });
});

describe("hub /uruchomienie — soft-gate publikacji", () => {
  it("minimum niespełnione: przycisk disabled + lista braków z aria-describedby", () => {
    const html = renderPl(<LaunchHub signals={freshSignals()} />);
    const bar = html.slice(html.indexOf("data-launch-publish"));

    expect(html).toContain('data-launch-publish-open="false"');
    const button = bar.match(/<button[^>]*data-launch-publish-disabled[^>]*>/);
    expect(button, "brak przycisku disabled").not.toBeNull();
    expect(button?.[0]).toContain("disabled");
    expect(button?.[0]).toContain('aria-describedby="launch-publish-missing"');
    // Lista braków wymienia realne braki i tylko je.
    for (const blocker of ["legal", "product", "delivery"]) {
      expect(html).toContain(`data-launch-missing="${blocker}"`);
    }
    // Brak aktywnego linku publikacji, dopóki bramka zamknięta.
    expect(html).not.toContain("data-launch-publish-cta");
  });

  it("lista braków pokazuje TYLKO realnie brakujące", () => {
    // Legalia i produkt gotowe, brakuje tylko dostawy.
    const html = renderPl(
      <LaunchHub signals={freshSignals({ legalReady: true, activeProductCount: 1 })} />,
    );
    expect(html).toContain('data-launch-missing="delivery"');
    expect(html).not.toContain('data-launch-missing="legal"');
    expect(html).not.toContain('data-launch-missing="product"');
  });

  it("minimum spełnione: przycisk aktywny i deep-linkuje do /strona (nie reimplementuje publikacji)", () => {
    const html = renderPl(
      <LaunchHub
        signals={freshSignals({ legalReady: true, activeProductCount: 1, hasDelivery: true })}
      />,
    );
    expect(html).toContain('data-launch-publish-open="true"');
    const cta = html.match(/<a[^>]*data-launch-publish-cta[^>]*>/);
    expect(cta, "brak aktywnego CTA publikacji").not.toBeNull();
    expect(cta?.[0]).toContain('href="/strona"');
    expect(html).not.toContain("data-launch-publish-disabled");
  });
});

describe("baner pulpitu — kompaktowe wejście do huba", () => {
  it("h2, postęp i CTA do /uruchomienie", () => {
    const html = renderPl(<DashboardLaunchBanner done={4} total={7} />);
    expect(html).toMatch(/<h2\b/);
    expect(html).toContain("4 z 7 wymaganych kroków gotowych");
    const cta = html.match(/<a[^>]*data-launch-banner-cta[^>]*>/);
    expect(cta?.[0]).toContain('href="/uruchomienie"');
  });

  it("nie renderuje własnego h1 (belka jest jedynym tytułem — ADR-060)", () => {
    const html = renderPl(<DashboardLaunchBanner done={0} total={7} />);
    expect(html).not.toMatch(/<h1\b/);
  });
});

describe("nawigacja — warunkowa pozycja Uruchomienie z badge", () => {
  function renderNav(props: { launch?: { done: number; total: number } | null }): string {
    pathname.current = "/zamowienia";
    return renderToStaticMarkup(
      <NextIntlClientProvider locale="pl" messages={messages}>
        <SidebarNav isOwner {...props} />
      </NextIntlClientProvider>,
    );
  }

  it("pokazuje pozycję z badge postępu i linkiem do huba, gdy onboarding trwa", () => {
    const html = renderNav({ launch: { done: 4, total: 7 } });
    const link = html.match(/<a[^>]*data-nav-launch="true"[^>]*>[\s\S]*?<\/a>/);
    expect(link, "brak pozycji Uruchomienie").not.toBeNull();
    expect(link?.[0]).toContain('href="/uruchomienie"');
    expect(link?.[0]).toContain("4/7");
    expect(html).toContain("data-nav-launch-badge");
  });

  it("stoi NA GÓRZE grupy SPRZEDAŻ — przed Zamówieniami", () => {
    const html = renderNav({ launch: { done: 1, total: 7 } });
    expect(html.indexOf('data-nav-launch="true"')).toBeLessThan(
      html.indexOf('data-nav-item="orders"'),
    );
  });

  it("znika po ukończeniu onboardingu (launch = null) — jak baner pulpitu", () => {
    const html = renderNav({ launch: null });
    expect(html).not.toContain('data-nav-launch="true"');
    // Kontrola pozytywna: nawigacja się wyrenderowała (grupy są).
    expect(html).toContain('data-nav-item="orders"');
  });

  it("NIE jest pozycją kontraktu struktury — używa data-nav-launch, nie data-nav-item", () => {
    const html = renderNav({ launch: { done: 2, total: 7 } });
    expect(html).not.toContain('data-nav-item="launch"');
  });

  it("dostaje aria-current na własnej trasie", () => {
    pathname.current = "/uruchomienie";
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pl" messages={messages}>
        <SidebarNav isOwner launch={{ done: 3, total: 7 }} />
      </NextIntlClientProvider>,
    );
    const link = html.match(/<a[^>]*data-nav-launch="true"[^>]*>/);
    expect(link?.[0]).toContain('aria-current="page"');
  });
});
