/**
 * Portal klienta dostawcy płatności (J2 faza 3, ADR-152) na ŻYWYM lokalnym
 * Supabase — bo bramką warstwy 1 jest RLS, a RLS nie da się zaatrapować.
 *
 * SEDNO ODBIORU: sesja Portalu powstaje WYŁĄCZNIE dla klienta przypisanego do
 * tego najemcy. Testujemy to z obu stron i na dwóch niezależnych wektorach
 * podstawienia:
 *
 *   1. podstawienie CUDZEGO TENANTA w wywołaniu rdzenia → projekcja przez RLS
 *      nic nie oddaje, dostawca nie jest nawet pytany;
 *   2. podstawienie CUDZEGO KLIENTA w naszym własnym wierszu projekcji
 *      (dokładnie ten stan, którego RLS nie widzi jako anomalii) → odczyt
 *      u dostawcy mówi, czyj to klient, i sesja NIE powstaje.
 *
 * Asercja „sesja nie powstała" jest tu asercją o WYWOŁANIACH, nie o braku
 * tekstu w wyniku: brak sesji przy pustym zbiorze wywołań wyglądałby tak samo,
 * gdyby rdzeń w ogóle nie doszedł do dostawcy z innego powodu — dlatego każdy
 * test odmowy sprawdza też, ILE i JAKICH wywołań padło.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import {
  openBillingPortal,
  PORTAL_FOREIGN_CUSTOMER,
  PORTAL_NO_CUSTOMER,
  type BillingPortalClient,
} from "@/lib/billing-portal";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "BillingPortalTest!12345678";
const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

describe.skipIf(!hasEnv)("Portal klienta — sesja tylko dla własnego klienta (ADR-152)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = anonClient();
    const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
    return client;
  }

  /** Owner + tenant produkcyjną ścieżką (app.create_tenant). */
  async function createOwnerWithTenant(label: string): Promise<{
    tenantId: string;
    supabase: SupabaseClient;
  }> {
    const email = `portal-${label}-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
    createdUserIds.push(data.user.id);

    const bootstrap = await signIn(email);
    const slug = `portal${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
      p_slug: slug,
      p_name: `Portal (${label})`,
    });
    if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
    createdTenantIds.push(tenantId as string);
    // Świeży klient PO utworzeniu organizacji — token musi nieść tenant_id.
    return { tenantId: tenantId as string, supabase: await signIn(email) };
  }

  async function seedSubscription(
    tenantId: string,
    customerId: string,
    status = "active",
  ): Promise<void> {
    const { error } = await admin.from("subscriptions").insert({
      tenant_id: tenantId,
      plan_id: "standard",
      status,
      stripe_customer_id: customerId,
      stripe_subscription_id: `sub_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
    });
    if (error) throw new Error(`seedSubscription: ${error.message}`);
  }

  async function setTenantStatus(tenantId: string, status: string): Promise<void> {
    const { error } = await admin.from("tenants").update({ status }).eq("id", tenantId);
    if (error) throw new Error(`setTenantStatus: ${error.message}`);
  }

  interface FakePortal extends BillingPortalClient {
    calls: { method: string; args: unknown[] }[];
  }

  /** `owners`: mapa cus_… → tenant_id, czyli prawda po stronie DOSTAWCY. */
  function fakePortal(owners: Record<string, string | null>): FakePortal {
    const calls: { method: string; args: unknown[] }[] = [];
    return {
      calls,
      readCustomerTenantId: async (customerId: string) => {
        calls.push({ method: "readCustomerTenantId", args: [customerId] });
        return owners[customerId] ?? null;
      },
      createBillingPortalSession: async (input) => {
        calls.push({ method: "createBillingPortalSession", args: [input] });
        return { url: `https://billing.stripe.com/p/session/${input.customerId}` };
      },
    };
  }

  const input = (tenantId: string) => ({
    tenantId,
    locale: "pl",
    returnUrl: "https://panel.test/pl/organizacja?portal=powrot",
  });

  it("własny klient: sesja powstaje dla TEGO customera, z adresem powrotu i językiem", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("own");
    const customerId = `cus_own_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    await seedSubscription(tenantId, customerId);

    const billing = fakePortal({ [customerId]: tenantId });
    const outcome = await openBillingPortal({ supabase, billing }, input(tenantId));

    expect(outcome).toHaveProperty("url");
    const session = billing.calls.find((c) => c.method === "createBillingPortalSession");
    expect(session).toBeDefined();
    expect(session!.args[0]).toMatchObject({
      customerId,
      returnUrl: "https://panel.test/pl/organizacja?portal=powrot",
      locale: "pl",
    });
  });

  it("brak wiersza projekcji (okres próbny): odmowa nazwana, dostawca NIEPYTANY", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("trial");
    const billing = fakePortal({});
    const outcome = await openBillingPortal({ supabase, billing }, input(tenantId));

    expect(outcome).toEqual({ error: PORTAL_NO_CUSTOMER });
    expect(billing.calls).toHaveLength(0);
  });

  it("SONDA 1: podstawienie CUDZEGO tenanta — RLS nie oddaje wiersza, zero wywołań dostawcy", async () => {
    const a = await createOwnerWithTenant("a1");
    const b = await createOwnerWithTenant("b1");
    const customerA = `cus_a_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const customerB = `cus_b_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    await seedSubscription(a.tenantId, customerA);
    await seedSubscription(b.tenantId, customerB);

    const billing = fakePortal({ [customerA]: a.tenantId, [customerB]: b.tenantId });
    // Klient sesji ownera A, ale identyfikator najemcy podstawiony na B.
    const outcome = await openBillingPortal({ supabase: a.supabase, billing }, input(b.tenantId));

    expect(outcome).toEqual({ error: PORTAL_NO_CUSTOMER });
    // Nie tylko „bez sesji" — dostawca nie zostaje nawet zapytany o cudzego
    // klienta. Zawężenie do tenant_id zdejmuje ten ruch u źródła.
    expect(billing.calls).toHaveLength(0);
  });

  it("SONDA 2: cudzy klient we WŁASNYM wierszu projekcji — sesja NIE powstaje", async () => {
    const a = await createOwnerWithTenant("a2");
    const b = await createOwnerWithTenant("b2");
    const customerB = `cus_b2_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    // Stan, którego RLS nie uzna za anomalię: wiersz JEST nasz, tylko niesie
    // cudzy identyfikator klienta (wpis ręczny, skrzyżowane strumienie).
    await seedSubscription(a.tenantId, customerB);

    const billing = fakePortal({ [customerB]: b.tenantId });
    const outcome = await openBillingPortal({ supabase: a.supabase, billing }, input(a.tenantId));

    expect(outcome).toEqual({ error: PORTAL_FOREIGN_CUSTOMER });
    expect(billing.calls.map((c) => c.method)).toEqual(["readCustomerTenantId"]);
    expect(billing.calls.map((c) => c.method)).not.toContain("createBillingPortalSession");
  });

  it("klient bez przypisania u dostawcy (usunięty w dashboardzie) — też odmowa", async () => {
    const { tenantId, supabase } = await createOwnerWithTenant("orphan");
    const customerId = `cus_orph_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    await seedSubscription(tenantId, customerId);

    // `readCustomerTenantId` oddaje null (obiekt `deleted: true` albo brak
    // metadanych) — null NIE jest dopasowaniem do naszego tenanta.
    const billing = fakePortal({ [customerId]: null });
    const outcome = await openBillingPortal({ supabase, billing }, input(tenantId));

    expect(outcome).toEqual({ error: PORTAL_FOREIGN_CUSTOMER });
    expect(billing.calls.map((c) => c.method)).not.toContain("createBillingPortalSession");
  });

  /**
   * NAJDROŻSZE MIEJSCE W TEJ PACZCE — dlatego ma własny blok i własną nazwę.
   *
   * Portal CELOWO nie sprawdza `MANAGEABLE_SAAS_SUBSCRIPTION_STATUSES`, choć
   * obie ścieżki zmiany abonamentu stoją na tym zbiorze w całości. Powód jest
   * odwrotnością tamtej reguły: `billing-subscription.ts` ZMIENIA abonament,
   * więc odmawia zadłużonym, bo droga z długu prowadzi przez zapłatę — a
   * Portal JEST tą drogą. Najemca zawieszony ma subskrypcję `unpaid`, czyli
   * ŻYWĄ, więc bramka W6 odmawia mu checkoutu; Portal zostaje jedynym
   * miejscem, w którym wymieni kartę i opłaci zaległą fakturę.
   *
   * Bez tego testu pięć linii „uzupełniających zapomniane sprawdzenie"
   * zamyka odzyskiwanie przychodu i NIC nie świeci na czerwono.
   *
   * Sonda jedzie po stanie ZASTANYM W BAZIE (status tenanta i status wiersza
   * projekcji), nie po atrapie: gdyby ktoś dołożył bramkę na którymkolwiek
   * z tych dwóch statusów, ten test go złapie.
   */
  describe("DECYZJA, NIE PRZEOCZENIE: Portal NIE bramkuje statusu subskrypcji", () => {
    it.each([
      ["unpaid", "suspended", "zawieszony za nieopłacenie — checkout odmawia bramką W6"],
      ["past_due", "past_due", "po nieudanej racie — sklep działa, karta do wymiany"],
    ] as const)(
      "subskrypcja %s (tenant %s): sesja Portalu POWSTAJE — %s",
      async (subscriptionStatus, tenantStatus, powod) => {
        const { tenantId, supabase } = await createOwnerWithTenant(`pay-${subscriptionStatus}`);
        const customerId = `cus_pay_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
        await seedSubscription(tenantId, customerId, subscriptionStatus);
        await setTenantStatus(tenantId, tenantStatus);

        const billing = fakePortal({ [customerId]: tenantId });
        const outcome = await openBillingPortal({ supabase, billing }, input(tenantId));

        // Sesja MUSI powstać — to jest cała treść tego testu. Powód jedzie
        // w komunikacie asercji, żeby czerwony wynik mówił, CO się zamyka,
        // a nie tylko „brak własności url".
        expect(outcome, powod).toHaveProperty("url");
        expect(billing.calls.map((c) => c.method), powod).toContain("createBillingPortalSession");
        expect(
          billing.calls.find((c) => c.method === "createBillingPortalSession")!.args[0],
        ).toMatchObject({ customerId });
      },
    );

    it("stan zastany w bazie jest TAKI, jak zakłada sonda (kontrola po pustym zbiorze)", async () => {
      // Bez tej kontroli oba testy wyżej przechodziłyby także wtedy, gdyby
      // zasiew cicho zapisał `active` — czyli badałyby szczęśliwą ścieżkę
      // pod nazwą sondy zawieszenia.
      const { tenantId } = await createOwnerWithTenant("pay-control");
      const customerId = `cus_ctrl_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
      await seedSubscription(tenantId, customerId, "unpaid");
      await setTenantStatus(tenantId, "suspended");

      const { data } = await admin
        .from("subscriptions")
        .select("status, tenants(status)")
        .eq("tenant_id", tenantId)
        .single();
      const row = data as { status: string; tenants: { status: string } | { status: string }[] };
      const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
      expect(row.status).toBe("unpaid");
      expect(tenant!.status).toBe("suspended");
    });
  });

  it("komunikat odmowy nie cytuje żadnego identyfikatora dostawcy", async () => {
    const a = await createOwnerWithTenant("leak");
    const b = await createOwnerWithTenant("leak2");
    const customerB = `cus_leak_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    await seedSubscription(a.tenantId, customerB);

    const billing = fakePortal({ [customerB]: b.tenantId });
    const outcome = await openBillingPortal({ supabase: a.supabase, billing }, input(a.tenantId));

    const message = (outcome as { error: string }).error;
    // Kontrola po pustym zbiorze: najpierw upewniamy się, że komunikat W OGÓLE
    // jest — dopiero potem asertujemy, czego w nim nie ma.
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toContain(customerB);
    expect(message).not.toContain(b.tenantId);
    expect(message).not.toContain("cus_");
  });
});
