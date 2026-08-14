/**
 * ODCZYT sygnałów karty „Zacznij tutaj" na ŻYWYM Supabase — regresja po
 * incydencie prod 2026-08-11 (UX1, ADR-140).
 *
 * Incydent: `fetchStartCardSignals` czytał `sites` zapytaniem zakładającym
 * DOKŁADNIE jeden wiersz, a od migracji 0048 (ADR-093, wersje stron) tenant
 * legalnie ma ich 0..N — pulpit ownera padał 500 z błędem PGRST116
 * („JSON object requested, multiple (or no) rows returned"). Ten plik mierzy
 * to, czego czysty model (`dashboard-start-card.test.tsx`) nie widzi:
 * KSZTAŁT zapytań kontra realne liczby wierszy w bazie.
 *
 *   1. tenant z ZEREM wierszy `sites` (świeże konto — provisioning strony
 *      nie zasiewa) → odczyt przechodzi, krok sklepu otwarty, karta się
 *      renderuje;
 *   2. tenant z DWIEMA wersjami roboczymi (przypadek z incydentu) → odczyt
 *      przechodzi, sklep nadal nieopublikowany;
 *   3. dwie wersje, jedna ŻYWA (app.publish_site) → krok sklepu zrobiony,
 *      `publishedAt` = moment publikacji żywej wersji;
 *   4. `payment_accounts`: sam wiersz konta ≠ podłączone; dopiero
 *      charges_enabled robi krok (odczyt pyta o ISTNIENIE konta zdolnego
 *      przyjmować płatności, nie o pojedynczość wiersza);
 *   5. krok sklepu pyta o KORZEŃ (ADR-168): opublikowana PODSTRONA go nie
 *      odhacza, bo pod `/` klient dalej nie ma czego oglądać;
 *   6. ani SZABLON strony produktu (ADR-178), który ma pusty slug, bo adresu
 *      nie ma w ogóle — pusty slug przestał być dowodem na korzeń sklepu.
 *
 * Dowód mutacyjny (procedura recenzji): przywrócenie w `start-card.ts`
 * odczytu `sites` bez filtra published_at i limitu (kształt sprzed hotfixu)
 * pali testy 2–3 dokładnie błędem z incydentu; `.single()` pali też test 1.
 *
 * Harness = wzorzec `site-pages-actions.test.ts` (create_tenant przez RPC,
 * zasiew wierszy service-rolem, odczyt mierzonego modułu klientem CZŁONKA —
 * tak woła go produkcyjny pulpit, więc bramką zostaje RLS).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import messages from "../messages/pl.json";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "StartCardSignals!12345678";
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createTenantMember(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `startcard-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await bootstrap.schema("app").rpc("create_tenant", {
    p_slug: `startcard-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja karty ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string };
}

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { fetchStartCardSignals, startSteps } = await import("@/lib/dashboard/start-card");
const { DashboardStartCard } = await import("@/app/[locale]/(panel)/dashboard-start-card");

function renderCard(steps: ReturnType<typeof startSteps>): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <DashboardStartCard steps={steps} />
    </NextIntlClientProvider>,
  );
}

function storeStep(steps: ReturnType<typeof startSteps>) {
  const step = steps.find((candidate) => candidate.key === "store");
  if (!step) throw new Error("brak kroku sklepu w modelu");
  return step;
}

describe.skipIf(!hasEnv)("sygnały karty startowej (kształt odczytów, żywy Supabase)", () => {
  let admin: SupabaseClient;
  let tenant: { client: SupabaseClient; tenantId: string };

  beforeAll(async () => {
    admin = createAdminClient();
    tenant = await createTenantMember(admin, "a");
  }, 60_000);

  beforeEach(async () => {
    await admin.from("sites").delete().eq("tenant_id", tenant.tenantId);
    await admin.from("payment_accounts").delete().eq("tenant_id", tenant.tenantId);
  });

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) await admin.from("tenants").delete().in("id", createdTenantIds);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    createdUserIds.length = 0;
    createdTenantIds.length = 0;
  }, 60_000);

  it("świeży tenant, ZERO wierszy sites: odczyt przechodzi, wszystkie kroki otwarte, karta się renderuje", async () => {
    const signals = await fetchStartCardSignals(tenant.client, tenant.tenantId);

    expect(signals).toEqual({
      firstProductName: null,
      unitCount: 0,
      publishedAt: null,
      hasContractDocument: false,
      hasEmailSender: false,
      chargesEnabled: false,
      ordersCount: 0,
    });

    const steps = startSteps(signals);
    expect(storeStep(steps).done).toBe(false);

    const html = renderCard(steps);
    expect(html).toContain("Zacznij tutaj");
    expect(html).toContain("0 z 6 zrobione");
  });

  it("DWIE wersje robocze (incydent prod: >1 wierszy sites): odczyt przechodzi, sklep nadal nieopublikowany", async () => {
    const { error } = await admin.from("sites").insert([
      { tenant_id: tenant.tenantId, name: "Wersja robocza A" },
      { tenant_id: tenant.tenantId, name: "Wersja robocza B" },
    ]);
    expect(error, `zasiew wersji roboczych: ${error?.message}`).toBeNull();

    // Przed hotfixem TO wołanie padało błędem z incydentu:
    // „Odczyt karty startowej (sites) … multiple (or no) rows returned".
    const signals = await fetchStartCardSignals(tenant.client, tenant.tenantId);

    expect(signals.publishedAt).toBeNull();
    const steps = startSteps(signals);
    expect(storeStep(steps).done).toBe(false);
    expect(renderCard(steps)).toContain("0 z 6 zrobione");
  });

  it("dwie wersje, jedna ŻYWA: krok sklepu zrobiony, publishedAt = moment publikacji żywej", async () => {
    const { data: inserted, error } = await admin
      .from("sites")
      .insert([
        { tenant_id: tenant.tenantId, name: "Szkic w szufladzie" },
        { tenant_id: tenant.tenantId, name: "Do publikacji" },
      ])
      .select("id, name");
    expect(error, `zasiew wersji: ${error?.message}`).toBeNull();
    const target = (inserted ?? []).find((row) => row.name === "Do publikacji");
    if (!target) throw new Error("zasiew nie zwrócił wersji do publikacji");

    // Publikacja JEDYNĄ produkcyjną drogą (app.publish_site, ADR-041/093),
    // klientem członka — nie ręcznym UPDATE-em, którego strażnik 0045 broni.
    const { error: publishError } = await tenant.client
      .schema("app")
      .rpc("publish_site", { p_site_id: target.id });
    expect(publishError, `publish_site: ${publishError?.message}`).toBeNull();

    const { data: live } = await admin
      .from("sites")
      .select("published_at")
      .eq("id", target.id)
      .single();
    expect(live?.published_at, "publikacja nie ustawiła published_at").toBeTruthy();

    const signals = await fetchStartCardSignals(tenant.client, tenant.tenantId);
    expect(signals.publishedAt).toBe(live!.published_at);

    const steps = startSteps(signals);
    expect(storeStep(steps).done).toBe(true);
    expect(renderCard(steps)).toContain("1 z 6 zrobione");
  });

  it("krok sklepu pyta o KORZEŃ sklepu, a nie o dowolną stronę (ADR-168)", async () => {
    /*
     * Po fazie 2 (0073/0074) każda strona stoi pod SWOIM adresem, a krok
     * obiecuje operatorowi „Opublikuj stronę sklepu" — czyli korzeń. Bez
     * zawężenia do pustego `slug_published` opublikowany `/oferta` odhaczał
     * krok sklepu, którego klienci nie mieli: pod `/` była pustka, a panel
     * meldował „zrobione" i zabierał operatorowi jedyny sygnał o wadzie K1.
     */
    const { data: subpage, error } = await admin
      .from("sites")
      .insert({ tenant_id: tenant.tenantId, name: "Oferta", slug: "oferta" })
      .select("id")
      .single();
    expect(error, `zasiew podstrony: ${error?.message}`).toBeNull();

    const { error: publishError } = await tenant.client
      .schema("app")
      .rpc("publish_site", { p_site_id: subpage!.id });
    expect(publishError, `publish_site: ${publishError?.message}`).toBeNull();

    const signals = await fetchStartCardSignals(tenant.client, tenant.tenantId);
    expect(signals.publishedAt, "opublikowana podstrona odhaczyła krok sklepu").toBeNull();
    expect(storeStep(startSteps(signals)).done).toBe(false);

    // KONTROLA POZYTYWNA: ta sama droga ze stroną GŁÓWNĄ krok odhacza —
    // inaczej zieleń wyżej znaczyłaby tylko „krok nigdy się nie robi".
    const { data: home, error: homeError } = await admin
      .from("sites")
      .insert({ tenant_id: tenant.tenantId, name: "Strona główna" })
      .select("id")
      .single();
    expect(homeError, `zasiew strony głównej: ${homeError?.message}`).toBeNull();
    const { error: homePublishError } = await tenant.client
      .schema("app")
      .rpc("publish_site", { p_site_id: home!.id });
    expect(homePublishError, `publish_site (główna): ${homePublishError?.message}`).toBeNull();

    const after = await fetchStartCardSignals(tenant.client, tenant.tenantId);
    expect(after.publishedAt, "opublikowana strona główna NIE odhaczyła kroku").not.toBeNull();
    expect(storeStep(startSteps(after)).done).toBe(true);
  }, 60_000);

  it("krok sklepu pyta o KORZEŃ, a nie o pusty slug: SZABLON strony produktu go NIE odhacza", async () => {
    /*
     * Faza 5 (ADR-178) odebrała pustemu slugowi monopol na znaczenie „korzeń
     * sklepu": szablon strony produktu ADRESU NIE MA, więc jego `slug` i
     * `slug_published` są puste — dokładnie jak u strony głównej. Bez członu
     * o ROLI w zapytaniu publikacja szablonu odhaczałaby krok „Opublikuj
     * stronę sklepu" najemcy, u którego pod `/` dalej jest pustka. To jest
     * wada K1 (ADR-168) wracająca innymi drzwiami — a ten test jest jedynym
     * miejscem, w którym widać ją na KSZTAŁCIE ZAPYTANIA wobec żywej bazy.
     */
    const { data: template, error } = await admin
      .from("sites")
      .insert({ tenant_id: tenant.tenantId, name: "Strona sprzętu", kind: "product" })
      .select("id")
      .single();
    expect(error, `zasiew szablonu: ${error?.message}`).toBeNull();

    const { error: publishError } = await tenant.client
      .schema("app")
      .rpc("publish_site", { p_site_id: template!.id });
    expect(publishError, `publish_site (szablon): ${publishError?.message}`).toBeNull();

    const signals = await fetchStartCardSignals(tenant.client, tenant.tenantId);
    expect(signals.publishedAt, "opublikowany szablon odhaczył krok sklepu").toBeNull();
    expect(storeStep(startSteps(signals)).done).toBe(false);

    // KONTROLA POZYTYWNA: strona GŁÓWNA obok szablonu krok odhacza — inaczej
    // zieleń wyżej znaczyłaby tylko „krok nigdy się nie robi". Przy okazji
    // dowód, że oba wiersze WSPÓŁISTNIEJĄ żywe (unikat z 0073 ustąpił w 0080).
    const { data: home, error: homeError } = await admin
      .from("sites")
      .insert({ tenant_id: tenant.tenantId, name: "Strona główna" })
      .select("id")
      .single();
    expect(homeError, `zasiew strony głównej: ${homeError?.message}`).toBeNull();
    const { error: homePublishError } = await tenant.client
      .schema("app")
      .rpc("publish_site", { p_site_id: home!.id });
    expect(homePublishError, `publish_site (główna obok szablonu): ${homePublishError?.message}`).toBeNull();

    const after = await fetchStartCardSignals(tenant.client, tenant.tenantId);
    expect(after.publishedAt, "strona główna NIE odhaczyła kroku").not.toBeNull();
    expect(storeStep(startSteps(after)).done).toBe(true);
  }, 60_000);

  it("payment_accounts: sam wiersz konta ≠ podłączone; charges_enabled robi krok", async () => {
    const { error } = await admin.from("payment_accounts").insert({
      tenant_id: tenant.tenantId,
      provider_account_id: "acct_startcard_test",
    });
    expect(error, `zasiew konta płatności: ${error?.message}`).toBeNull();

    const pending = await fetchStartCardSignals(tenant.client, tenant.tenantId);
    expect(pending.chargesEnabled).toBe(false);

    const { error: enableError } = await admin
      .from("payment_accounts")
      .update({ charges_enabled: true })
      .eq("tenant_id", tenant.tenantId);
    expect(enableError, `włączenie charges_enabled: ${enableError?.message}`).toBeNull();

    const enabled = await fetchStartCardSignals(tenant.client, tenant.tenantId);
    expect(enabled.chargesEnabled).toBe(true);
  });
});
