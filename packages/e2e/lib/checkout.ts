import type { Page } from "@playwright/test";

import { dateISO } from "./dates";
import { storefrontUrl } from "./env";
import type { SeedState } from "./seed-state";

/**
 * Zasiewa koszyk w localStorage PRZED załadowaniem strony — dokładnie ten
 * kształt i klucz, którego używa storefront (`avably.cart.v1`). Ścieżka
 * UI budowania koszyka (produkt → daty → dostępność → dodanie) jest
 * dowiedziona w ogniwie 02; scenariusze checkoutu zaczynają od gotowego
 * koszyka, żeby nie powtarzać tej samej sekwencji w każdym teście.
 */
export async function seedCart(
  page: Page,
  seed: SeedState,
  options: { startOffsetDays: number; endOffsetDays: number; quantity?: number },
): Promise<void> {
  await page.addInitScript(
    ([key, payload]) => {
      window.localStorage.setItem(key, payload);
    },
    [
      "avably.cart.v1",
      JSON.stringify({
        items: [{ productId: seed.productId, quantity: options.quantity ?? 1 }],
        startDate: dateISO(options.startOffsetDays),
        endDate: dateISO(options.endOffsetDays),
      }),
    ] as const,
  );
}

export type CheckoutCustomer = {
  fullName: string;
  email: string;
  phone?: string;
};

/**
 * Wypełnia formularz checkoutu (dane klienta, odbiór osobisty w zasianym
 * punkcie, metoda płatności) i wysyła. Honeypot (#co-website) celowo
 * zostaje pusty — wypełnienie go to odrzucenie zamówienia.
 */
export async function fillAndSubmitCheckout(
  page: Page,
  seed: SeedState,
  customer: CheckoutCustomer,
  paymentMethod: "transfer" | "online" | "cod",
): Promise<void> {
  await page.goto(`${storefrontUrl(seed.slug)}/checkout`);

  await page.locator("#co-fullname").fill(customer.fullName);
  await page.locator("#co-email").fill(customer.email);
  if (customer.phone) await page.locator("#co-phone").fill(customer.phone);

  await page.locator('input[name="deliveryMethod"][value="pickup"]').check();
  await page.locator("#co-pickup").selectOption({ label: `${seed.pickupLocationName} - Warszawa` });

  await page.locator(`input[name="paymentMethod"][value="${paymentMethod}"]`).check();

  await page.locator("#co-terms").check();
  await page.getByRole("button", { name: "Złóż zamówienie" }).click();
}

/** Loguje ownera tenanta do panelu i zostawia stronę na pulpicie. */
export async function loginToPanel(page: Page, panelUrl: string, seed: SeedState): Promise<void> {
  await page.goto(`${panelUrl}/pl/login`);
  await page.locator('input[name="email"]').fill(seed.ownerEmail);
  await page.locator('input[name="password"]').fill(seed.ownerPassword);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 15_000 });
}
