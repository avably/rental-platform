import { expect, test } from "@playwright/test";

import { dateISO } from "../lib/dates";
import { storefrontUrl } from "../lib/env";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 2: rezerwacja od strony klienta — wybór terminu, sprawdzenie
 * dostępności (kolejność wymuszona przez UI: bez sprawdzenia nie ma pola
 * ilości ani aktywnego przycisku), dodanie do koszyka i przejście do kasy.
 */
test("klient wybiera termin, widzi dostępność i dodaje produkt do koszyka", async ({ page }) => {
  const seed = readSeedState();

  // Wejście jak klient: katalog → klik w kartę produktu.
  await page.goto(`${storefrontUrl(seed.slug)}/`);
  await page.getByRole("link", { name: new RegExp(seed.productName) }).click();
  await expect(page).toHaveURL(new RegExp(`/product/${seed.productId}`));

  // Termin trzydniowy w przyszłości (zakresy są INCLUSIVE: start = end to
  // najem jednodniowy).
  await page.locator("#rent-start").fill(dateISO(7));
  await page.locator("#rent-end").fill(dateISO(9));
  await page.getByRole("button", { name: "Sprawdź dostępność" }).click();

  // Oba zasiane egzemplarze wolne w tym terminie.
  await expect(page.getByRole("status")).toContainText(
    `Dostępne w tym terminie: ${seed.unitCount} z ${seed.unitCount} szt.`,
  );

  // Pole ilości pojawia się dopiero po sprawdzeniu dostępności.
  await page.locator("#rent-qty").fill("1");
  await page.getByRole("button", { name: "Dodaj do koszyka" }).click();
  await expect(page.getByText("Dodano do koszyka")).toBeVisible();

  // Koszyk: pozycja z zasianym produktem i przejście do kasy.
  await page.getByRole("link", { name: "Przejdź do koszyka" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText(seed.productName)).toBeVisible();
  await expect(page.locator(`#qty-${seed.productId}`)).toHaveValue("1");
  await expect(page.getByRole("link", { name: "Przejdź do zamówienia" })).toBeVisible();
});
