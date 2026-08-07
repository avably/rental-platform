import { expect, test, type Page } from "@playwright/test";

import { fillAndSubmitCheckout, loginToPanel, seedCart } from "../lib/checkout";
import { orderById } from "../lib/db";
import { PANEL_URL } from "../lib/env";
import { readSeedState, type SeedState } from "../lib/seed-state";
import { latestStubIntent, setStubIntentStatus } from "../lib/stub";
import { intentEventBody, postWebhook, signedWebhookHeaders } from "../lib/webhook";

/**
 * Ogniwo 4 — noga płatności online na produkcyjnym buildzie, tor hermetyczny:
 * checkout online → strona płatności przypina PaymentIntent (serwer
 * storefrontu → stub API dostawcy) → podpisany webhook → werdykt WYŁĄCZNIE
 * z odczytu u dostawcy → status w panelu.
 *
 * Widżet płatności dostawcy (js.stripe.com) jest w tym torze ZABLOKOWANY —
 * potwierdzenie płatności kartą w iframe dostawcy to granica zaufania toru
 * stubowanego (patrz ADR-101); stan „klient zapłacił" symuluje endpoint
 * kontrolny stubu.
 */

/** Checkout online do momentu przypięcia intentu (strona płatności).
 * Termin przychodzi z testu: scenariusze MUSZĄ mieć rozłączne zakresy,
 * bo zamówienie w order_status `pending` blokuje egzemplarze — trzy
 * checkouty w ten sam termin przy dwóch egzemplarzach = trzeci pada
 * na dostępności. */
async function checkoutOnline(
  page: Page,
  seed: SeedState,
  email: string,
  dates: { startOffsetDays: number; endOffsetDays: number },
): Promise<void> {
  // Hermetycznie: zero wyjść do CDN dostawcy; strona płatności i tak
  // przypina intent server-side, zanim widżet w ogóle mógłby się załadować.
  await page.route("https://js.stripe.com/**", (route) => route.abort());
  await seedCart(page, seed, dates);
  await fillAndSubmitCheckout(
    page,
    seed,
    { fullName: "Klient Testowy Online", email },
    "online",
  );
  await page.waitForURL(/\/checkout\/platnosc/, { timeout: 15_000 });
}

test("płatność online: webhook ustawia Opłacone w panelu, powtórka jest duplikatem", async ({ page }) => {
  const seed = readSeedState();

  await checkoutOnline(page, seed, `e2e-k1-klient-online-${Date.now()}@example.com`, { startOffsetDays: 11, endOffsetDays: 13 });

  // Intent utworzony przez serwer storefrontu w stubie; kwota policzona
  // przez NASZ serwer (zakres INCLUSIVE 11→13 = 3 doby × 50 zł, odbiór
  // osobisty bez dopłaty).
  const intent = await latestStubIntent(page.request);
  expect(intent.orderId).not.toBeNull();
  expect(intent.amount).toBe(3 * 5_000);

  // Klient „płaci" u dostawcy.
  await setStubIntentStatus(page.request, intent.id, "succeeded");

  // Podpisany webhook → processed.
  const payload = intentEventBody(intent.id);
  const headers = signedWebhookHeaders(payload);
  const first = await postWebhook(page.request, payload, headers);
  expect(first.status()).toBe(200);
  expect((await first.json()).status).toBe("processed");

  // Ta sama dostawa drugi raz → duplikat, bez drugiego przetwarzania.
  const second = await postWebhook(page.request, payload, headers);
  expect(second.status()).toBe(200);
  expect((await second.json()).status).toBe("duplicate");

  // Panel: TO zamówienie jest „Opłacone".
  const order = await orderById(intent.orderId!);
  await loginToPanel(page, PANEL_URL, seed);
  await page.goto(`${PANEL_URL}/pl/zamowienia`);
  const row = page.locator(`[data-order-row][data-order-id="${order.orderNumber}"]`);
  await expect(row).toBeVisible();
  await expect(
    row.locator('[data-cell="payment-status"] [data-status-axis="payment"][data-status-value="paid"]'),
  ).toHaveText("Opłacone");
});

test("anty-spoofing: kłamliwe ciało succeeded nie ustawia Opłacone, gdy odczyt u dostawcy mówi inaczej", async ({ page }) => {
  const seed = readSeedState();

  await checkoutOnline(page, seed, `e2e-k1-klient-spoof-${Date.now()}@example.com`, { startOffsetDays: 15, endOffsetDays: 16 });
  const intent = await latestStubIntent(page.request);

  // U dostawcy płatność NIE przeszła (karta odrzucona po próbie).
  await setStubIntentStatus(page.request, intent.id, "requires_payment_method");

  // Ciało zdarzenia KŁAMIE (`type: succeeded`, zawyżona kwota w payloadzie)
  // i jest poprawnie podpisane — dokładnie tak wyglądałby atak z ukradzionym
  // sekretem podpisu, ale bez władzy nad kontem dostawcy.
  const payload = intentEventBody(intent.id, "payment_intent.succeeded");
  const response = await postWebhook(page.request, payload, signedWebhookHeaders(payload));
  expect(response.status()).toBe(200);
  expect((await response.json()).status).toBe("processed");

  // Werdykt z ODCZYTU: requires_payment_method → „Płatność odrzucona",
  // nigdy „Opłacone".
  const order = await orderById(intent.orderId!);
  expect(order.paymentStatus).toBe("payment_failed");

  await loginToPanel(page, PANEL_URL, seed);
  await page.goto(`${PANEL_URL}/pl/zamowienia`);
  const row = page.locator(`[data-order-row][data-order-id="${order.orderNumber}"]`);
  await expect(
    row.locator('[data-cell="payment-status"] [data-status-axis="payment"][data-status-value="payment_failed"]'),
  ).toHaveText("Płatność odrzucona");
});

test("webhook z podpisem liczonym innym sekretem jest odrzucany bez śladu przetwarzania", async ({ page }) => {
  const seed = readSeedState();

  await checkoutOnline(page, seed, `e2e-k1-klient-podpis-${Date.now()}@example.com`, { startOffsetDays: 18, endOffsetDays: 19 });
  const intent = await latestStubIntent(page.request);
  await setStubIntentStatus(page.request, intent.id, "succeeded");

  const payload = intentEventBody(intent.id);
  const response = await postWebhook(
    page.request,
    payload,
    signedWebhookHeaders(payload, { secret: "whsec_zupelnie_inny_sekret" }),
  );
  expect(response.status()).toBe(400);

  // Mimo że u dostawcy płatność wygląda na udaną, zamówienie NIE jest paid —
  // bez ważnego podpisu endpoint nie tyka stanu.
  const order = await orderById(intent.orderId!);
  expect(order.paymentStatus).not.toBe("paid");
});
