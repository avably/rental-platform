/**
 * CIĄGŁY PRZEWODNIK URUCHOMIENIA (ADR-229): sticky pasek `LaunchGuideBar` i
 * podniesiona karta pulpitu `DashboardLaunchBanner` (solid-limonka + chipy braków).
 *
 * `renderToStaticMarkup` w node (jak `launch-hub.test.tsx`): PRAWDZIWY render,
 * asercje patrzą na wyjściowy HTML. Overlay „Zobacz wszystko" i bottom-sheet są
 * stanami KLIENCKIMI (useState, domyślnie zamknięte), więc na statycznym renderze
 * nie widać ich treści — dlatego blockery paska pokrywa render karty (inline),
 * a paska: obecność wyzwalaczy i wariant rozwinięty/hairline.
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";
import enMessages from "../messages/en.json";

import type { LaunchGuideState } from "@/lib/onboarding/launch";

const MESSAGES = { pl: plMessages, en: enMessages } as const;
type Locale = keyof typeof MESSAGES;

const pathname = vi.hoisted(() => ({ current: "/zamowienia" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { LaunchGuideBar } = await import("@/components/shell/launch-guide-bar");
const { DashboardLaunchBanner } = await import(
  "@/app/[locale]/(panel)/dashboard-launch-banner"
);

function guideState(overrides: Partial<LaunchGuideState> = {}): LaunchGuideState {
  return {
    progress: { done: 1, total: 7 },
    nextStep: { key: "legal", href: "/dokumenty-prawne" },
    blockers: ["legal", "product", "delivery"],
    ...overrides,
  };
}

function render(node: React.ReactNode, locale: Locale = "pl"): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {node}
    </NextIntlClientProvider>,
  );
}

describe("pasek przewodnika — zasięg (wszędzie poza root pulpitem)", () => {
  it("na ROOT pulpicie `/` NIE renderuje się (karta przejmuje — bez dubla)", () => {
    pathname.current = "/";
    const html = render(<LaunchGuideBar state={guideState()} initialCollapsed={false} />);
    expect(html).toBe("");
  });

  it("na każdej innej trasie panelu renderuje pasek", () => {
    pathname.current = "/zamowienia";
    const html = render(<LaunchGuideBar state={guideState()} initialCollapsed={false} />);
    expect(html).toContain("data-launch-guide-bar");
  });
});

describe("pasek przewodnika — wariant rozwinięty vs hairline (ciasteczko)", () => {
  it("rozwinięty (ciasteczko puste): tytuł, następny krok, CTA deep-link, przełącznik overlaya, zwiń", () => {
    pathname.current = "/zamowienia";
    const html = render(<LaunchGuideBar state={guideState()} initialCollapsed={false} />);

    expect(html).toContain('data-launch-guide-collapsed="false"');
    expect(html).toContain(plMessages.launch.banner.title);
    // Następny krok = tytuł pierwszego otwartego wymaganego (legal).
    expect(html).toContain(plMessages.launch.guide.nextStep);
    expect(html).toContain(plMessages.launch.steps.legal.title);
    // CTA to REALNY link do ekranu następnego kroku.
    const cta = html.match(/<a[^>]*data-launch-guide-cta[^>]*>/);
    expect(cta?.[0]).toContain('href="/dokumenty-prawne"');
    // Odpowiednik tekstowy pierścienia (pierścień jest aria-hidden).
    expect(html).toContain("1 z 7 wymaganych kroków gotowych");
    const ring = html.match(/<svg[^>]*data-launch-guide-ring[^>]*>/);
    expect(ring?.[0]).toContain('aria-hidden="true"');
    // Przełącznik overlaya jako button z aria-expanded/aria-controls.
    const seeAll = html.match(/<button[^>]*data-launch-guide-see-all[^>]*>/);
    expect(seeAll?.[0]).toContain('aria-expanded="false"');
    expect(seeAll?.[0]).toContain("aria-controls=");
    expect(html).toContain("data-launch-guide-collapse");
    // Rozwinięty nie pokazuje hairline'a.
    expect(html).not.toContain("data-launch-guide-hairline");
  });

  it("hairline (ciasteczko collapsed): cienki pasek postępu, klik rozwija; bez CTA rozwiniętego", () => {
    pathname.current = "/zamowienia";
    const html = render(<LaunchGuideBar state={guideState()} initialCollapsed />);

    expect(html).toContain('data-launch-guide-collapsed="true"');
    const hairline = html.match(/<button[^>]*data-launch-guide-hairline[^>]*>/);
    expect(hairline, "brak hairline'a").not.toBeNull();
    expect(hairline?.[0]).toContain("aria-label=");
    // Zwinięty pasek nie niesie rozwiniętego CTA następnego kroku ani „Zobacz wszystko".
    expect(html).not.toContain("data-launch-guide-see-all");
  });

  it("mobile: wyzwalacz bottom-sheet obecny w obu wariantach", () => {
    pathname.current = "/zamowienia";
    expect(
      render(<LaunchGuideBar state={guideState()} initialCollapsed={false} />),
    ).toContain("data-launch-guide-mobile-trigger");
    expect(render(<LaunchGuideBar state={guideState()} initialCollapsed />)).toContain(
      "data-launch-guide-mobile-trigger",
    );
  });
});

describe("pasek przewodnika — i18n PL+EN, zero surowych kluczy", () => {
  it.each(["pl", "en"] as const)("locale %s: etykiety z tłumaczeń, nie ścieżki kluczy", (locale) => {
    pathname.current = "/zamowienia";
    const html = render(
      <LaunchGuideBar state={guideState()} initialCollapsed={false} />,
      locale,
    );
    expect(html).toContain(MESSAGES[locale].launch.guide.nextStep);
    expect(html).toContain(MESSAGES[locale].launch.guide.finishStep);
    expect(html).toContain(MESSAGES[locale].launch.guide.seeAll);
    // Surowy klucz i18n (pełna ścieżka) nie może wyciec na ekran.
    expect(html).not.toContain("launch.guide.");
  });
});

describe("karta pulpitu — solid-limonka + chipy braków (ADR-229)", () => {
  it("solid-limonka, h2, postęp, CTA do huba i chipy braków, które ma w ręku", () => {
    const html = render(<DashboardLaunchBanner done={1} total={7} blockers={["legal", "delivery"]} />);

    // Mocniejszy akcent = solidna limonka (token primary), nie neutralna karta.
    expect(html).toContain("bg-primary");
    expect(html).toMatch(/<h2\b/);
    expect(html).toContain("1 z 7 wymaganych kroków gotowych");
    const cta = html.match(/<a[^>]*data-launch-banner-cta[^>]*>/);
    expect(cta?.[0]).toContain('href="/uruchomienie"');
    // Chipy braków = TYLKO realnie brakujące (te same, co overlay paska).
    expect(html).toContain('data-launch-banner-blocker="legal"');
    expect(html).toContain('data-launch-banner-blocker="delivery"');
    expect(html).not.toContain('data-launch-banner-blocker="product"');
  });

  it("brak braków (komplet minimum) → zero chipów, ale karta wciąż prowadzi do huba", () => {
    const html = render(<DashboardLaunchBanner done={6} total={7} blockers={[]} />);
    expect(html).not.toContain("data-launch-banner-blocker");
    expect(html).toContain('data-launch-banner-cta');
    expect(html).not.toMatch(/<h1\b/);
  });
});
