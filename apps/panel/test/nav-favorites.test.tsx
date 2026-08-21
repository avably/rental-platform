// @vitest-environment jsdom

/**
 * ULUBIONE nawigacji (ADR-232) — pasek + gwiazdki w drzewie, warstwa UI.
 *
 * DWA NIEZALEŻNE NOŚNIKI stanu ulubionych żyją z JEDNEGO `NavFavoritesProvider`:
 *  • gwiazdki w drzewie (`SidebarNav`) — `aria-pressed` odbija przypięcie,
 *    klik woła zapis CAŁEJ nowej listy (optymistycznie),
 *  • pasek chipów (`FavoritesBar`) — SCHOWANY gdy pusto, chipy w kolejności,
 *    „✕" odpina.
 *
 * KONTRAKT ODPORNOŚCI: gwiazdki renderują się WYŁĄCZNIE pod providerem — bez
 * niego (kontrakty powłoki `sidebar-nav`/`panel-shell`) `SidebarNav` nie maluje
 * ani jednej gwiazdki, więc liczba ikon tamtych suit się nie zmienia.
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

const setNavFavoritesAction = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("@/lib/actions/nav-favorites", () => ({ setNavFavoritesAction }));

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathname.current,
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { NavFavoritesProvider } = await import("@/components/shell/nav-favorites-provider");
const { FavoritesBar } = await import("@/components/shell/favorites-bar");
const { SidebarNav } = await import("@/components/shell/sidebar-nav");
const { PANEL_NAV_TREE } = await import("@/lib/shell/nav");

/** Liście drzewa = wiersze niosące gwiazdkę (top-level + dzieci gałęzi). */
const LEAF_COUNT = PANEL_NAV_TREE.reduce(
  (acc, node) => (node.kind === "item" ? acc + 1 : acc + node.branch.children.length),
  0,
);

function withProvider(initial: string[], ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <NavFavoritesProvider initialFavorites={initial}>{ui}</NavFavoritesProvider>
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  setNavFavoritesAction.mockClear();
  pathname.current = "/";
});

describe("pasek ulubionych (ADR-232)", () => {
  it("SCHOWANY gdy pusto — brak paska, nie pusty pojemnik", () => {
    const { container } = withProvider([], <FavoritesBar />);
    expect(container.querySelector("[data-favorites-bar]")).toBeNull();
  });

  it("renderuje chipy przypiętych ekranów w zapisanej KOLEJNOŚCI", () => {
    const { container } = withProvider(["catalog", "orders"], <FavoritesBar />);
    expect(container.querySelector("[data-favorites-bar]")).not.toBeNull();
    const chips = [...container.querySelectorAll("[data-favorite-chip]")].map((el) =>
      el.getAttribute("data-favorite-chip"),
    );
    expect(chips).toEqual(["catalog", "orders"]);
    // Chip niesie link do ekranu (skrót działa jak nawigacja).
    expect(container.querySelector('[data-favorite-link="orders"]')?.getAttribute("href")).toBe(
      "/zamowienia",
    );
  });

  it("odporność na usunięty ekran: nieznane id znika z paska", () => {
    const { container } = withProvider(
      ["orders", "ekran-ktorego-nie-ma", "catalog"],
      <FavoritesBar />,
    );
    const chips = [...container.querySelectorAll("[data-favorite-chip]")].map((el) =>
      el.getAttribute("data-favorite-chip"),
    );
    expect(chips).toEqual(["orders", "catalog"]);
  });

  it("odpięcie chipa (✕) — zapis CAŁEJ nowej listy bez odpiętego", async () => {
    const { container } = withProvider(["orders", "catalog"], <FavoritesBar />);
    fireEvent.click(container.querySelector('[data-favorite-remove="orders"]')!);
    await waitFor(() => expect(setNavFavoritesAction).toHaveBeenCalledWith(["catalog"]));
    // Optymistycznie zniknął z paska od razu.
    expect(container.querySelector('[data-favorite-chip="orders"]')).toBeNull();
  });
});

describe("gwiazdki w drzewie (ADR-232)", () => {
  it("BEZ providera SidebarNav nie maluje ANI JEDNEJ gwiazdki (kontrakt ikon nietknięty)", () => {
    const { container } = render(
      <NextIntlClientProvider locale="pl" messages={messages}>
        <SidebarNav isOwner />
      </NextIntlClientProvider>,
    );
    expect(container.querySelectorAll("[data-nav-favorite-toggle]")).toHaveLength(0);
  });

  it("pod providerem KAŻDY liść dostaje gwiazdkę; aria-pressed odbija przypięcie", () => {
    const { container } = withProvider(["orders"], <SidebarNav isOwner />);
    const toggles = container.querySelectorAll("[data-nav-favorite-toggle]");
    expect(toggles).toHaveLength(LEAF_COUNT);
    expect(
      container.querySelector('[data-nav-favorite-toggle="orders"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      container.querySelector('[data-nav-favorite-toggle="catalog"]')?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("ikony gwiazdek są dekoracyjne i mają jeden ciężar kreski shella", () => {
    const { container } = withProvider([], <SidebarNav isOwner />);
    const svgs = [...container.querySelectorAll("[data-nav-favorite-toggle] svg")];
    expect(svgs).toHaveLength(LEAF_COUNT);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("stroke-width")).toBe("1.75");
    }
  });

  it("klik gwiazdki PRZYPINA — dokłada id na koniec listy i utrwala", async () => {
    const { container } = withProvider(["orders"], <SidebarNav isOwner />);
    fireEvent.click(container.querySelector('[data-nav-favorite-toggle="catalog"]')!);
    await waitFor(() => expect(setNavFavoritesAction).toHaveBeenCalledWith(["orders", "catalog"]));
    expect(
      container.querySelector('[data-nav-favorite-toggle="catalog"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("klik przypiętej gwiazdki ODPINA — utrwala listę bez tego id", async () => {
    const { container } = withProvider(["orders"], <SidebarNav isOwner />);
    fireEvent.click(container.querySelector('[data-nav-favorite-toggle="orders"]')!);
    await waitFor(() => expect(setNavFavoritesAction).toHaveBeenCalledWith([]));
    expect(
      container.querySelector('[data-nav-favorite-toggle="orders"]')?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("odmowa zapisu COFA optymistyczną zmianę (gwiazdka wraca)", async () => {
    setNavFavoritesAction.mockResolvedValueOnce({ ok: false });
    const { container } = withProvider(["orders"], <SidebarNav isOwner />);
    fireEvent.click(container.querySelector('[data-nav-favorite-toggle="catalog"]')!);
    await waitFor(() => expect(setNavFavoritesAction).toHaveBeenCalledWith(["orders", "catalog"]));
    // Zapis odmówił → stan wraca: catalog znów odpięty.
    await waitFor(() =>
      expect(
        container
          .querySelector('[data-nav-favorite-toggle="catalog"]')
          ?.getAttribute("aria-pressed"),
      ).toBe("false"),
    );
  });
});
