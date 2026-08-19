// @vitest-environment jsdom
/**
 * FOKUS I OGŁOSZENIE BŁĘDÓW WALIDACJI CHECKOUTU (M-A11Y-03, audyt właściciela
 * 17.08, ADR-197).
 *
 * Trzy zdania, których broni ten plik:
 *   1. Po nieudanej walidacji fokus przenosi się do PIERWSZEGO pola z błędem
 *      W KOLEJNOŚCI DOKUMENTU — nie w kolejności kluczy mapy z serwera. Do
 *      M-A11Y-03 fokus zostawał na przycisku, a użytkownik czytnika słyszał
 *      ciszę.
 *   2. Region `role="alert"` ogłasza LICZBĘ pól do poprawienia i istnieje od
 *      montażu (region wstawiony razem z treścią bywa przemilczany przez
 *      czytniki). Gdy błąd nie ma kontrolki (koszyk), fokus ląduje na regionie.
 *   3. Pole z błędem jest związane z komunikatem przez `aria-describedby`,
 *      a komunikat stoi pod polem — czytnik czyta go przy wejściu w pole.
 *
 * Wzorzec renderu i podmian: checkout-terms-gate.test.tsx (ta sama powłoka
 * jsdom, ten sam mock rdzenia submitCheckout).
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
const { getStorefrontCopy, format } = await import("@/lib/storefront/copy");

const copy = await getStorefrontCopy("pl");

const ROWER = "11111111-1111-4111-8111-111111111111";

const PRODUCTS = [
  {
    id: ROWER,
    name: "Rower górski",
    description: null,
    base_price_day_grosze: 12_000,
    deposit_grosze: 40_000,
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    custom_fields: {},
    category_ids: [],
    pricing_tiers: [],
    images: [],
  },
];

const TERMS = { href: "/regulamin/w/3", versionLabel: "v3" };

function checkoutForm() {
  return (
    <StoreTermProvider>
      <CheckoutForm
        products={PRODUCTS as never}
        deliveryMethods={[{ method: "pickup", price_grosze: 0 }] as never}
        pickupLocations={
          [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Magazyn",
              address_street: null,
              address_zip: null,
              address_city: "Warszawa",
            },
          ] as never
        }
        currency="PLN"
        locale="pl"
        copy={copy}
        paymentMethods={["transfer"] as never}
        customFields={[]}
        terms={TERMS}
      />
    </StoreTermProvider>
  );
}

/** Koszyk gotowy do wysłania — bramki koszyka nie są przedmiotem tych testów. */
function seedCart(): void {
  writeCart({
    items: [{ productId: ROWER, quantity: 1 }],
    startDate: "2026-10-01",
    endDate: "2026-10-03",
  } as never);
}

/** Submit z ominięciem `disabled` — dokładnie tą drogą, którą waliduje serwer. */
function submitForm(): void {
  fireEvent.click(document.querySelector("#co-terms")!);
  fireEvent.submit(document.querySelector("form")!);
}

beforeEach(() => {
  window.localStorage.clear();
  seedCart();
  submitCheckout.mockReset();
});

afterEach(cleanup);

describe("fokus na pierwszym polu z błędem (M-A11Y-03)", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie efektu przenoszącego fokus zostawia
  // aktywny element na przycisku submit — oba przypadki robią się czerwone.
  it("jeden błąd: fokus ląduje na tym polu", async () => {
    submitCheckout.mockResolvedValue({
      status: "validation_error",
      fields: { email: "invalid" },
    });
    render(checkoutForm());
    submitForm();

    await waitFor(() => expect(document.activeElement?.id).toBe("co-email"));
  });

  it("dwa błędy: fokus na PIERWSZYM w kolejności DOKUMENTU, nie kluczy mapy", async () => {
    // `terms` stoi w mapie PRZED `email`, ale w dokumencie checkbox zgody jest
    // OSTATNI (aside podsumowania). Fokus na checkboxie = czytanie kolejności
    // kluczy zamiast dokumentu.
    submitCheckout.mockResolvedValue({
      status: "validation_error",
      fields: { terms: "required", email: "invalid" },
    });
    render(checkoutForm());
    submitForm();

    await waitFor(() => expect(document.activeElement?.id).toBe("co-email"));
  });

  it("błąd grupy radio (deliveryMethod) jest osiągalny fokusem", async () => {
    submitCheckout.mockResolvedValue({
      status: "validation_error",
      fields: { deliveryMethod: "required" },
    });
    render(checkoutForm());
    submitForm();

    await waitFor(() => {
      const active = document.activeElement as HTMLInputElement | null;
      expect(active?.name).toBe("deliveryMethod");
      // ARIA nie wspiera `aria-invalid` na roli radio — błędną grupę oznacza
      // data-atrybut, a komunikat niesie `aria-describedby` (globalne).
      expect(active?.getAttribute("data-checkout-invalid")).toBe("true");
      expect(active?.getAttribute("aria-describedby")).toBe("co-delivery-error");
    });
  });

  it("błąd bez kontrolki (koszyk): fokus ląduje na regionie ogłoszeń", async () => {
    submitCheckout.mockResolvedValue({
      status: "validation_error",
      fields: { items: "invalid" },
    });
    render(checkoutForm());
    submitForm();

    await waitFor(() =>
      expect(document.activeElement?.hasAttribute("data-checkout-error-summary")).toBe(true),
    );
  });
});

describe("region ogłoszeń walidacji", () => {
  it("istnieje od montażu (pusty), żeby czytnik zdążył go zarejestrować", () => {
    render(checkoutForm());
    const region = document.querySelector("[data-checkout-error-summary]");
    expect(region).not.toBeNull();
    expect(region!.getAttribute("role")).toBe("alert");
    expect(region!.textContent).toBe("");
  });

  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie regionu albo liczby błędów z komunikatu.
  it("po nieudanej walidacji ogłasza LICZBĘ pól do poprawienia", async () => {
    submitCheckout.mockResolvedValue({
      status: "validation_error",
      fields: { fullName: "required", email: "invalid" },
    });
    render(checkoutForm());
    submitForm();

    await waitFor(() => {
      const region = document.querySelector("[data-checkout-error-summary]");
      expect(region!.textContent).toBe(format(copy.checkout.errors.summary, { count: 2 }));
    });
  });

  it("edycja pola zdejmuje stan walidacji — region wraca do pustego", async () => {
    submitCheckout.mockResolvedValue({
      status: "validation_error",
      fields: { email: "invalid" },
    });
    render(checkoutForm());
    submitForm();
    await waitFor(() => expect(document.activeElement?.id).toBe("co-email"));

    fireEvent.change(document.querySelector("#co-email")!, {
      target: { value: "jan@example.com" },
    });
    expect(document.querySelector("[data-checkout-error-summary]")!.textContent).toBe("");
  });
});

describe("wiązanie pola z komunikatem (aria-describedby)", () => {
  it("pole z błędem wskazuje istniejący komunikat; pole bez błędu nie wskazuje nic", async () => {
    submitCheckout.mockResolvedValue({
      status: "validation_error",
      fields: { email: "invalid" },
    });
    render(checkoutForm());
    submitForm();

    await waitFor(() => {
      const email = document.querySelector("#co-email")!;
      expect(email.getAttribute("aria-invalid")).toBe("true");
      expect(email.getAttribute("aria-describedby")).toBe("co-email-error");
    });
    const message = document.querySelector("#co-email-error")!;
    expect(message.textContent).toBe(copy.checkout.errors.email);

    // Kontrola negatywna: pole zdrowe nie każe czytnikowi czytać pustego węzła.
    expect(document.querySelector("#co-fullname")!.getAttribute("aria-describedby")).toBeNull();
  });

  it("pola opcjonalne (firma, NIP, adres) też niosą znacznik i komunikat", async () => {
    submitCheckout.mockResolvedValue({
      status: "validation_error",
      fields: { nip: "too_long" },
    });
    render(checkoutForm());
    submitForm();

    await waitFor(() => expect(document.activeElement?.id).toBe("co-nip"));
    const nip = document.querySelector("#co-nip")!;
    expect(nip.getAttribute("aria-describedby")).toBe("co-nip-error");
    expect(document.querySelector("#co-nip-error")!.textContent).toBe(
      copy.checkout.errors.generic,
    );
  });
});
