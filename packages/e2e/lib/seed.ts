import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { requiredEnv } from "./env";
import type { SeedState } from "./seed-state";

/**
 * Sieje kompletnego tenanta pod ścieżkę krytyczną: konto ownera, produkt
 * z egzemplarzami, punkt odbioru, opublikowaną stronę sklepu z sekcją
 * produktów i konto płatności.
 *
 * Wzorce siewu jak w `packages/db/test/helpers/seed-tenants.ts`:
 * konto przez GoTrue Admin API (`createUser` z `app_metadata.tenant_id`
 * — źródło claimów JWT) ORAZ jawny wiersz `public.members` (źródło RLS).
 * Kolumny `*_published` strony sklepu wolno pisać wprost, bo trigger
 * `app.guard_published_columns` ma jawny bypass dla `service_role`.
 *
 * Unikalny slug per przebieg: współdzielona lokalna baza, negatywny cache
 * rozwiązywania hosta (30 s) i limity checkoutu (30 zamówień/tenant/h)
 * nie przeciekają między przebiegami.
 */
export async function seedTenant(
  options: { withLegalDocuments?: boolean } = {},
): Promise<SeedState> {
  const runId = randomBytes(4).toString("hex");
  const slug = `e2e-k1-${runId}`;

  const admin = createClient(
    requiredEnv("SUPABASE_LOCAL_API_URL"),
    requiredEnv("SUPABASE_LOCAL_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const state: SeedState = {
    slug,
    tenantId: "",
    ownerEmail: `e2e-k1-owner-${runId}@example.com`,
    ownerPassword: "E2eTest!12345678",
    productId: "",
    productName: "Młot wyburzeniowy E2E",
    productSlug: "",
    priceDayGrosze: 5_000,
    unitCount: 2,
    pickupLocationName: "Magazyn E2E",
    providerAccountId: `acct_e2e_${runId}`,
    termsVersionId: "",
  };

  // 1. Tenant w statusie rozwiązującym się w storefroncie (tylko
  //    `trialing`/`active` przechodzą przez app.resolve_tenant_by_slug).
  state.tenantId = await insertReturningId(admin, "tenants", {
    slug,
    name: `E2E K1 ${runId}`,
    status: "active",
  });

  // 2. Konto ownera: GoTrue Admin API nadaje hasz hasła i wiersz identities;
  //    app_metadata zasila claimy JWT przez hook app.custom_access_token.
  const created = await admin.auth.admin.createUser({
    email: state.ownerEmail,
    password: state.ownerPassword,
    email_confirm: true,
    app_metadata: { tenant_id: state.tenantId, role: "owner" },
  });
  if (created.error || !created.data.user) {
    throw new Error(`Seed: GoTrue createUser nie powiódł się: ${created.error?.message}`);
  }

  // 3. Członkostwo — źródło prawdy RLS (claim JWT to za mało).
  await insert(admin, "members", {
    tenant_id: state.tenantId,
    user_id: created.data.user.id,
    role: "owner",
  });

  // 4. Produkt bez buforów (bufory rozszerzają kolizje terminów — scenariusze
  //    dat w testach mają zostać arytmetycznie oczywiste) i bez kaucji
  //    (noga kaucji online to osobny obieg, poza ścieżką K1).
  state.productId = await insertReturningId(admin, "products", {
    tenant_id: state.tenantId,
    name: state.productName,
    description: "Egzemplarz testowy suity e2e.",
    base_price_day_grosze: state.priceDayGrosze,
    deposit_grosze: 0,
    buffer_before_days: 0,
    buffer_after_days: 0,
    active: true,
  });

  // 4a. ADRES sprzętu — ODCZYTANY, nie policzony (ADR-182). Nadaje go trigger
  //     `products_slug_guard` z nazwy, więc seed pyta bazę o wynik zamiast
  //     powtarzać regułę normalizacji u siebie.
  {
    const { data, error } = await admin
      .from("products")
      .select("slug")
      .eq("id", state.productId)
      .single();
    if (error || !data?.slug) {
      throw new Error(`Seed: nie mogę odczytać adresu sprzętu: ${error?.message}`);
    }
    state.productSlug = data.slug as string;
  }

  // 5. Egzemplarze — bez wierszy w product_units dostępność wynosi 0
  //    i checkout zawsze pada.
  for (let i = 1; i <= state.unitCount; i += 1) {
    await insert(admin, "product_units", {
      tenant_id: state.tenantId,
      product_id: state.productId,
      serial_number: `E2E-${runId}-${i}`,
    });
  }

  // 6. Punkt odbioru — wymagany dla delivery_method='pickup' w checkoucie.
  await insert(admin, "pickup_locations", {
    tenant_id: state.tenantId,
    name: state.pickupLocationName,
    address_street: "Testowa 1",
    address_zip: "00-001",
    address_city: "Warszawa",
    active: true,
  });

  // 7. Opublikowana strona sklepu z sekcją produktów — bez niej /store
  //    pokazuje „Katalog jest w przygotowaniu", nie karty produktów.
  const siteId = await insertReturningId(admin, "sites", {
    tenant_id: state.tenantId,
    template: "classic",
    template_published: "classic",
    // Strona GŁÓWNA sklepu = slug pusty (0073, ADR-157). CHECK
    // sites_published_slug_complete nie przepuszcza strony opublikowanej
    // bez opublikowanego adresu.
    slug: "",
    slug_published: "",
    published_at: new Date().toISOString(),
    name: "Strona sklepu E2E",
  });
  await insert(admin, "site_sections", {
    tenant_id: state.tenantId,
    site_id: siteId,
    type: "products",
    position: 0,
    enabled: true,
    content_draft: { heading: "Sprzęt" },
    content_published: { heading: "Sprzęt" },
    position_published: 0,
    enabled_published: true,
  });

  // 7a. Dokumenty prawne (0063/0086, ADR-191): checkout odmawia bez
  //     opublikowanego regulaminu I polityki prywatności, więc tenant ścieżki
  //     krytycznej dostaje komplet przy zasiewie. Scenariusz odmowy
  //     (07-bramka-regulaminu) sieje własnego tenanta z `withLegalDocuments:
  //     false`. Wiersz wersji wstawiamy wprost service_rolem (wzorzec
  //     packages/db/test); sha256 nadpisze trigger stemplowy.
  if (options.withLegalDocuments !== false) {
    for (const kind of ["terms", "privacy"] as const) {
      const documentId = await insertReturningId(admin, "legal_documents", {
        tenant_id: state.tenantId,
        kind,
        title: kind === "terms" ? "Regulamin E2E" : "Polityka prywatności E2E",
        body_draft: `Treść (${kind}) najemcy e2e — tekst, na który przystaje klient.`,
        locale: "pl",
      });
      const versionId = await insertReturningId(admin, "legal_document_versions", {
        tenant_id: state.tenantId,
        document_id: documentId,
        kind,
        version_no: 1,
        version_label: "v1",
        title: kind === "terms" ? "Regulamin E2E" : "Polityka prywatności E2E",
        body: `Treść (${kind}) najemcy e2e — tekst, na który przystaje klient.`,
        sha256: "0".repeat(64),
        locale: "pl",
        published_by: created.data.user.id,
      });
      const { error: pointerError } = await admin
        .from("legal_documents")
        .update({ current_version_id: versionId })
        .eq("tenant_id", state.tenantId)
        .eq("id", documentId);
      if (pointerError) {
        throw new Error(`Seed: publikacja (${kind}) nie powiodła się: ${pointerError.message}`);
      }
      if (kind === "terms") state.termsVersionId = versionId;
    }
  }

  // 8. Konto płatności tenanta: identyfikator, po którym webhook znajduje
  //    konto Connect, a storefront pyta dostawcę o gotowość (odpowiada stub).
  await insert(admin, "payment_accounts", {
    tenant_id: state.tenantId,
    provider: "stripe",
    provider_account_id: state.providerAccountId,
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
  });

  return state;
}

async function insert(
  admin: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<void> {
  const { error } = await admin.from(table).insert(row);
  if (error) throw new Error(`Seed: insert do ${table} nie powiódł się: ${error.message}`);
}

async function insertReturningId(
  admin: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await admin.from(table).insert(row).select("id").single();
  if (error || !data) {
    throw new Error(`Seed: insert do ${table} nie powiódł się: ${error?.message}`);
  }
  return (data as { id: string }).id;
}
