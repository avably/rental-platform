import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Kontrakt shella panelu po P6 (ADR-059): wejście superadmina, znak marki
 * i skok do treści.
 *
 * WEJŚCIE SUPERADMINA jest tu najważniejsze i ma DWA niezależne dowody:
 * (1) render dla roli — zwykły członek NIE MOŻE go zobaczyć, superadmin musi;
 * (2) struktura — blok stoi POZA `<nav data-panel-nav>`, bo tamta sekwencja
 * jest kontraktem z artefaktem (ADR-056 D1) i doklejenie do niej pozycji
 * spoza handoffu wywróciłoby `panel-nav-contract`.
 *
 * Ukrycie linku NIE JEST zabezpieczeniem — bramką są `requireSuperadminPage`
 * (404 dla obcych) i RLS `app.is_superadmin()`. Ten test broni tego, żeby
 * zwykły najemca nie oglądał wejścia, którego i tak nie otworzy.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/zamowienia",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { SuperadminEntry } = await import("@/components/shell/superadmin-entry");
const { SkipLink, MAIN_CONTENT_ID } = await import("@/components/shell/skip-link");
const { BrandLogo, BrandSymbol } = await import("@/components/shell/brand-mark");
const { SidebarNav } = await import("@/components/shell/sidebar-nav");

/**
 * Oba komponenty są CZYSTE (etykieta propem, wzorzec `OrderRowActions` z P4),
 * więc render nie potrzebuje ani serwera Next.js, ani kontekstu tłumaczeń —
 * `getTranslations` zostało w layoutach, gdzie ma prawo działać.
 */
function render(element: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      {element}
    </NextIntlClientProvider>,
  );
}

const artifact = readFileSync(
  resolve(process.cwd(), "../../docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

describe("kontrakt shella — wejście superadmina", () => {
  it("zwykły członek NIE widzi wejścia do panelu superadmina", () => {
    const html = render(
      <SuperadminEntry superadmin={false} label={messages.nav.superadminPanel} />,
    );

    expect(html).toBe("");
    expect(html).not.toContain("data-superadmin-entry");
    expect(html).not.toContain("/admin");
  });

  it("superadmin widzi wejście, z etykietą tekstową i adresem /admin", () => {
    // Kontrola POZYTYWNA dla asercji wyżej: bez niej komponent zawsze pusty
    // też przechodziłby test „zwykły user nie widzi".
    const html = render(
      <SuperadminEntry superadmin label={messages.nav.superadminPanel} />,
    );

    expect(html).toContain("data-superadmin-entry");
    expect(html).toContain(messages.nav.superadminPanel);
    expect(html).toMatch(/href="\/admin/);
  });

  it("wejście superadmina stoi POZA nawigacją objętą kontraktem struktury", () => {
    const entry = render(<SuperadminEntry superadmin label={messages.nav.superadminPanel} />);
    const nav = render(<SidebarNav />);

    // Nawigacja z ADR-056 nie zna superadmina — gdyby wejście trafiło do
    // środka `<nav data-panel-nav>`, panel-nav-contract by je zobaczył.
    expect(nav).toContain('data-panel-nav="true"');
    expect(nav).not.toContain("data-superadmin-entry");
    expect(nav).not.toContain(messages.nav.superadminPanel);
    expect(entry).not.toContain("data-panel-nav");
  });
});

describe("kontrakt shella — znak marki", () => {
  /** Ścieżki `d` w kolejności wystąpienia — bez atrybutów i białych znaków. */
  function paths(svg: string): string[] {
    return [...svg.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]!);
  }

  const logo = renderToStaticMarkup(<BrandLogo />);
  const symbol = renderToStaticMarkup(<BrandSymbol />);

  it("pełne logo zachowuje sześć zamrożonych ścieżek wordmarku", () => {
    // Znak jest zamrożony (sekcja 02). Podłoga liczności najpierw: gdyby
    // parser przestał cokolwiek wyciągać, porównania byłyby zielone na pustych
    // tablicach.
    const logoPaths = paths(logo);
    expect(logoPaths).toHaveLength(6);

    for (const d of logoPaths) {
      expect(artifact, `ścieżka znaku spoza artefaktu: ${d.slice(0, 40)}…`).toContain(d);
    }
  });

  it("sygnet jest wyłącznie wyśrodkowaną kropką na ciemnym polu", () => {
    expect(symbol).toContain('viewBox="0 0 96 96"');
    expect(symbol).toContain(
      '<rect width="96" height="96" rx="25" fill="#0B1017"></rect>',
    );
    expect(symbol).toContain(
      '<circle data-brand-dot="true" cx="48" cy="48" r="25" fill="#A8C743"></circle>',
    );
    expect(paths(symbol)).toEqual([]);
    expect(symbol).not.toContain("translate(");
  });

  it("znak nie schodzi poniżej podłóg rozmiaru z sekcji 02", () => {
    /*
      Reguły znaku: pełne logo co najmniej 120 px szerokości, sygnet co
      najmniej 24 px. Podłogi trafiły do kontraktu po recenzji PR #89, gdzie
      decyzja „zmniejsz znak o 1/3" wyszłaby na 88 px i 18,67 px — czyli pod
      obiema. Rozmiar żyje w klasach shella, więc sprawdzamy JE, a nie sam
      komponent (ten jest bezrozmiarowy z założenia).
    */
    const declared = artifact.match(/data-min-width="(\d+)"/);
    expect(declared, "artefakt przestał deklarować podłogę logo").not.toBeNull();
    const logoFloor = Number(declared![1]);
    expect(logoFloor).toBe(120);

    const panelLayout = readFileSync(
      resolve(process.cwd(), "app/[locale]/(panel)/layout.tsx"),
      "utf8",
    );
    const logoWidth = Number(panelLayout.match(/<BrandLogo className="h-auto w-\[(\d+)px\]"/)?.[1]);
    expect(logoWidth, "nie znaleziono jawnej szerokości logo w shellu").not.toBeNaN();
    expect(logoWidth).toBeGreaterThanOrEqual(logoFloor);

    // P7 (ADR-060): mobilna belka panelu zawiera wyłącznie hamburger, H1
    // i motyw. Sygnet pozostaje w superadminie, gdzie nadal obowiązuje
    // podłoga `size-6` = 24 px.
    const panelTopbar = readFileSync(
      resolve(process.cwd(), "components/shell/panel-topbar.tsx"),
      "utf8",
    );
    expect(panelTopbar).not.toContain("BrandSymbol");

    const superadminLayout = readFileSync(
      resolve(process.cwd(), "app/[locale]/(superadmin)/layout.tsx"),
      "utf8",
    );
    const symbolStep = Number(
      superadminLayout.match(/<BrandSymbol className="size-(\d+)/)?.[1],
    );
    expect(symbolStep, "nie znaleziono rozmiaru sygnetu: belka superadmina").not.toBeNaN();
    expect(symbolStep * 4, "sygnet poniżej 24 px: belka superadmina").toBeGreaterThanOrEqual(24);
  });

  it("kropka marki niesie kolor handoffu i żyje WYŁĄCZNIE wewnątrz znaku", () => {
    // Twarda reguła sekcji 02: #A8C743 nigdy jako element interfejsu.
    expect(logo).toContain('fill="#A8C743"');
    expect(symbol).toContain('fill="#A8C743"');

    const shellSources = readdirSync(resolve(process.cwd(), "components/shell"))
      .filter((name) => name.endsWith(".tsx") && name !== "brand-mark.tsx")
      .map((name) => readFileSync(resolve(process.cwd(), "components/shell", name), "utf8"));

    expect(shellSources.length).toBeGreaterThanOrEqual(5);
    for (const source of shellSources) {
      expect(source).not.toContain("A8C743");
    }
  });
});

describe("kontrakt shella — skok do treści", () => {
  it("link prowadzi do identyfikatora, który nosi <main> shella", () => {
    const html = render(<SkipLink label={messages.nav.skipToContent} />);
    const layout = readFileSync(
      resolve(process.cwd(), "app/[locale]/(panel)/layout.tsx"),
      "utf8",
    );

    expect(html).toContain(`href="#${MAIN_CONTENT_ID}"`);
    expect(html).toContain(messages.nav.skipToContent);
    // Cel musi istnieć — link do nieistniejącej kotwicy nic nie robi i nie
    // ma jak tego zauważyć poza przeglądarką.
    expect(layout).toContain("MAIN_CONTENT_ID");
    expect(layout).toContain("<main id={MAIN_CONTENT_ID}");
    // …i musi stać PRZED nawigacją, inaczej nie jest pierwszym Tabem.
    // Pozycje wyszukujemy PO SPRAWDZENIU, że oba znaczniki istnieją: `indexOf`
    // oddaje -1 dla nieznalezionego, więc porównanie „-1 < cokolwiek" byłoby
    // zielone także wtedy, gdy skok do treści zniknąłby z layoutu.
    const skipAt = layout.indexOf("<SkipLink ");
    // `<SidebarNav` bez wymuszonego odstępu — od ADR-231 element ma propsy
    // w wielu liniach (`expanded`), więc po nazwie stoi nowa linia, nie spacja.
    const navAt = layout.indexOf("<SidebarNav");
    expect(skipAt).toBeGreaterThan(-1);
    expect(navAt).toBeGreaterThan(-1);
    expect(skipAt).toBeLessThan(navAt);
  });

  it("link jest ukryty wzrokowo, ale NIE przed czytnikiem ani tabulacją", () => {
    const html = render(<SkipLink label={messages.nav.skipToContent} />);

    expect(html).toContain("sr-only");
    expect(html).toContain("focus:not-sr-only");
    // `hidden`/`display:none` wyjęłoby link z kolejności tabulacji i zniweczyło
    // cały zabieg.
    expect(html).not.toMatch(/class="[^"]*\bhidden\b/);
    expect(html).not.toContain("aria-hidden");
  });
});

describe("kontrakt shella — sekcyjna belka ADR-177", () => {
  it("belka jest białą powierzchnią nad neutralnym płótnem", () => {
    const topbar = readFileSync(
      resolve(process.cwd(), "components/shell/panel-topbar.tsx"),
      "utf8",
    );

    expect(topbar).toContain("bg-card");
    expect(topbar).not.toContain("bg-background");
  });
});
