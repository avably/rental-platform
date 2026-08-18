/**
 * Kontrakt uprawnień nawigacji — pozycje `ownerOnly` (M-UX-02, audyt
 * właściciela 17.08, ADR-193).
 *
 * ROZSTRZYGNIĘCIE PM: staff w ogóle NIE widzi pozycji „Zespół" w sidebarze
 * (żadnych tooltipów „brak dostępu") — sidebar odzwierciedla uprawnienia,
 * a twardą bramką pozostaje serwer (`requireMember("owner")` na
 * /zaproszenia i wszystkich akcjach; audyt potwierdził egzekwowanie).
 * Przed naprawą staff dostawał link, który zawsze kończył się odmową
 * i przekierowaniem — drzwi namalowane na ścianie.
 *
 * Bramka mierzy WYRENDEROWANY HTML (nie źródło): render dla staff nie niesie
 * ani identyfikatora pozycji, ani etykiety „Zespół" w żadnym z jej trzech
 * miejsc (treść, aria-label, tooltip); render ownera niesie pozycję w grupie
 * ORGANIZACJA. Filtr jest CHIRURGICZNY: reszta grupy zostaje dla staff bez
 * zmian — zniknięcie całej grupy byłoby regresem nawigacji.
 */
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { SidebarNav } = await import("@/components/shell/sidebar-nav");
const { PANEL_NAV_GROUPS } = await import("@/lib/shell/nav");

function renderNav(props: Partial<Parameters<typeof SidebarNav>[0]> = {}): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <SidebarNav {...props} />
    </NextIntlClientProvider>,
  );
}

const TEAM_LABEL = messages.nav.team; // „Zespół"

describe("pozycja „Zespół” odzwierciedla uprawnienia (M-UX-02)", () => {
  it("staff: brak pozycji — ani identyfikatora, ani etykiety w żadnym miejscu", () => {
    const html = renderNav({ isOwner: false });

    expect(html).not.toContain('data-nav-item="team"');
    // Etykieta żyje w trzech miejscach (treść, aria-label, tooltip) — brak
    // frazy w CAŁYM HTML domyka wszystkie naraz, także przyszłe.
    expect(html).not.toContain(TEAM_LABEL);
  });

  it("owner: pozycja jest, prowadzi do /zaproszenia i niesie etykietę", () => {
    const html = renderNav({ isOwner: true });
    const anchor = html.match(/<a[^>]*data-nav-item="team"[^>]*>/)?.[0];

    expect(anchor, "brak pozycji team u ownera").toBeDefined();
    expect(anchor).toContain('href="/zaproszenia"');
    expect(html).toContain(TEAM_LABEL);
  });

  it("filtr jest chirurgiczny: staff dalej widzi resztę grupy ORGANIZACJA", () => {
    const html = renderNav({ isOwner: false });
    const organization = PANEL_NAV_GROUPS.find((group) => group.id === "organization");
    expect(organization).toBeDefined();

    const remaining = organization!.items.filter((item) => !item.ownerOnly);
    // Podłoga liczności: gdyby grupa zmalała do zera, pętla niżej byłaby pusta.
    expect(remaining.length).toBeGreaterThanOrEqual(3);
    for (const item of remaining) {
      expect(html, `staff stracił pozycję ${item.id}`).toContain(
        `data-nav-item="${item.id}"`,
      );
    }
    // Nagłówek grupy zostaje — filtr zdejmuje pozycję, nie grupę.
    expect(html).toContain(messages.nav.groupOrganization);
  });

  it("brak jawnego prop = zachowanie STAFF (odmowa domyślna, jak w guardach)", () => {
    // Zapomniane okablowanie nowego miejsca renderu ma CHOWAĆ pozycję
    // uprzywilejowaną, nie pokazywać jej wszystkim.
    expect(renderNav()).not.toContain('data-nav-item="team"');
  });

  it("filtr uprawnień składa się z oknem domykania: owner w closing też nie widzi Zespołu", () => {
    // /zaproszenia nie stoi na allowliście okna domykania (ADR-138) — filtr
    // ról nie może go tam przywrócić.
    const html = renderNav({ isOwner: true, closing: true });
    expect(html).not.toContain('data-nav-item="team"');
  });
});
