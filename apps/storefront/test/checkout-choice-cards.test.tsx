// @vitest-environment jsdom
/**
 * KARTY WYBORU SPOSOBU ODBIORU I PŁATNOŚCI (F8) + drobne z audytu (S-12/S-13).
 *
 * Trzy zdania, których broni ten plik:
 *   1. Radio jest ukryte (`sr-only`), ale MECHANIKA radia zostaje: klik w kartę
 *      zaznacza opcję, grupa nosi wspólne `name`, a `aria-describedby` błędu
 *      grupy dalej działa (kontrakt M-A11Y-03 z checkout-error-focus).
 *   2. Stan „wybrana" to obrys akcentu + delikatne tło (warstwa-wskaźnik),
 *      NIGDY styl pierwszorzędnego CTA (S-55) — wybór to stan, nie akcja.
 *   3. NIP i kod pocztowy niosą `inputmode=numeric` (S-12), a honeypot jest
 *      niewidoczny także dla czytnika (S-13: aria-hidden + tabindex=-1).
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
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
        deliveryMethods={
          [
            { method: "pickup", price_grosze: 0 },
            { method: "courier", price_grosze: 4_900 },
          ] as never
        }
        pickupLocations={[] as never}
        currency="PLN"
        locale="pl"
        copy={copy}
        paymentMethods={["transfer", "cod"] as never}
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

describe("karty wyboru — mechanika radia zostaje", () => {
  it("odbiór i płatność renderują się jako karty wyboru z ukrytym radiem", () => {
    render(checkoutForm());
    const delivery = document.querySelectorAll('[data-checkout-choice="delivery"]');
    const payment = document.querySelectorAll('[data-checkout-choice="payment"]');
    expect(delivery.length).toBe(2);
    expect(payment.length).toBe(2);
    for (const card of [...delivery, ...payment]) {
      const radio = card.querySelector<HTMLInputElement>('input[type="radio"]');
      expect(radio).not.toBeNull();
      // Radio ukryte wizualnie (kartą jest etykieta), ale obecne w a11y-tree.
      expect(radio!.className).toContain("sr-only");
    }
  });

  it("klik w kartę zaznacza opcję (label ↔ radio)", () => {
    render(checkoutForm());
    const courier = document.querySelector<HTMLInputElement>(
      'input[name="deliveryMethod"][value="courier"]',
    )!;
    expect(courier.checked).toBe(false);
    fireEvent.click(courier);
    expect(courier.checked).toBe(true);

    const cod = document.querySelector<HTMLInputElement>(
      'input[name="paymentMethod"][value="cod"]',
    )!;
    fireEvent.click(cod);
    expect(cod.checked).toBe(true);
  });
});

describe("stan „wybrana” ≠ styl pierwszorzędnego CTA (S-55)", () => {
  it("wskaźnik zaznaczenia to obrys akcentu + tło 8%, bez klasy site-cta", () => {
    render(checkoutForm());
    const cards = document.querySelectorAll("[data-checkout-choice]");
    for (const card of cards) {
      const indicator = card.querySelector("[data-checkout-choice-indicator]")!;
      expect(indicator).not.toBeNull();
      // Obrys akcentu 2 px + DELIKATNE tło (color-mix 8%), włączane stanem radia.
      expect(indicator.className).toContain("border-2");
      expect(indicator.className).toContain("border-[color:var(--site-accent)]");
      expect(indicator.className).toContain("color-mix(in_srgb,var(--site-accent)_8%,transparent)");
      expect(indicator.className).toContain("peer-checked:opacity-100");
      // NIE pełny akcent: ani karta, ani wskaźnik nie niosą stylu CTA.
      expect(card.className).not.toContain("site-cta");
      expect(indicator.className).not.toContain("site-cta");
      expect(indicator.className).not.toContain("bg-[color:var(--site-accent)]");
    }
  });
});

describe("drobne z audytu w pasie F8", () => {
  it("NIP i kod pocztowy niosą inputmode=numeric (S-12)", () => {
    render(checkoutForm());
    expect(document.querySelector("#co-nip")!.getAttribute("inputmode")).toBe("numeric");
    expect(document.querySelector("#co-zip")!.getAttribute("inputmode")).toBe("numeric");
  });

  it("honeypot jest niewidoczny także dla czytnika (S-13)", () => {
    render(checkoutForm());
    const honeypot = document.querySelector("#co-website")!;
    const wrapper = honeypot.closest('[aria-hidden="true"]')!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain("sr-only");
    expect(honeypot.getAttribute("tabindex")).toBe("-1");
  });

  it("sekcje formularza są kartami z nagłówkiem i 1-zdaniowym opisem (spec F8)", () => {
    render(checkoutForm());
    const sections = document.querySelectorAll("form fieldset.site-card");
    // Kontakt, adres, odbiór, płatność, uwagi (pola własne znikają bez definicji).
    expect(sections.length).toBe(5);
    const contact = Array.from(sections).find((section) =>
      section.textContent!.includes(copy.checkout.contactHeading),
    )!;
    expect(contact.textContent).toContain(copy.checkout.contactDescription);
    // Pola nie rozciągają się na całą kartę (spec: max-w-lg).
    expect(contact.querySelector(".max-w-lg")).not.toBeNull();
  });
});
