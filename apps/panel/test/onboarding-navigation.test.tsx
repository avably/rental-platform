/**
 * NAWIGACJA KONTA BEZ ORGANIZACJI (ADR-153, N4).
 *
 * Stan zastany: konto po rejestracji, jeszcze bez organizacji, dostawało
 * PEŁNE menu panelu — dziesięć pozycji, z których KAŻDA prowadzi na trasę
 * tenancką, a `requireMemberPage` odsyła taką sesję z powrotem na pulpit.
 * Pulpit z kolei zapraszał „Przejdź do zamówień". Pętla: dwa ekrany podające
 * sobie człowieka w kółko, a do `/organizacja/nowa` nie prowadził ANI JEDEN
 * link w całym panelu — choć to JEDYNA czynność, jaką takie konto może
 * wykonać.
 *
 * Test mierzy OBIE STRONY, w sidebarze i na pasku mobilnym:
 *   • `onboarding` → z nawigacji zostaje sam pulpit (zero pozycji grup),
 *   • bez flagi → komplet pozycji wraca co do jednej (kontrola pozytywna,
 *     żeby „naprawa" nie okazała się wygaszeniem menu dla wszystkich).
 *
 * Renderowany jest PRAWDZIWY komponent (`renderToStaticMarkup`), więc filtr
 * podpięty pod flagę, która nigdy nie wstaje, nie przejdzie.
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { SidebarNav } = await import("@/components/shell/sidebar-nav");
const { MobileNav } = await import("@/components/shell/mobile-nav");
const { PANEL_NAV_ITEMS, PANEL_NAV_PLACEHOLDER } = await import("@/lib/shell/nav");

function renderSidebar(props: { onboarding?: boolean; closing?: boolean } = {}): string {
  pathname.current = "/";
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {/* Widok OWNERA — kontrola pozytywna liczy KOMPLET pozycji; od M-UX-02
          (ADR-193) pozycje `ownerOnly` znikają bez tej flagi. */}
      <SidebarNav isOwner {...props} />
    </NextIntlClientProvider>,
  );
}

function renderMobile(props: { onboarding?: boolean } = {}): string {
  pathname.current = "/";
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <MobileNav {...props} />
    </NextIntlClientProvider>,
  );
}

/** Identyfikatory pozycji grup obecne w wyrenderowanym HTML. */
function navItemIds(html: string): string[] {
  return [...html.matchAll(/data-nav-item="([^"]+)"/g)].map((match) => match[1]!);
}

describe("sidebar: sesja bez organizacji widzi sam pulpit", () => {
  it("kontrola pozytywna — bez flagi renderuje się KOMPLET pozycji", () => {
    const ids = navItemIds(renderSidebar());

    expect(ids.sort()).toEqual(PANEL_NAV_ITEMS.map((item) => item.id).sort());
    expect(ids.length).toBeGreaterThan(5);
  });

  it("z flagą onboarding znika KAŻDA pozycja grup", () => {
    const html = renderSidebar({ onboarding: true });

    expect(
      navItemIds(html),
      "sesja bez organizacji dalej widzi menu, którego każda pozycja zawraca na pulpit",
    ).toEqual([]);
  });

  it("pulpit ZOSTAJE — to jedyne wejście do zakładania organizacji", () => {
    const html = renderSidebar({ onboarding: true });

    // Najpierw: nawigacja w ogóle się wyrenderowała (asercja „nie zawiera X"
    // przeszłaby też dla pustego drzewa).
    expect(html).toContain('data-panel-nav="true"');
    expect(html).toContain(`data-nav-placeholder="${PANEL_NAV_PLACEHOLDER.id}"`);
    expect(html).toContain(messages.nav.dashboard);
  });

  it("gałęzie drzewa też znikają — pusta sekcja „Strona sklepu” byłaby gorsza niż jej brak", () => {
    const html = renderSidebar({ onboarding: true });

    // Od ADR-231 nawigacja to DRZEWO: „nagłówki" to wiersze-rodzice gałęzi
    // (Strona sklepu, Ustawienia, Organizacja). Przy onboardingu drzewo jest
    // puste, więc żadna z tych sekcji się nie pojawia.
    expect(html).not.toContain(messages.nav.store);
    expect(html).not.toContain(messages.nav.settings);
    expect(html).not.toContain(messages.nav.organization);
  });
});

describe("pasek mobilny: ta sama reguła na wąskim ekranie", () => {
  it("kontrola pozytywna — bez flagi pasek ma komplet pozycji", () => {
    const html = renderMobile();

    expect(html).toContain('data-mobile-bottom-nav="true"');
    expect(html).toContain(messages.nav.orders);
    expect(html).toContain(messages.nav.catalog);
  });

  it("z flagą onboarding zostaje pulpit i menu — bez zamówień i katalogu", () => {
    const html = renderMobile({ onboarding: true });

    expect(html, "pasek się nie wyrenderował — asercje o braku byłyby puste").toContain(
      'data-mobile-bottom-nav="true"',
    );
    expect(html).toContain(messages.nav.dashboard);
    expect(html).toContain(messages.nav.mobileMenu);
    expect(html).not.toContain(messages.nav.orders);
    expect(html).not.toContain(messages.nav.catalog);
    // Siatka musi policzyć komórki na nowo, inaczej pasek rozjeżdża się
    // wizualnie (dwie pozycje w pięciu kolumnach).
    expect(html).toContain("grid-cols-2");
  });
});
