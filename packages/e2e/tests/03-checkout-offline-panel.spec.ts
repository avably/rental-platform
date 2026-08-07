import { expect, test } from "@playwright/test";

import { fillAndSubmitCheckout, loginToPanel, seedCart } from "../lib/checkout";
import { PANEL_URL } from "../lib/env";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 3: checkout torem OFFLINE (przelew) — zamówienie powstaje
 * w statusie pending/unpaid — i jest widoczne dla ownera w panelu
 * na liście zamówień ze statusem płatności „Nieopłacone".
 *
 * Jeden test = jeden przepływ wartości: potwierdzenie klienta i widok
 * najemcy dotyczą TEGO SAMEGO zamówienia (numer z ekranu potwierdzenia).
 */
test("checkout przelewem tworzy zamówienie widoczne w panelu jako Nieopłacone", async ({ page }) => {
  const seed = readSeedState();

  await seedCart(page, seed, { startOffsetDays: 7, endOffsetDays: 9 });
  await fillAndSubmitCheckout(
    page,
    seed,
    {
      fullName: "Klient Testowy Offline",
      email: `e2e-k1-klient-offline-${Date.now()}@example.com`,
      phone: "+48 600 700 800",
    },
    "transfer",
  );

  // Ekran potwierdzenia z numerem zamówienia.
  const confirmation = page.getByRole("status").filter({ hasText: "Dziękujemy za zamówienie!" });
  await expect(confirmation).toBeVisible({ timeout: 15_000 });
  const orderNumber = (await confirmation.locator("strong.tabular-nums").innerText()).trim();
  expect(orderNumber.length).toBeGreaterThan(0);

  // Panel najemcy: to samo zamówienie na liście, status płatności „Nieopłacone".
  await loginToPanel(page, PANEL_URL, seed);
  await page.goto(`${PANEL_URL}/pl/zamowienia`);

  const row = page.locator(`[data-order-row][data-order-id="${orderNumber}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByText("Klient Testowy Offline")).toBeVisible();

  const paymentCell = row.locator('[data-cell="payment-status"]');
  await expect(paymentCell.locator('[data-status-axis="payment"][data-status-value="unpaid"]')).toHaveText(
    "Nieopłacone",
  );
});
