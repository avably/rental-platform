// @vitest-environment jsdom
/**
 * NAGŁÓWEK „PRO" (F7) — sticky, badge licznika POZYCJI, wyszukiwanie w belce.
 *
 * Trzy zdania, których pilnuje ten plik:
 *
 *   1. STICKY: belka sklepu jest przyklejona (`sticky top-0 z-40`) i niesie
 *      atrybut `data-store-header-sticky` (na nim wisi reguła „linia dopiero
 *      po przewinięciu" w site.css) oraz WARTOWNIKA sondy przewinięcia tuż
 *      przed sobą. Podgląd szkicu w panelu NIE przykleja (własny pasek z-50)
 *      — tego pilnuje domyślne `sticky=false` w pakiecie (store-shell.test).
 *   2. BADGE = POZYCJE, NIE SZTUKI (spec F7 pkt 5): 2 pozycje × (3+1 szt.)
 *      pokazują „2", a nazwa dostępna odnośnika brzmi „Koszyk, 2 pozycje"
 *      (odmiana `Intl.PluralRules`). Zdjęcie badge'a = RED (dowód mutacyjny).
 *   3. SEARCH: formularz GET → `/katalog?q=` w dwóch formach (pełne pole od
 *      48 rem kontenera / ikona z panelem pod belką), na kasie WYŁĄCZNIE
 *      ikona; enhancement (autofocus po otwarciu, Escape zamyka) jest
 *      dodatkiem do działającego HTML-a, nie warunkiem.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StoreHeader } from "../components/storefront/store-header";
import { StoreHeaderSearch } from "../components/storefront/store-header-search";
import type { CartState } from "../lib/cart/model";
import { getStorefrontCopy } from "../lib/storefront/copy";

afterEach(() => {
  cleanup();
  stanKoszyka.cart = PUSTY;
  stanKoszyka.hydrated = true;
});

/* ============================ ATRAPA KOSZYKA ============================ */

const PUSTY: CartState = { items: [], startDate: null, endDate: null };

/** DWIE pozycje, CZTERY sztuki — rozjazd, na którym stoi dowód „pozycje, nie sztuki". */
const DWIE_POZYCJE: CartState = {
  items: [
    { productId: "11111111-1111-4111-8111-111111111111", quantity: 3 },
    { productId: "22222222-2222-4222-8222-222222222222", quantity: 1 },
  ],
  startDate: null,
  endDate: null,
};

const stanKoszyka = vi.hoisted(() => ({
  cart: { items: [], startDate: null, endDate: null } as CartState,
  hydrated: true,
}));

vi.mock("../lib/cart/use-cart", () => ({
  useCart: () => ({
    cart: stanKoszyka.cart,
    hydrated: stanKoszyka.hydrated,
    add: () => {},
    remove: () => {},
    setQty: () => {},
    setDates: () => {},
    clear: () => {},
  }),
}));

async function renderNaglowek() {
  const copy = await getStorefrontCopy("pl");
  return render(<StoreHeader copy={copy} locale="pl" storeName="Sklep Kontrolny" logo={null} />);
}

/* ================================ STICKY ================================ */

describe("F7 — nagłówek przyklejony", () => {
  it("belka sklepu niesie sticky top-0 z-40 i atrybut reguły linii", async () => {
    const { container } = await renderNaglowek();
    const header = container.querySelector("[data-store-header]");
    expect(header, "nagłówek się nie wyrenderował").not.toBeNull();
    for (const klasa of ["sticky", "top-0", "z-40"]) {
      expect(header!.className, `belka straciła ${klasa} — nagłówek przestaje być przyklejony`).toContain(
        klasa,
      );
    }
    expect(
      header!.hasAttribute("data-store-header-sticky"),
      "bez atrybutu site.css nie zdejmie linii u szczytu strony",
    ).toBe(true);
  });

  it("wartownik sondy przewinięcia stoi TUŻ PRZED belką (sąsiedztwo, nie querySelector)", async () => {
    const { container } = await renderNaglowek();
    const header = container.querySelector("[data-store-header]")!;
    const wartownik = header.previousElementSibling;
    expect(wartownik, "sonda bez wartownika — linia po przewinięciu nie ma się skąd wziąć").not.toBeNull();
    // Netto zero w układzie: piksel wysokości oddany ujemnym marginesem.
    expect(wartownik!.className).toContain("h-px");
    expect(wartownik!.className).toContain("-mb-px");
  });
});

/* ========================= BADGE LICZNIKA POZYCJI ========================= */

describe("F7 — koszyk z badge'em licznika POZYCJI", () => {
  it("2 pozycje × 4 sztuki → badge „2” (pozycje, NIE sztuki) + tabular-nums", async () => {
    stanKoszyka.cart = DWIE_POZYCJE;
    const { container } = await renderNaglowek();
    const badge = container.querySelector(".site-badge");
    expect(badge, "badge licznika zniknął z nagłówka").not.toBeNull();
    expect(badge!.textContent, "badge liczy sztuki zamiast pozycji").toBe("2");
    expect(badge!.className, "cyfry bez stałej szerokości — badge faluje przy 9→10").toContain(
      "tabular-nums",
    );
    // Wizualne powtórzenie licznika z nazwy dostępnej — bez podwójnego odczytu.
    expect(badge!.getAttribute("aria-hidden")).toBe("true");
  });

  it("nazwa dostępna odnośnika: „Koszyk, 2 pozycje” (odmiana z Intl.PluralRules)", async () => {
    stanKoszyka.cart = DWIE_POZYCJE;
    const { container } = await renderNaglowek();
    const cart = container.querySelector('a[href="/cart"]');
    expect(cart!.getAttribute("aria-label")).toBe("Koszyk, 2 pozycje");
  });

  it("odmiana `many`: 5 pozycji → „Koszyk, 5 pozycji”", async () => {
    stanKoszyka.cart = {
      items: Array.from({ length: 5 }, (_, i) => ({
        productId: `33333333-3333-4333-8333-33333333333${i}`,
        quantity: 1,
      })),
      startDate: null,
      endDate: null,
    };
    const { container } = await renderNaglowek();
    expect(container.querySelector('a[href="/cart"]')!.getAttribute("aria-label")).toBe(
      "Koszyk, 5 pozycji",
    );
  });

  it("pusty koszyk: bez badge'a i bez nazwy z licznikiem (jak przed hydratacją)", async () => {
    const { container } = await renderNaglowek();
    expect(container.querySelector(".site-badge")).toBeNull();
    expect(container.querySelector('a[href="/cart"]')!.hasAttribute("aria-label")).toBe(false);
  });

  it("przed hydratacją badge nie staje nawet przy pełnym koszyku (zgoda SSR↔klient)", async () => {
    stanKoszyka.cart = DWIE_POZYCJE;
    stanKoszyka.hydrated = false;
    const { container } = await renderNaglowek();
    expect(container.querySelector(".site-badge")).toBeNull();
  });
});

/* ============================== WYSZUKIWANIE ============================== */

const LABELS = { label: "Szukaj w katalogu", placeholder: "Szukaj sprzętu…", submit: "Szukaj" };

describe("F7 — wyszukiwanie w belce", () => {
  it("wariant PEŁNY: formularz GET → /katalog z polem `q`, widoczny od 48 rem kontenera", () => {
    const { container } = render(<StoreHeaderSearch labels={LABELS} variant="full" />);
    const form = container.querySelector("form[data-store-header-search-inline]");
    expect(form, "pełne pole zniknęło z belki — mandat „search widoczny” pada").not.toBeNull();
    expect(form!.getAttribute("action")).toBe("/katalog");
    expect(form!.getAttribute("method")).toBe("get");
    const input = form!.querySelector("input[type=search]")!;
    expect(input.getAttribute("name")).toBe("q");
    // 44 px celu dotykowego i rozjazd form przez KONTENER, nie viewport.
    expect(input.className).toContain("h-11");
    expect(form!.className).toContain("hidden");
    expect(form!.className).toContain("@min-[48rem]/site:flex");
    // Ikona jest drugą formą TEGO SAMEGO wyszukiwania — ukrytą od 48 rem.
    const toggle = container.querySelector("details[data-store-header-search-toggle]")!;
    expect(toggle.className).toContain("@min-[48rem]/site:hidden");
  });

  it("wariant IKONA (kasa): pełnego pola NIE MA, ikona stoi na każdej szerokości", () => {
    const { container } = render(<StoreHeaderSearch labels={LABELS} variant="icon" />);
    expect(container.querySelector("[data-store-header-search-inline]")).toBeNull();
    const toggle = container.querySelector("details[data-store-header-search-toggle]")!;
    expect(toggle.getAttribute("class") ?? "").not.toContain("@min-[48rem]/site:hidden");
    // Wyzwalacz: 44×44 px z etykietą dostępną (lupa sama nic nie mówi).
    const summary = toggle.querySelector("summary")!;
    expect(summary.getAttribute("aria-label")).toBe("Szukaj w katalogu");
    expect(summary.className).toContain("h-11");
    expect(summary.className).toContain("w-11");
  });

  it("panel pod belką: własny formularz GET → /katalog, pole pełnej szerokości", () => {
    const { container } = render(<StoreHeaderSearch labels={LABELS} variant="icon" />);
    const panel = container.querySelector("form[data-store-header-search-panel]")!;
    expect(panel.getAttribute("action")).toBe("/katalog");
    const input = panel.querySelector("input[type=search]")!;
    expect(input.getAttribute("name")).toBe("q");
    expect(input.className).toContain("w-full");
    // Panel w warstwie absolute — otwarcie nie przesuwa belki.
    expect(panel.closest("div")!.className).toContain("absolute");
  });

  it("enhancement: otwarcie ustawia fokus w polu, Escape zamyka (HTML działa i bez tego)", () => {
    const { container } = render(<StoreHeaderSearch labels={LABELS} variant="icon" />);
    const details = container.querySelector<HTMLDetailsElement>(
      "details[data-store-header-search-toggle]",
    )!;
    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: false }));
    const input = container.querySelector<HTMLInputElement>("#store-header-search-q-panel")!;
    expect(document.activeElement, "autofocus po otwarciu nie zadziałał").toBe(input);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(details.open, "Escape nie zamknął panelu wyszukiwania").toBe(false);
  });

  it("tap poza panelem zamyka; tap W panelu NIE zamyka (dwie nogi dowodu)", () => {
    const { container } = render(<StoreHeaderSearch labels={LABELS} variant="icon" />);
    const details = container.querySelector<HTMLDetailsElement>(
      "details[data-store-header-search-toggle]",
    )!;
    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: false }));
    const input = container.querySelector<HTMLInputElement>("#store-header-search-q-panel")!;
    fireEvent.pointerDown(input);
    expect(details.open, "tap w pole zamknął panel — nie da się wpisać frazy").toBe(true);
    fireEvent.pointerDown(document.body);
    expect(details.open, "tap poza panelem go nie zamknął").toBe(false);
  });
});
