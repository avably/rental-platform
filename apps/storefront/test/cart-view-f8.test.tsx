// @vitest-environment jsdom
/**
 * KOSZYK PO PRZEBUDOWIE F8 — stepper ilości, pusty koszyk, daty po ludzku,
 * geometria podsumowania.
 *
 * Cztery zdania, których broni ten plik:
 *   1. Stepper `− n +`: minus jest nieaktywny przy 1 (zero nieosiągalne
 *      przypadkiem — usunięcie pozycji jest wyłącznie jawne), plus zatrzymuje
 *      się na SUFICIE DOSTĘPNOŚCI (wolne sztuki z odpowiedzi ADR-180).
 *   2. Pusty koszyk prowadzi wzrok do katalogu duzym `.site-cta` (S-28)
 *      i drugorzędnym powrotem na stronę główną — nie do stopki.
 *   3. Termin renderuje się PO LUDZKU (`formatRentalRange`, S-10), nie ISO.
 *   4. Karta podsumowania koszyka ma tę samą geometrię, co checkout
 *      (SummaryList: tory minmax(0,1fr), wiersze [etykieta][wartość]).
 *
 * Wzorzec renderu i podmian: store-term.test.tsx (dostępność przez mock akcji).
 */
import { formatRentalRange } from "@avably/core";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicCatalogAvailability } from "@/lib/checkout/contract";

const checkCatalogAvailability = vi.fn<
  (start: string, end: string) => Promise<PublicCatalogAvailability | null>
>();

vi.mock("@/lib/actions/availability", () => ({
  checkCatalogAvailability: (start: string, end: string) => checkCatalogAvailability(start, end),
  checkAvailability: vi.fn(),
  checkAvailabilityDays: vi.fn(),
}));

const { StoreTermProvider } = await import("@/components/storefront/store-term");
const { CartView } = await import("@/components/storefront/cart-view");
const { readCart, writeCart } = await import("@/lib/cart/storage");
const { getStorefrontCopy } = await import("@/lib/storefront/copy");

const copy = await getStorefrontCopy("pl");

const ROWER = "11111111-1111-4111-8111-111111111111";

const PRODUCTS = [
  {
    id: ROWER,
    name: "Rower górski",
    description: null,
    base_price_day_grosze: 50_000,
    deposit_grosze: 120_000,
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    custom_fields: {},
    category_ids: [],
    pricing_tiers: [],
    images: [],
  },
];

/** Dzień z bieżącego okna wyboru — dostępność pyta o realny termin. */
function dayFromToday(offset: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
}

function availability(units: number): PublicCatalogAvailability {
  return {
    products: [{ product_id: ROWER, total_units: 5, available_units: units }],
  };
}

function cartView() {
  return (
    <StoreTermProvider>
      <CartView
        products={PRODUCTS as never}
        productPaths={{}}
        supabaseUrl="https://storage.test"
        currency="PLN"
        locale="pl"
        copy={copy}
      />
    </StoreTermProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  checkCatalogAvailability.mockReset();
  checkCatalogAvailability.mockResolvedValue(availability(5));
});

afterEach(cleanup);

describe("stepper ilości (spec F8: min 1, max = dostępność, cele 44 px)", () => {
  const start = dayFromToday(7);
  const end = dayFromToday(9);

  it("pola liczbowego nie ma; jest − n + i Usuń z etykietą", () => {
    writeCart({ items: [{ productId: ROWER, quantity: 1 }], startDate: start, endDate: end });
    render(cartView());

    expect(document.querySelector('input[type="number"]')).toBeNull();
    const stepper = document.querySelector(`[data-cart-stepper="${ROWER}"]`)!;
    expect(stepper).not.toBeNull();
    expect(stepper.querySelector("[data-cart-stepper-quantity]")!.textContent).toBe("1");
    // Cele dotykowe 44 px (h-11 w-11).
    for (const button of stepper.querySelectorAll("button")) {
      expect(button.className).toContain("h-11");
      expect(button.className).toContain("w-11");
    }
    const remove = document.querySelector("[data-cart-remove]")!;
    expect(remove.textContent).toContain(copy.cart.remove);
  });

  it("minus przy 1 jest nieaktywny — zero nieosiągalne przypadkiem", () => {
    writeCart({ items: [{ productId: ROWER, quantity: 1 }], startDate: start, endDate: end });
    render(cartView());

    const decrease = document.querySelector<HTMLButtonElement>("[data-cart-stepper-decrease]")!;
    expect(decrease.disabled).toBe(true);
    fireEvent.click(decrease);
    expect(readCart().items).toEqual([{ productId: ROWER, quantity: 1 }]);
  });

  it("plus zwiększa ilość aż do sufitu dostępności, potem jest nieaktywny", async () => {
    checkCatalogAvailability.mockResolvedValue(availability(2));
    writeCart({ items: [{ productId: ROWER, quantity: 1 }], startDate: start, endDate: end });
    render(cartView());

    const increase = document.querySelector<HTMLButtonElement>("[data-cart-stepper-increase]")!;
    // Sufit z ODPOWIEDZI dostępności — czekamy, aż wróci (2 wolne sztuki).
    await waitFor(() => expect(checkCatalogAvailability).toHaveBeenCalled());
    fireEvent.click(increase);
    await waitFor(() =>
      expect(document.querySelector("[data-cart-stepper-quantity]")!.textContent).toBe("2"),
    );
    // KONTROLA: przy quantity == wolnym sztukom plus jest nieaktywny.
    await waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>("[data-cart-stepper-increase]")!.disabled,
      ).toBe(true),
    );
    expect(readCart().items).toEqual([{ productId: ROWER, quantity: 2 }]);
  });

  it("minus zmniejsza; Usuń zdejmuje pozycję jawnie", async () => {
    writeCart({ items: [{ productId: ROWER, quantity: 2 }], startDate: start, endDate: end });
    render(cartView());

    fireEvent.click(document.querySelector("[data-cart-stepper-decrease]")!);
    await waitFor(() => expect(readCart().items).toEqual([{ productId: ROWER, quantity: 1 }]));

    fireEvent.click(document.querySelector("[data-cart-remove]")!);
    await waitFor(() => expect(readCart().items).toEqual([]));
  });
});

describe("pusty koszyk (S-28)", () => {
  it("duży .site-cta do katalogu + drugorzędny powrót na stronę główną", () => {
    writeCart({ items: [], startDate: null, endDate: null });
    render(cartView());

    const empty = document.querySelector("[data-cart-empty]")!;
    expect(empty).not.toBeNull();
    const cta = empty.querySelector<HTMLAnchorElement>("a.site-cta")!;
    expect(cta).not.toBeNull();
    expect(cta.getAttribute("href")).toBe("/store");
    expect(cta.textContent).toBe(copy.cart.emptyCta);
    const secondary = empty.querySelector<HTMLAnchorElement>("a.site-link")!;
    expect(secondary.getAttribute("href")).toBe("/");
    expect(secondary.textContent).toBe(copy.cart.emptySecondaryCta);
  });
});

describe("daty po ludzku (S-10) i geometria podsumowania", () => {
  const start = dayFromToday(7);
  const end = dayFromToday(9);

  it("termin renderuje się frazą formatRentalRange, nie ISO", () => {
    writeCart({ items: [{ productId: ROWER, quantity: 1 }], startDate: start, endDate: end });
    render(cartView());

    const termNode = document.querySelector("[data-cart-term]")!;
    expect(termNode.textContent).toBe(formatRentalRange(start, end, "pl"));
    expect(termNode.textContent).not.toContain(start);
  });

  it("karta podsumowania koszyka: tory minmax(0,1fr), wiersze [etykieta][wartość], sticky", () => {
    writeCart({ items: [{ productId: ROWER, quantity: 1 }], startDate: start, endDate: end });
    render(cartView());

    const aside = document.querySelector("[data-cart-summary]")!;
    expect(aside.className).toContain("grid-cols-1");
    expect(aside.className).toContain("lg:sticky");
    const rows = aside.querySelectorAll("[data-summary-row]");
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.className).toContain("grid-cols-[minmax(0,1fr)_auto]");
    }
  });

  it("zwijany pasek podsumowania (mobile) istnieje i znika na lg", () => {
    writeCart({ items: [{ productId: ROWER, quantity: 1 }], startDate: start, endDate: end });
    render(cartView());

    const bar = document.querySelector("[data-cart-summary-bar]")!;
    expect(bar).not.toBeNull();
    expect(bar.tagName).toBe("DETAILS");
    expect(bar.className).toContain("lg:hidden");
  });
});
