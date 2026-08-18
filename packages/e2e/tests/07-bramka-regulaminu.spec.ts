import { expect, test } from "@playwright/test";

import { fillAndSubmitCheckout, seedCart } from "../lib/checkout";
import { adminClient } from "../lib/db";
import { storefrontUrl } from "../lib/env";
import { seedTenant } from "../lib/seed";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 7: BRAMKA DOKUMENTÓW PRAWNYCH (H-COMP-01, ADR-191).
 *
 * Dwa zdania właściciela z audytu, każde swoim testem:
 *   1. sklep bez opublikowanego regulaminu i polityki prywatności NIE pozwala
 *      złożyć zamówienia — i mówi wprost dlaczego, zamiast pokazywać martwy
 *      checkbox do dokumentu, którego nie ma;
 *   2. sklep z dokumentami pozwala, a zamówienie utrwala IDENTYFIKATOR
 *      żywej wersji regulaminu (orders.terms_version_id) — dowód zgody
 *      rozwijalny do bajtów, nie napis.
 */

test("sklep bez opublikowanych dokumentów nie pozwala złożyć zamówienia", async ({ page }) => {
  // Własny tenant BEZ dokumentów — główny seed suity ma komplet, a bramka
  // wymaga stanu, którego tam nie ma. Unikalny slug per przebieg jak w seedzie.
  const bare = await seedTenant({ withLegalDocuments: false });

  await seedCart(page, bare, { startOffsetDays: 7, endOffsetDays: 9 });
  await page.goto(`${storefrontUrl(bare.slug)}/checkout`);

  // Zamiast checkboxa zgody stoi blokujący komunikat…
  await expect(page.locator("[data-checkout-terms-missing]")).toBeVisible();
  await expect(page.locator("#co-terms")).toHaveCount(0);

  // …a przycisk złożenia zamówienia jest niedostępny.
  await expect(page.getByRole("button", { name: "Złóż zamówienie" })).toBeDisabled();

  // Zero zamówień u tego najemcy — także po próbie obejścia UI (bramkę
  // serwera i bazy dowodzą suity storefrontu i packages/db; tu pilnujemy
  // skutku w produkcie).
  const { count } = await adminClient()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", bare.tenantId);
  expect(count).toBe(0);
});

test("sklep z dokumentami: etykieta linkuje permalink wersji, zamówienie utrwala jej id", async ({
  page,
}) => {
  const seed = readSeedState();

  await seedCart(page, seed, { startOffsetDays: 12, endOffsetDays: 13 });
  await page.goto(`${storefrontUrl(seed.slug)}/checkout`);

  // Etykieta zgody linkuje PERMALINK KONKRETNEJ WERSJI (/regulamin/w/1),
  // nie żywy adres — i ten permalink naprawdę oddaje dokument.
  const termsLink = page.locator("[data-checkout-terms-link]");
  await expect(termsLink).toHaveAttribute("href", "/regulamin/w/1");
  const permalink = await page.request.get(`${storefrontUrl(seed.slug)}/regulamin/w/1`);
  expect(permalink.status()).toBe(200);

  await fillAndSubmitCheckout(
    page,
    seed,
    {
      fullName: "Klient Testowy Regulamin",
      email: `e2e-k1-klient-regulamin-${Date.now()}@example.com`,
    },
    "transfer",
  );

  const confirmation = page.getByRole("status").filter({ hasText: "Dziękujemy za zamówienie!" });
  await expect(confirmation).toBeVisible({ timeout: 15_000 });
  const orderNumber = (await confirmation.locator("strong.tabular-nums").innerText()).trim();
  expect(orderNumber.length).toBeGreaterThan(0);

  // Zamówienie wskazuje DOKŁADNIE ten wiersz wersji, który zasiał setup —
  // etykieta tekstowa zostaje obok (czytelna dla człowieka i umowy PDF).
  const { data: order, error } = await adminClient()
    .from("orders")
    .select("terms_version, terms_version_id, terms_accepted_at")
    .eq("tenant_id", seed.tenantId)
    .eq("order_number", orderNumber)
    .single();
  expect(error).toBeNull();
  expect(order?.terms_version).toBe("v1");
  expect(order?.terms_version_id).toBe(seed.termsVersionId);
  expect(order?.terms_accepted_at).not.toBeNull();
});
