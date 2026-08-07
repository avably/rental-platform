import { expect, test } from "@playwright/test";

import { storefrontUrl } from "../lib/env";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 1 ścieżki krytycznej: sklep tenanta w ogóle istnieje i pokazuje
 * zasiany katalog. Wejście przez `/` (rewrite proxy → /store), host w formie
 * `{slug}.localhost` — dokładnie tak, jak wchodzi klient końcowy.
 */
test("sklep tenanta renderuje zasiany produkt w katalogu", async ({ page }) => {
  const seed = readSeedState();

  await page.goto(`${storefrontUrl(seed.slug)}/`);

  // Karta produktu z sekcji `products` opublikowanej strony sklepu.
  await expect(
    page.getByRole("heading", { name: seed.productName }),
  ).toBeVisible();

  // Cena dobowa z cennika, w formacie karty katalogu („od 50,00 zł / doba");
  // separator dziesiętny i spacja przed walutą idą z formatera pl-PL,
  // stąd \s (łapie też niełamliwą spację).
  await expect(page.getByText(/od\s+50,00\s*zł\s*\/\s*doba/).first()).toBeVisible();
});
