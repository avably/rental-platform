// @vitest-environment jsdom
/**
 * GEOMETRIA KARTY PODSUMOWANIA (F8, naprawa S-15) — wartość WEWNĄTRZ paddingu.
 *
 * Zmierzona wada: karta podsumowania była `display: grid` BEZ szablonu kolumn,
 * a niejawny tor `auto` przyjmuje szerokość NAJWIĘKSZEGO dziecka — iframe
 * antybotowy (sztywne 300 px) rozdymał tor ponad pudełko treści (278 px),
 * każdy wiersz rozciągał się do toru i kwota lądowała 1 px ZA ramką karty
 * (`gridTemplateColumns: 300px`; przy kwotach 4-cyfrowych ucinało „zł").
 *
 * jsdom nie liczy layoutu, więc ten plik pilnuje MARKUPU naprawy — klas,
 * które rozstrzygają o torach siatki. Dowód behawioralny (piksele) jest w
 * raporcie F8 (sonda CDP przed/po). CO MUSIAŁOBY SIĘ ZEPSUĆ: przywrócenie
 * `grid` bez szablonu kolumn na karcie/kolumnach albo wiersza kwoty jako
 * `flex justify-between` robi te asercje czerwone — dokładnie stary markup.
 */
import { formatMoney } from "@avably/core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitCheckout = vi.fn();
vi.mock("@/lib/actions/checkout", () => ({
  submitCheckout: (...args: unknown[]) => submitCheckout(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const { StoreTermProvider } = await import("@/components/storefront/store-term");
const { CheckoutForm } = await import("@/components/storefront/checkout-form");
const { writeCart } = await import("@/lib/cart/storage");
const { getStorefrontCopy } = await import("@/lib/storefront/copy");

const copy = await getStorefrontCopy("pl");

const ROWER = "11111111-1111-4111-8111-111111111111";

/**
 * FIXTURE 4-CYFROWY (mandat właściciela): 500 zł/doba × 3 doby = 1500 zł
 * najmu, 1200 zł kaucji — dokładnie klasa kwot, przy której stary markup
 * ucinał „zł".
 */
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

function checkoutForm() {
  return (
    <StoreTermProvider>
      <CheckoutForm
        products={PRODUCTS as never}
        deliveryMethods={[{ method: "pickup", price_grosze: 0 }] as never}
        pickupLocations={[] as never}
        currency="PLN"
        locale="pl"
        copy={copy}
        paymentMethods={["transfer"] as never}
        customFields={[]}
        terms={{ href: "/regulamin/w/1", versionLabel: "v1" }}
      />
    </StoreTermProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  writeCart({
    items: [{ productId: ROWER, quantity: 1 }],
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  } as never);
  submitCheckout.mockReset();
});

afterEach(cleanup);

describe("tory siatek nie dziedziczą szerokości po dziecku (root cause S-15)", () => {
  it("formularz ma jawny szablon kolumn minmax(0,1fr) — nie tor auto", () => {
    render(checkoutForm());
    const form = document.querySelector("form")!;
    expect(form.className).toContain("grid-cols-1");
    expect(form.className).toContain("lg:grid-cols-[minmax(0,1fr)_22rem]");
  });

  it("karta podsumowania ma jawny szablon kolumn (grid-cols-1)", () => {
    render(checkoutForm());
    const aside = document.querySelector("[data-checkout-summary]")!;
    expect(aside.className).toContain("grid-cols-1");
  });

  it("kolumna sekcji ma jawny szablon kolumn (grid-cols-1)", () => {
    render(checkoutForm());
    const column = document.querySelector("form > div")!;
    expect(column.className).toContain("grid-cols-1");
  });
});

describe("wiersz kwoty jako grid [etykieta][wartość] (spec F8)", () => {
  it("każdy wiersz podsumowania to grid 1fr/auto, wartość z tabular-nums", () => {
    render(checkoutForm());
    const aside = document.querySelector("[data-checkout-summary]")!;
    const rows = aside.querySelectorAll("[data-summary-row]");
    // 3 wiersze + „Razem do zapłaty".
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.className).toContain("grid-cols-[minmax(0,1fr)_auto]");
      // Stary markup: `flex justify-between` — jego powrót = czerwień.
      expect(row.className).not.toContain("justify-between");
    }
    for (const value of aside.querySelectorAll("[data-summary-value], [data-summary-total]")) {
      expect(value.className).toContain("site-numeric");
      expect(value.className).toContain("whitespace-nowrap");
    }
  });

  it("kwoty 4-cyfrowe renderują się w wierszach wartości w całości (z „zł”)", () => {
    render(checkoutForm());
    const aside = document.querySelector("[data-checkout-summary]")!;
    const rental = formatMoney(150_000, "PLN", "pl");
    const total = formatMoney(270_000, "PLN", "pl");
    const values = Array.from(
      aside.querySelectorAll("[data-summary-value], [data-summary-total]"),
    ).map((node) => node.textContent);
    expect(values).toContain(rental);
    const totalNode = aside.querySelector("[data-summary-total]")!;
    expect(totalNode.textContent).toBe(total);
    // Hierarchia „Razem do zapłaty": 20 px / waga 600 (spec F8).
    expect(totalNode.className).toContain("text-xl");
    expect(totalNode.className).toContain("font-semibold");
  });

  it("klauzule (kaucja, kwota szacunkowa) stoją POD sumą jako 13 px muted", () => {
    render(checkoutForm());
    const aside = document.querySelector("[data-checkout-summary]")!;
    const rowsList = aside.querySelector("[data-checkout-summary-rows]")!;
    const deposit = Array.from(aside.querySelectorAll("p")).find(
      (p) => p.textContent === copy.checkout.depositNote,
    )!;
    expect(deposit).toBeTruthy();
    expect(deposit.className).toContain("text-[13px]");
    expect(deposit.className).toContain("site-text-muted");
    // POD sumą — w kolejności dokumentu za listą wierszy.
    expect(rowsList.compareDocumentPosition(deposit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("pasek podsumowania (mobile) i sticky (desktop)", () => {
  it("zwijany pasek <details> niesie etykietę i kwotę RAZEM, znika na lg", () => {
    render(checkoutForm());
    const bar = document.querySelector<HTMLDetailsElement>("[data-checkout-summary-bar]")!;
    expect(bar).not.toBeNull();
    expect(bar.tagName).toBe("DETAILS");
    expect(bar.className).toContain("lg:hidden");
    const total = bar.querySelector("[data-checkout-summary-bar-total]")!;
    expect(total.textContent).toBe(formatMoney(270_000, "PLN", "pl"));
  });

  it("karta podsumowania jest sticky na desktopie (top-24 ze spec F8)", () => {
    render(checkoutForm());
    const aside = document.querySelector("[data-checkout-summary]")!;
    expect(aside.className).toContain("lg:sticky");
    expect(aside.className).toContain("lg:top-24");
  });

  it("przycisk „Złóż zamówienie” ma pełną szerokość karty podsumowania", () => {
    render(checkoutForm());
    const submit = document.querySelector<HTMLButtonElement>(
      "[data-checkout-summary] button[type=submit]",
    )!;
    expect(submit).not.toBeNull();
    expect(submit.className).toContain("w-full");
  });
});
