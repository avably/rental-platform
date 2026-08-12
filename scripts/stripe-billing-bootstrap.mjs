/**
 * Bootstrap cennika SaaS na koncie Stripe PLATFORMY (J2 faza 2a, ADR-136).
 *
 * Tworzy IDEMPOTENTNIE: 2 produkty (id: saas_standard, saas_premium)
 * i 4 ceny z lookup_key `saas_<plan>_<interwał>` — dokładnie te klucze,
 * po których checkout resolwuje cenę (zero price-id w env), a webhook
 * wyciąga plan z odczytu subskrypcji.
 *
 * KWOTY = decyzja właściciela (ADR-135): lustro stałej SAAS_PLAN_PRICING
 * z packages/core/src/billing/pricing.ts. Parytet skryptu ze stałą pilnuje
 * test packages/core/src/billing/pricing.test.ts — rozjazd kwot pali build,
 * nie klienta przy checkoutcie.
 *
 * Uruchomienie (właściciel/wykonawca, klucz z env — NIGDY w repo):
 *   AVABLY_STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-billing-bootstrap.mjs
 *
 * BEZPIECZNIK TRYBU: klucz LIVE jest odrzucany bez flagi --allow-live —
 * Stripe zostaje na sandboksie decyzją właściciela (włączenie płatności
 * komercyjnych to osobna bramka; LP: „odezwiemy się mailem, zanim
 * cokolwiek zacznie kosztować").
 *
 * Rozjazd kwoty istniejącej ceny NIE jest naprawiany po cichu: ceny w
 * Stripe są niemutowalne, więc skrypt tworzy NOWĄ cenę z
 * `transfer_lookup_key=true` (klucz przechodzi na nową) i dezaktywuje
 * starą — z głośnym wpisem w raporcie.
 */

/** Lustro SAAS_PLAN_PRICING (@avably/core) — parytet przypięty testem. */
export const SAAS_BOOTSTRAP_PLANS = [
  { id: "standard", name: "Avably Standard", monthlyNetGrosze: 19900, yearlyNetGrosze: 199000 },
  { id: "premium", name: "Avably Premium", monthlyNetGrosze: 39900, yearlyNetGrosze: 399000 },
];

const API = "https://api.stripe.com";
/** Lustro STRIPE_BILLING_API_VERSION (@avably/core) — parytet w teście. */
export const BOOTSTRAP_API_VERSION = "2024-06-20";

function form(params) {
  return new URLSearchParams(params).toString();
}

async function stripe(key, method, path, params) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": BOOTSTRAP_API_VERSION,
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(method === "POST" && params ? { body: form(params) } : {}),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function ensureProduct(key, plan) {
  const productId = `saas_${plan.id}`;
  const existing = await stripe(key, "GET", `/v1/products/${productId}`);
  if (existing.status === 200) return { productId, created: false };
  if (existing.status !== 404) {
    throw new Error(`Odczyt produktu ${productId}: HTTP ${existing.status}`);
  }
  const created = await stripe(key, "POST", "/v1/products", {
    id: productId,
    name: plan.name,
  });
  if (created.status < 200 || created.status >= 300) {
    throw new Error(
      `Utworzenie produktu ${productId}: HTTP ${created.status} ${created.body?.error?.message ?? ""}`,
    );
  }
  return { productId, created: true };
}

async function ensurePrice(key, productId, lookupKey, unitAmount, interval) {
  const found = await stripe(
    key,
    "GET",
    `/v1/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&limit=1`,
  );
  if (found.status !== 200) throw new Error(`Odczyt ceny ${lookupKey}: HTTP ${found.status}`);
  const current = found.body?.data?.[0];

  if (
    current &&
    current.unit_amount === unitAmount &&
    current.currency === "pln" &&
    current.recurring?.interval === interval &&
    current.active === true
  ) {
    return { lookupKey, priceId: current.id, action: "bez-zmian" };
  }

  const createParams = {
    product: productId,
    currency: "pln",
    unit_amount: String(unitAmount),
    "recurring[interval]": interval,
    lookup_key: lookupKey,
    nickname: lookupKey,
    ...(current ? { transfer_lookup_key: "true" } : {}),
  };
  const created = await stripe(key, "POST", "/v1/prices", createParams);
  if (created.status < 200 || created.status >= 300) {
    throw new Error(
      `Utworzenie ceny ${lookupKey}: HTTP ${created.status} ${created.body?.error?.message ?? ""}`,
    );
  }
  if (current) {
    const deactivated = await stripe(key, "POST", `/v1/prices/${current.id}`, { active: "false" });
    if (deactivated.status < 200 || deactivated.status >= 300) {
      console.warn(`UWAGA: nie udało się zdezaktywować starej ceny ${current.id} (${lookupKey}).`);
    }
  }
  return { lookupKey, priceId: created.body.id, action: current ? "podmieniona" : "utworzona" };
}

/**
 * Konfiguracja PORTALU KLIENTA (J2 faza 3, ADR-152) — bez niej
 * `POST /v1/billing_portal/sessions` odbija się o brak domyślnej
 * konfiguracji na koncie.
 *
 * ZAKRES PORTALU JEST DECYZJĄ ARCHITEKTONICZNĄ, NIE DOMYŚLNĄ:
 *   * karta, dane do faktury, historia płatności, anulowanie na koniec
 *     okresu — TAK: tych ekranów świadomie nie odtwarzamy u siebie;
 *   * `subscription_update` — NIE. Zmiana planu ma w tym produkcie DOKŁADNIE
 *     JEDNĄ drogę (własna akcja `changeSaasPlanAction` z bramkami stanu
 *     i tenanta). Włączenie jej także w Portalu dałoby drugi tor zmiany
 *     abonamentu, omijający te bramki — i sprzedawałoby plan Premium, który
 *     na LP jest zapowiedziany jako „wkrótce".
 *
 * Konfiguracja jest domyślną konta (`is_default`), więc sesja Portalu nie
 * musi nieść żadnego identyfikatora konfiguracji — panel nie zna price-idów
 * ani configuration-idów, tak samo jak przy cenach (lookup_key).
 */
async function ensurePortalConfiguration(key) {
  const params = {
    "business_profile[headline]": "Avably — abonament",
    "features[customer_update][enabled]": "true",
    "features[customer_update][allowed_updates][0]": "email",
    "features[customer_update][allowed_updates][1]": "address",
    "features[customer_update][allowed_updates][2]": "tax_id",
    "features[invoice_history][enabled]": "true",
    "features[payment_method_update][enabled]": "true",
    "features[subscription_cancel][enabled]": "true",
    "features[subscription_cancel][mode]": "at_period_end",
    "features[subscription_update][enabled]": "false",
  };

  const existing = await stripe(key, "GET", "/v1/billing_portal/configurations?is_default=true&limit=1");
  if (existing.status !== 200) {
    throw new Error(`Odczyt konfiguracji Portalu: HTTP ${existing.status}`);
  }
  const current = existing.body?.data?.[0];
  if (current) {
    const updated = await stripe(key, "POST", `/v1/billing_portal/configurations/${current.id}`, params);
    if (updated.status < 200 || updated.status >= 300) {
      throw new Error(
        `Aktualizacja konfiguracji Portalu: HTTP ${updated.status} ${updated.body?.error?.message ?? ""}`,
      );
    }
    return { obiekt: `portal:${current.id}`, akcja: "zaktualizowana" };
  }

  const created = await stripe(key, "POST", "/v1/billing_portal/configurations", params);
  if (created.status < 200 || created.status >= 300) {
    throw new Error(
      `Utworzenie konfiguracji Portalu: HTTP ${created.status} ${created.body?.error?.message ?? ""}`,
    );
  }
  return { obiekt: `portal:${created.body.id}`, akcja: "utworzona" };
}

async function main() {
  const key = process.env.AVABLY_STRIPE_SECRET_KEY;
  if (!key) {
    console.error("Brak AVABLY_STRIPE_SECRET_KEY w środowisku.");
    process.exit(1);
  }
  if (!key.startsWith("sk_test_") && !process.argv.includes("--allow-live")) {
    console.error(
      "Klucz nie jest sandboksowy (sk_test_…). Tryb LIVE wymaga jawnej flagi --allow-live — " +
        "włączenie płatności komercyjnych to osobna bramka właściciela.",
    );
    process.exit(1);
  }

  const report = [];
  for (const plan of SAAS_BOOTSTRAP_PLANS) {
    const { productId, created } = await ensureProduct(key, plan);
    report.push({ obiekt: productId, akcja: created ? "utworzony" : "bez-zmian" });
    report.push(
      await ensurePrice(key, productId, `saas_${plan.id}_monthly`, plan.monthlyNetGrosze, "month"),
    );
    report.push(
      await ensurePrice(key, productId, `saas_${plan.id}_yearly`, plan.yearlyNetGrosze, "year"),
    );
  }
  report.push(await ensurePortalConfiguration(key));
  console.table(report);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
