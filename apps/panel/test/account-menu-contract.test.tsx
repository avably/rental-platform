// @vitest-environment jsdom

/**
 * MENU KONTA W GÓRNYM PASKU (U11a, ADR-144).
 *
 * Audyt UX 2026-08-08 (W6): belka trzymała po prawej adres e-mail jako MARTWY
 * TEKST, przełącznik języka, przełącznik motywu i „Wyloguj" jako wyróżniony
 * przycisk — czyli akcję wykonywaną raz dziennie obok przełącznika używanego
 * raz w życiu konta. Wszystkie cztery schodzą do jednego menu.
 *
 * Kontrakt pilnuje DWÓCH rzeczy naraz, bo tylko razem coś znaczą:
 *
 *  1. Pozycje SĄ w menu (kontrola pozytywna po otwarciu) — inaczej asercja
 *     „nie ma ich na belce" byłaby zielona również dla ekranu, z którego
 *     zniknęły całkiem.
 *  2. Każda jest DOKŁADNIE JEDNA w całym drzewie shella, także przy otwartej
 *     szufladzie mobilnej. Druga kopia w szufladzie dawała na telefonie dwa
 *     wylogowania i dwa przełączniki języka.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/zamowienia",
  useRouter: () => ({ refresh: () => {} }),
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSearchParams: () => new URLSearchParams(),
}));
// Wylogowanie idzie server action — w teście wystarczy adres, żeby dało się
// sprawdzić, że to POST formularza, a nie link GET.
vi.mock("@/lib/actions/logout", () => ({ logoutAction: "/logout" }));

const { PanelTopbar } = await import("@/components/shell/panel-topbar");

function renderTopbar() {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <PanelTopbar userEmail="operator@wypozyczalnia.test" />
    </NextIntlClientProvider>,
  );
}

/**
 * Otwieranie idzie przez zapytanie DOM, nie przez rolę: nakładki Radiksa
 * ustawiają `aria-hidden` na reszcie dokumentu, więc przy otwartej szufladzie
 * zapytanie po roli nie znalazłoby wyzwalacza w belce — i test mierzyłby
 * mechanikę nakładki zamiast tego, o co pyta.
 */
function openAccountMenu(container: HTMLElement): void {
  fireEvent.pointerDown(container.querySelector("[data-account-menu-trigger]")!, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

function openMobileDrawer(container: HTMLElement): void {
  fireEvent.click(container.querySelector(`[aria-label="${messages.nav.openNavigation}"]`)!);
}

afterEach(cleanup);

describe("belka panelu oddaje miejsce menu konta", () => {
  it("zamknięta belka nie niesie ani adresu, ani przełączników, ani wylogowania", () => {
    const { container } = renderTopbar();

    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.queryByText("operator@wypozyczalnia.test")).toBeNull();
    expect(container.querySelector("[data-locale-switcher]")).toBeNull();
    expect(container.querySelector("[data-theme-toggle]")).toBeNull();
    expect(screen.queryByRole("button", { name: messages.common.logout })).toBeNull();
  });

  it("menu otwiera się z belki i niesie komplet spraw konta", () => {
    const { container } = renderTopbar();
    openAccountMenu(container);

    // Adres e-mail jest NAGŁÓWKIEM menu, nie pozycją — tożsamość konta,
    // a nie rzecz, w którą się klika.
    const email = screen.getByText("operator@wypozyczalnia.test");
    expect(email.closest("[role='menuitem']"), "adres jako klikalna pozycja").toBeNull();

    expect(document.querySelector("[data-locale-switcher]")).not.toBeNull();
    expect(document.querySelector("[data-theme-toggle]")).not.toBeNull();

    const security = screen.getByRole("menuitem", { name: messages.nav.security });
    expect(security.getAttribute("href")).toBe("/bezpieczenstwo");

    // Wylogowanie ZMIENIA STAN — musi być submitem formularza, nigdy linkiem
    // GET, który router mógłby prefetchować.
    const logout = screen.getByRole("menuitem", { name: messages.common.logout });
    expect(logout.tagName).toBe("BUTTON");
    expect(logout.getAttribute("type")).toBe("submit");
    expect(logout.closest("form")?.getAttribute("action")).toBe("/logout");
  });

  it("każda pozycja konta istnieje w shellu DOKŁADNIE RAZ — także przy otwartej szufladzie", () => {
    const { container } = renderTopbar();
    // Szuflada nawigacji mobilnej OTWARTA obok otwartego menu konta — dopiero
    // wtedy widać, czy któraś pozycja stoi w obu miejscach naraz.
    openMobileDrawer(container);
    openAccountMenu(container);

    // Kontrola pozytywna: obie nakładki naprawdę są w drzewie, więc liczenie
    // nie odbywa się po pustym zbiorze.
    expect(document.querySelector("[data-account-menu]"), "menu konta nie otwarte").not.toBeNull();
    expect(document.querySelector("[data-mobile-bottom-nav]")).not.toBeNull();

    expect(document.querySelectorAll("[data-locale-switcher]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-theme-toggle]")).toHaveLength(1);
    const logouts = [...document.querySelectorAll('button[type="submit"]')].filter(
      (button) => button.textContent === messages.common.logout,
    );
    expect(logouts, "druga kopia „Wyloguj\" w shellu").toHaveLength(1);
    expect(screen.getAllByText("operator@wypozyczalnia.test")).toHaveLength(1);
  });
});
