import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { E2E_REVIEW_INGEST_TOKEN, PANEL_URL, storefrontUrl } from "../lib/env";
import { readSeedState } from "../lib/seed-state";

/**
 * Ogniwo 5: narzędzie przeglądu po ADR-099/ADR-115 — uwaga dodana przez
 * PRAWDZIWĄ nakładkę na sklepie tenanta przechodzi całą nową drogą:
 * nakładka → same-origin /api/review (storefront BEZ sekretu bazy) →
 * relay server-side → ingest panelu (wspólny sekret, stałoczasowo) →
 * zapis service_rolem → i WRACA na listę po pełnym przeładowaniu strony
 * (dowód, że wróciła z bazy, nie ze stanu klienta).
 *
 * Powierzchnia SKLEPU (nie marketingowa): strony marketingowe czytają
 * szablony z process.cwd() i pod harnessem e2e (start poza katalogiem
 * apki) oddają 500 — zastany brak harnessu, nie tej zmiany; przepływ
 * relaya jest identyczny na obu powierzchniach.
 *
 * Kontrola negatywna izolacji bramki: ingest panelu odmawia bez tokenu
 * i ze złym tokenem — wołany wprost, z pominięciem relaya.
 */

const seededBody = `uwaga e2e przeglądu ${randomUUID()}`;

test.afterAll(async () => {
  // Sprzątanie po sobie na WSPÓŁDZIELONEJ lokalnej bazie — kluczem harnessu
  // testowego (SUPABASE_LOCAL_*), jak w suitach integracyjnych repo.
  const url = process.env.SUPABASE_LOCAL_API_URL;
  const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return;
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  await client.from("review_comments").delete().eq("body", seededBody);
});

test("uwaga z nakładki przechodzi relay → ingest → bazę i wraca po przeładowaniu", async ({
  page,
}) => {
  const seed = readSeedState();
  const shopUrl = `${storefrontUrl(seed.slug)}/?review=1`;
  await page.goto(shopUrl);

  // Tryb KOMENTARZ (przycisk pokazuje nazwę bieżącego trybu — „Podgląd").
  await page.locator(".avb-rev-mode").click();
  await expect(page.locator(".avb-rev-layer.avb-rev-capturing")).toBeVisible();

  // Punkt w losowym miejscu — na współdzielonej bazie mogą wisieć pinezki
  // z poprzednich przebiegów; losowość + unikalna treść rozstrzygają, że
  // asercje dotyczą TEJ uwagi.
  const x = 120 + Math.floor(Math.random() * 500);
  const y = 220 + Math.floor(Math.random() * 260);
  await page.locator(".avb-rev-layer").click({ position: { x, y } });

  await page.locator(".avb-rev textarea").fill(seededBody);
  await page.getByRole("button", { name: "Zapisz uwagę" }).click();

  // Pinezka nowej uwagi (aria-label niesie początek treści).
  const pin = page.locator(`.avb-rev-pin[aria-label*="${seededBody.slice(7, 40)}"]`);
  await expect(pin).toBeVisible();

  // Pełne przeładowanie: lista wraca z bazy przez relay (GET), nie ze stanu.
  await page.goto(shopUrl);
  await page.locator(".avb-rev-mode").click();
  await expect(pin).toBeVisible();
});

test("ingest panelu odmawia bez tokenu i ze złym tokenem (z pominięciem relaya)", async ({
  request,
}) => {
  const target = `${PANEL_URL}/api/review/ingest/comments?surface=marketing`;

  const anonymous = await request.get(target);
  expect(anonymous.status()).toBe(401);

  const wrong = await request.get(target, {
    headers: { authorization: "Bearer zupelnie-inny-token" },
  });
  expect(wrong.status()).toBe(401);

  const good = await request.get(target, {
    headers: { authorization: `Bearer ${E2E_REVIEW_INGEST_TOKEN}` },
  });
  expect(good.status()).toBe(200);
});
