/**
 * Rekoncyliacja płatności „stuck pending" (L11, ADR-104) na ŻYWYM, lokalnym
 * Supabase.
 *
 * DLACZEGO NA ŻYWEJ BAZIE. Trzy rzeczy, których ta pętla ma dowodzić, są
 * WŁASNOŚCIĄ BAZY, nie kodu: bramka writera rozliczeń (`paid`/`payment_failed`
 * w obiegu stripe wyłącznie dla `service_role`, 0030), mapa przejść osi
 * płatności (0027) i RLS na zamówieniach (0007/0013). Atrapa klienta
 * odpowiadałaby to, co sami byśmy jej kazali — czyli test świeciłby na
 * zielono także wtedy, gdyby żadnej z tych bramek nie było.
 *
 * WSTRZYKNIĘTY JEST WYŁĄCZNIE PORT DOSTAWCY (odczyt i wygaszenie płatności),
 * bo tylko on jest po drugiej stronie sieci. Klient service-role jest
 * PRAWDZIWY — budowany przez `createServiceClient()` z tych samych zmiennych
 * co w produkcji.
 *
 * ================== OSIE DOWODU ==================
 *
 *   1. KARENCJA — płatność młodsza niż kwadrans nie jest nawet odpytywana;
 *      pętla nie ma prawa wyprzedzać webhooka,
 *   2. KONTO CONNECTED PER NAJEMCA — odczyt idzie kontem WŁAŚCICIELA
 *      zamówienia; konto platformy i cudze konto są wyciekiem pieniędzy
 *      między najemcami,
 *   3. GRANICA ZAUFANIA — stan piszemy z ODCZYTU; wiek NASZEGO rekordu nie
 *      jest podstawą żadnego zapisu,
 *   4. KOLEJNOŚĆ WYGASZENIA — najpierw anulowanie u dostawcy, DOPIERO POTEM
 *      zapis; wyścig wygrany przez klienta kończy się `paid`, nie
 *      `payment_failed`,
 *   5. IZOLACJA NAJEMCÓW W AKCJI PANELU — członek tenanta A nie dosięga
 *      zamówienia tenanta B ani odczytem, ani zapisem.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const TEST_PASSWORD = "PaymentReconciliationTest!12345678";
const RENTAL_GROSZE = 30_000;
const DELIVERY_GROSZE = 2_000;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

// Klient service-role budujemy PRAWDZIWĄ fabryką (`createServiceClient`),
// więc musi zastać te same zmienne co w produkcji. W jobie CI `rls` są
// ustawione wyłącznie warianty SUPABASE_LOCAL_* — przepisujemy je tutaj,
// zamiast podstawiać atrapę fabryki: podstawiona fabryka przeszłaby także
// wtedy, gdyby akcja panelu przestała używać roli, której zapis wymaga.
if (hasEnv) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = env("SUPABASE_LOCAL_API_URL");
  process.env.SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_LOCAL_SERVICE_ROLE_KEY");
}

/** Odczyt u dostawcy w kształcie `IntentRead`, budowany przez test. */
interface FakeIntent {
  intentId: string;
  status: string;
  amountReceivedGrosze: number;
  amountGrosze: number;
  createdAtSeconds: number;
}

/**
 * Port dostawcy pod kontrolą testu. `calls` jest DOWODEM, jakim kontem
 * i o co pytaliśmy — bez niego „job zadziałał" nie odróżnia się od „job
 * zadziałał na cudzym koncie".
 */
const provider = vi.hoisted(() => ({
  calls: [] as { kind: "read" | "cancel"; intentId: string; accountId: string }[],
  read: null as null | ((intentId: string, accountId: string) => Promise<unknown>),
  cancel: null as null | ((intentId: string, accountId: string) => Promise<void>),
}));

vi.mock("@avably/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readPaymentIntent: async (intentId: string, deps: { connectedAccountId: string }) => {
      provider.calls.push({ kind: "read", intentId, accountId: deps.connectedAccountId });
      if (!provider.read) throw new Error("Test nie ustawił odczytu u dostawcy.");
      return provider.read(intentId, deps.connectedAccountId);
    },
    cancelPaymentIntent: async (intentId: string, deps: { connectedAccountId: string }) => {
      provider.calls.push({ kind: "cancel", intentId, accountId: deps.connectedAccountId });
      if (!provider.cancel) throw new Error("Test nie ustawił wygaszania u dostawcy.");
      return provider.cancel(intentId, deps.connectedAccountId);
    },
  };
});

/** Kontekst członka wstrzykiwany akcji zamiast odczytu ciasteczek. */
const memberContext = vi.hoisted(() => ({
  current: null as { tenantId: string; supabase: SupabaseClient } | null,
  /** Ustawione = `requireMember` rzuca (ścieżka niezalogowanego). */
  authError: null as string | null,
}));

vi.mock("@/lib/supabase-server", async () => {
  const { AuthError } = await import("@/lib/auth");
  return {
    requireMember: async () => {
      if (memberContext.authError) throw new AuthError(401, memberContext.authError);
      if (!memberContext.current) throw new Error("Test nie ustawił kontekstu członka.");
      return {
        user: { id: "test", email: "test@test.local" },
        tenantId: memberContext.current.tenantId,
        role: "owner",
        superadmin: false,
        aal: "aal1",
        supabase: memberContext.current.supabase,
      };
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { reconcilePayments, reconcileOrderPayment } = await import(
  "@/src/jobs/reconcile-payments"
);
const { checkPaymentStatusAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/[id]/payment-actions"
);

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

const adminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn: ${error.message}`);
  return client;
}

let orderSeq = 0;

interface Tenant {
  tenantId: string;
  accountId: string;
  customerId: string;
  pickupId: string;
  /** Klient z REALNĄ sesją członka — tym samym, którego używa akcja panelu. */
  client: SupabaseClient;
}

describe.skipIf(!hasEnv)("rekoncyliacja płatności — L11", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const NOW = new Date("2026-09-15T12:00:00.000Z");
  const nowSeconds = Math.floor(NOW.getTime() / 1000);

  beforeEach(() => {
    provider.calls.length = 0;
    provider.read = null;
    provider.cancel = null;
    memberContext.authError = null;
  });

  afterAll(async () => {
    if (!hasEnv) return;
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  /** Najemca z kontem u dostawcy, klientem i punktem odbioru + realna sesja. */
  async function seedTenant(label: string): Promise<Tenant> {
    const email = `l11-${label}-${randomUUID()}@test.local`;
    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (userError || !user.user) throw new Error(`createUser: ${userError?.message}`);
    createdUserIds.push(user.user.id);

    const bootstrap = await signIn(email);
    const { data: tenantId, error: tenantError } = await bootstrap
      .schema("app")
      .rpc("create_tenant", {
        p_slug: `l11-${label}-${randomUUID()}`.slice(0, 39),
        p_name: `Sklep L11 ${label}`,
      });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    createdTenantIds.push(tenantId as string);

    const accountId = `acct_${label}_${randomUUID().slice(0, 12)}`;
    const { error: accountError } = await admin
      .from("payment_accounts")
      .insert({ tenant_id: tenantId, provider_account_id: accountId });
    if (accountError) throw new Error(`payment_accounts: ${accountError.message}`);

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        tenant_id: tenantId,
        full_name: "Klient L11",
        email: `k-${randomUUID().slice(0, 8)}@test.local`,
      })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`customer: ${customerError?.message}`);

    const { data: pickup, error: pickupError } = await admin
      .from("pickup_locations")
      .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
      .select("id")
      .single();
    if (pickupError || !pickup) throw new Error(`pickup: ${pickupError.message}`);

    return {
      tenantId: tenantId as string,
      accountId,
      customerId: customer.id as string,
      pickupId: pickup.id as string,
      client: await signIn(email),
    };
  }

  /**
   * Zamówienie online związane z płatnością.
   *
   * `updated_at` wpisujemy WPROST przy INSERT — bramka `app.orders_write_gate`
   * przestawia tę kolumnę wyłącznie na UPDATE, więc to jedyna droga, żeby
   * postarzyć rekord bez wychodzenia poza PostgREST. Wiek rekordu decyduje
   * TYLKO o tym, czy pętla zamówienie wybierze (karencja).
   */
  async function seedOrder(
    tenant: Tenant,
    options: { ageMinutes?: number; depositGrosze?: number; paymentStatus?: string } = {},
  ): Promise<{ orderId: string; intentId: string }> {
    const ageMinutes = options.ageMinutes ?? 60;
    const intentId = `pi_${randomUUID().replace(/-/g, "")}`;
    const updatedAt = new Date(NOW.getTime() - ageMinutes * 60_000).toISOString();

    const { data: order, error } = await admin
      .from("orders")
      .insert({
        tenant_id: tenant.tenantId,
        customer_id: tenant.customerId,
        order_number: `L11-2026-${String(1000 + (orderSeq += 1))}`,
        start_date: "2027-03-01",
        end_date: "2027-03-03",
        delivery_method: "pickup",
        pickup_location_id: tenant.pickupId,
        order_status: "pending",
        payment_status: options.paymentStatus ?? "pending",
        payment_provider: "stripe",
        payment_method: "online",
        provider_payment_intent_id: intentId,
        total_rental_grosze: RENTAL_GROSZE,
        total_deposit_grosze: options.depositGrosze ?? 0,
        delivery_grosze: DELIVERY_GROSZE,
        updated_at: updatedAt,
      })
      .select("id")
      .single();
    if (error || !order) throw new Error(`order: ${error?.message}`);
    return { orderId: order.id as string, intentId };
  }

  async function paymentStatusOf(orderId: string): Promise<string> {
    const { data, error } = await admin
      .from("orders")
      .select("payment_status")
      .eq("id", orderId)
      .single();
    if (error) throw new Error(`odczyt zamówienia: ${error.message}`);
    return (data as { payment_status: string }).payment_status;
  }

  /** Odczyt u dostawcy dla znanych intentów; nieznany = głośny błąd. */
  function readsOf(map: Record<string, FakeIntent>) {
    return async (intentId: string) => {
      const hit = map[intentId];
      // Baza bywa współdzielona z innymi sesjami — cudze zamówienie w tej
      // samej partii ma tu POLEC, a nie dostać wymyśloną odpowiedź.
      if (!hit) throw new Error(`Odczyt spoza fixtures tego testu: ${intentId}`);
      return hit;
    };
  }

  /**
   * Odczyt ZMIENNY w czasie, ale wyłącznie dla naszego intentu.
   *
   * Zawężenie do jednego identyfikatora nie jest ozdobnikiem: baza bywa
   * współdzielona, a partia pętli obejmuje też zamówienia z wcześniejszych
   * przypadków tej suity. Atrapa odpowiadająca „to samo na wszystko"
   * odpowiadałaby cudzemu zamówieniu naszym scenariuszem i przestawiała
   * jego stan — a wtedy dowód dotyczyłby nie tego wiersza, co trzeba.
   */
  function readOnly(intentId: string, next: () => FakeIntent) {
    return async (asked: string) => {
      if (asked !== intentId) throw new Error(`Odczyt spoza fixtures tego testu: ${asked}`);
      return next();
    };
  }

  function cancelOnly(intentId: string, next: () => Promise<void>) {
    return async (asked: string) => {
      if (asked !== intentId) throw new Error(`Wygaszenie spoza fixtures tego testu: ${asked}`);
      return next();
    };
  }

  const intent = (overrides: Partial<FakeIntent> & { intentId: string }): FakeIntent => ({
    status: "succeeded",
    amountReceivedGrosze: RENTAL_GROSZE + DELIVERY_GROSZE,
    amountGrosze: RENTAL_GROSZE + DELIVERY_GROSZE,
    createdAtSeconds: nowSeconds - 30 * 60,
    ...overrides,
  });

  /** Wpis przebiegu dotyczący NASZEGO zamówienia (partia bywa wspólna). */
  function entryFor(
    result: Awaited<ReturnType<typeof reconcilePayments>>,
    orderId: string,
  ) {
    return result.entries.find((row) => row.orderId === orderId) ?? null;
  }

  const callsFor = (intentId: string) => provider.calls.filter((c) => c.intentId === intentId);

  // -------------------------------------------------------------------
  // 1. Karencja — pętla nie wyprzedza webhooka
  // -------------------------------------------------------------------

  describe("karencja 15 minut", () => {
    it("płatność sprzed MINUTY nie jest nawet odpytywana", async () => {
      const tenant = await seedTenant("karencja");
      const { orderId, intentId } = await seedOrder(tenant, { ageMinutes: 1 });
      provider.read = readsOf({ [intentId]: intent({ intentId }) });

      const result = await reconcilePayments({ db: admin, now: NOW });

      // Trzy niezależne dowody tego samego: brak wpisu, brak ruchu u dostawcy,
      // brak zmiany stanu. Sam brak wpisu przeszedłby, gdyby pętla zapytała
      // dostawcę i dopiero potem uznała zamówienie za świeże.
      expect(entryFor(result, orderId)).toBeNull();
      expect(callsFor(intentId)).toHaveLength(0);
      expect(await paymentStatusOf(orderId)).toBe("pending");
    });

    it("płatność sprzed 30 minut jest rozstrzygnięta", async () => {
      const tenant = await seedTenant("po-karencji");
      const { orderId, intentId } = await seedOrder(tenant, { ageMinutes: 30 });
      provider.read = readsOf({ [intentId]: intent({ intentId }) });

      const result = await reconcilePayments({ db: admin, now: NOW });

      expect(entryFor(result, orderId)).toMatchObject({
        outcome: "settled",
        paymentStatus: "paid",
      });
      expect(await paymentStatusOf(orderId)).toBe("paid");
    });
  });

  // -------------------------------------------------------------------
  // 2. Konto connected per najemca — wyciek pieniędzy między najemcami
  // -------------------------------------------------------------------

  describe("konto u dostawcy należy do WŁAŚCICIELA zamówienia", () => {
    it("każde zamówienie odpytane kontem SWOJEGO najemcy", async () => {
      const alfa = await seedTenant("alfa");
      const beta = await seedTenant("beta");
      const orderA = await seedOrder(alfa);
      const orderB = await seedOrder(beta);

      provider.read = readsOf({
        [orderA.intentId]: intent({ intentId: orderA.intentId }),
        [orderB.intentId]: intent({ intentId: orderB.intentId }),
      });

      await reconcilePayments({ db: admin, now: NOW });

      // Dowód jest w PARZE (intent, konto), nie w samym fakcie odczytu:
      // job pytający wszystko kontem platformy też „coś odczytał".
      expect(callsFor(orderA.intentId).map((c) => c.accountId)).toEqual([alfa.accountId]);
      expect(callsFor(orderB.intentId).map((c) => c.accountId)).toEqual([beta.accountId]);

      // I kontrola negatywna: konto najemcy NIE pojawia się przy cudzym
      // intencie ani razu.
      expect(callsFor(orderA.intentId).some((c) => c.accountId === beta.accountId)).toBe(false);
      expect(callsFor(orderB.intentId).some((c) => c.accountId === alfa.accountId)).toBe(false);
    });

    it("najemca BEZ konta u dostawcy → pominięcie z powodem, zero odczytów", async () => {
      const tenant = await seedTenant("bez-konta");
      await admin.from("payment_accounts").delete().eq("tenant_id", tenant.tenantId);
      const { orderId, intentId } = await seedOrder(tenant);
      provider.read = readsOf({ [intentId]: intent({ intentId }) });

      const result = await reconcilePayments({ db: admin, now: NOW });

      expect(entryFor(result, orderId)).toMatchObject({ outcome: "skipped" });
      expect(entryFor(result, orderId)!.reason).toContain("konta u dostawcy");
      // Brak konta NIE oznacza odczytu kontem platformy „na wszelki wypadek".
      expect(callsFor(intentId)).toHaveLength(0);
      expect(await paymentStatusOf(orderId)).toBe("pending");
    });
  });

  // -------------------------------------------------------------------
  // 3. Werdykt z ODCZYTU
  // -------------------------------------------------------------------

  describe("stan piszemy wyłącznie z odczytu", () => {
    it("succeeded z pełną kwotą → paid", async () => {
      const tenant = await seedTenant("oplacone");
      const { orderId, intentId } = await seedOrder(tenant);
      provider.read = readsOf({ [intentId]: intent({ intentId }) });

      await reconcilePayments({ db: admin, now: NOW });

      expect(await paymentStatusOf(orderId)).toBe("paid");
    });

    it("succeeded z NIEDOPŁATĄ → stan nietknięty i powód w śladzie", async () => {
      const tenant = await seedTenant("niedoplata");
      const { orderId, intentId } = await seedOrder(tenant);
      provider.read = readsOf({
        [intentId]: intent({ intentId, amountReceivedGrosze: RENTAL_GROSZE }),
      });

      const result = await reconcilePayments({ db: admin, now: NOW });

      expect(entryFor(result, orderId)).toMatchObject({ outcome: "skipped" });
      expect(await paymentStatusOf(orderId)).toBe("pending");
    });

    it("processing → stan nietknięty", async () => {
      const tenant = await seedTenant("w-toku");
      const { orderId, intentId } = await seedOrder(tenant);
      provider.read = readsOf({ [intentId]: intent({ intentId, status: "processing" }) });

      const result = await reconcilePayments({ db: admin, now: NOW });

      expect(entryFor(result, orderId)).toMatchObject({ outcome: "skipped" });
      expect(await paymentStatusOf(orderId)).toBe("pending");
    });

    it("canceled u dostawcy → payment_failed (odblokowuje anulowanie zamówienia)", async () => {
      const tenant = await seedTenant("anulowana");
      const { orderId, intentId } = await seedOrder(tenant);
      provider.read = readsOf({ [intentId]: intent({ intentId, status: "canceled" }) });

      await reconcilePayments({ db: admin, now: NOW });

      expect(await paymentStatusOf(orderId)).toBe("payment_failed");

      // Sens biznesowy całego zadania: dopiero teraz operator może anulować
      // zamówienie i zwolnić egzemplarz. Przy `pending` bramka 0010 rzuca
      // 23001, więc bez tej zmiany sprzęt stałby zablokowany na zawsze.
      const { error } = await admin
        .from("orders")
        .update({ order_status: "cancelled" })
        .eq("id", orderId);
      expect(error).toBeNull();
    });

    it("kaucja księguje się z tego samego potwierdzonego odczytu co paid", async () => {
      const tenant = await seedTenant("kaucja");
      const deposit = 15_000;
      const { orderId, intentId } = await seedOrder(tenant, { depositGrosze: deposit });
      provider.read = readsOf({
        [intentId]: intent({
          intentId,
          amountReceivedGrosze: RENTAL_GROSZE + DELIVERY_GROSZE + deposit,
          amountGrosze: RENTAL_GROSZE + DELIVERY_GROSZE + deposit,
        }),
      });

      await reconcilePayments({ db: admin, now: NOW });

      expect(await paymentStatusOf(orderId)).toBe("paid");
      const { data: events } = await admin
        .from("deposit_events")
        .select("kind, amount_grosze, provider, provider_reference")
        .eq("order_id", orderId);
      expect(events).toEqual([
        {
          kind: "collected",
          amount_grosze: deposit,
          provider: "stripe",
          provider_reference: intentId,
        },
      ]);
    });
  });

  // -------------------------------------------------------------------
  // 4. Twarde wygaszenie porzuconych — i JEGO KOLEJNOŚĆ
  // -------------------------------------------------------------------

  describe("wygaszenie płatności porzuconej", () => {
    it("intent ŚWIEŻY u dostawcy nie wygasa, choć rekord jest stary", async () => {
      // GRANICA ZAUFANIA. Rekord ma trzy dni (pętla go wybrała), ale
      // u dostawcy płatność powstała minutę temu — klient WŁAŚNIE ją
      // wpisuje. Decyzja oparta na wieku rekordu wygasiłaby ją w trakcie.
      const tenant = await seedTenant("swiezy-intent");
      const { orderId, intentId } = await seedOrder(tenant, { ageMinutes: 3 * 24 * 60 });
      provider.read = readsOf({
        [intentId]: intent({
          intentId,
          status: "requires_payment_method",
          amountReceivedGrosze: 0,
          createdAtSeconds: nowSeconds - 60,
        }),
      });

      const result = await reconcilePayments({ db: admin, now: NOW });

      expect(entryFor(result, orderId)).toMatchObject({ outcome: "skipped" });
      expect(callsFor(intentId).some((c) => c.kind === "cancel")).toBe(false);
      expect(await paymentStatusOf(orderId)).toBe("pending");
    });

    it("intent starszy niż doba → anulowanie u dostawcy, POTEM payment_failed", async () => {
      const tenant = await seedTenant("porzucona");
      const { orderId, intentId } = await seedOrder(tenant);
      let cancelled = false;
      /** Stan zamówienia W CHWILI wołania anulowania — dowód kolejności. */
      let statusWhenCancelling: string | null = null;

      provider.read = readOnly(intentId, () => ({
        intentId,
        status: cancelled ? "canceled" : "requires_payment_method",
        amountReceivedGrosze: 0,
        amountGrosze: RENTAL_GROSZE + DELIVERY_GROSZE,
        createdAtSeconds: nowSeconds - 25 * 60 * 60,
      }));
      provider.cancel = cancelOnly(intentId, async () => {
        statusWhenCancelling = await paymentStatusOf(orderId);
        cancelled = true;
      });

      const result = await reconcilePayments({ db: admin, now: NOW });

      expect(entryFor(result, orderId)).toMatchObject({ outcome: "expired" });
      expect(await paymentStatusOf(orderId)).toBe("payment_failed");
      // KOLEJNOŚĆ: w chwili anulowania NIC nie było jeszcze zapisane.
      expect(statusWhenCancelling).toBe("pending");
    });

    it("klient zapłacił sekundę przed wygaszeniem → paid, nie payment_failed", async () => {
      // Wyścig, o który chodzi w całej kolejności: anulowanie odbija się
      // błędem „już rozliczone", a ponowny odczyt mówi `succeeded`. Zapis
      // PRZED anulowaniem zostawiłby tu zamówienie w `payment_failed`
      // z pobranymi pieniędzmi klienta.
      const tenant = await seedTenant("wyscig");
      const { orderId, intentId } = await seedOrder(tenant);
      let paidAtProvider = false;

      provider.read = readOnly(intentId, () =>
        paidAtProvider
          ? {
              intentId,
              status: "succeeded",
              amountReceivedGrosze: RENTAL_GROSZE + DELIVERY_GROSZE,
              amountGrosze: RENTAL_GROSZE + DELIVERY_GROSZE,
              createdAtSeconds: nowSeconds - 25 * 60 * 60,
            }
          : {
              intentId,
              status: "requires_payment_method",
              amountReceivedGrosze: 0,
              amountGrosze: RENTAL_GROSZE + DELIVERY_GROSZE,
              createdAtSeconds: nowSeconds - 25 * 60 * 60,
            },
      );
      provider.cancel = cancelOnly(intentId, async () => {
        // Klient zapłacił tuż przed naszą próbą — dostawca odmawia.
        paidAtProvider = true;
        throw new Error(
          "You cannot cancel this PaymentIntent because it has a status of succeeded.",
        );
      });

      const result = await reconcilePayments({ db: admin, now: NOW });

      expect(entryFor(result, orderId)).toMatchObject({ outcome: "expired" });
      expect(await paymentStatusOf(orderId)).toBe("paid");
    });

    it("wygaszenie nieudane, płatność nadal żywa → ZERO zapisu", async () => {
      const tenant = await seedTenant("wygaszenie-padlo");
      const { orderId, intentId } = await seedOrder(tenant);

      provider.read = readOnly(intentId, () => ({
        intentId,
        status: "requires_payment_method",
        amountReceivedGrosze: 0,
        amountGrosze: RENTAL_GROSZE + DELIVERY_GROSZE,
        createdAtSeconds: nowSeconds - 25 * 60 * 60,
      }));
      provider.cancel = cancelOnly(intentId, async () => {
        throw new Error("Chwilowa awaria dostawcy");
      });

      const result = await reconcilePayments({ db: admin, now: NOW });

      // Płatność wciąż da się opłacić — `payment_failed` byłby tu
      // twierdzeniem o żywej płatności, że jest martwa.
      expect(entryFor(result, orderId)).toMatchObject({ outcome: "failed" });
      expect(await paymentStatusOf(orderId)).toBe("pending");
    });
  });

  // -------------------------------------------------------------------
  // 5. Akcja panelu — izolacja najemców
  // -------------------------------------------------------------------

  describe("akcja panelu „sprawdź status płatności”", () => {
    function form(orderId: string): FormData {
      const fd = new FormData();
      fd.set("orderId", orderId);
      return fd;
    }

    it("członek rozstrzyga płatność SWOJEGO zamówienia", async () => {
      const tenant = await seedTenant("akcja-wlasne");
      const { orderId, intentId } = await seedOrder(tenant, { ageMinutes: 1 });
      provider.read = readsOf({ [intentId]: intent({ intentId }) });
      memberContext.current = { tenantId: tenant.tenantId, supabase: tenant.client };

      const state = await checkPaymentStatusAction({}, form(orderId));

      // Karencji tu NIE MA — operator pyta o TERAZ (zamówienie sprzed minuty).
      expect(state.formError).toBeUndefined();
      expect(state.success).toBe("paymentChecked");
      expect(state.paymentStatus).toBe("paid");
      expect(await paymentStatusOf(orderId)).toBe("paid");
    });

    it("PRÓBA CROSS-TENANT: członek A na zamówieniu B → odmowa i ZERO zapisu", async () => {
      const alfa = await seedTenant("akcja-alfa");
      const beta = await seedTenant("akcja-beta");
      const orderB = await seedOrder(beta);
      provider.read = readsOf({ [orderB.intentId]: intent({ intentId: orderB.intentId }) });

      // Sesja członka tenanta A, identyfikator zamówienia tenanta B.
      memberContext.current = { tenantId: alfa.tenantId, supabase: alfa.client };
      const state = await checkPaymentStatusAction({}, form(orderB.orderId));

      expect(state.formError).toBe("Zamówienie nie istnieje albo zostało usunięte.");
      // Nie wystarczy kod odpowiedzi: sprawdzamy STAN zamówienia B po próbie
      // ORAZ to, że dostawca nie został o nie zapytany cudzym kontem.
      expect(await paymentStatusOf(orderB.orderId)).toBe("pending");
      expect(callsFor(orderB.intentId)).toHaveLength(0);
    });

    it("rdzeń rekoncyliacji filtruje po tenancie, nie tylko po identyfikatorze", async () => {
      // Druga zapora tej samej granicy: gdyby wołający kiedyś pomylił
      // tenanta, `reconcileOrderPayment` i tak nie znajdzie zamówienia.
      const alfa = await seedTenant("rdzen-alfa");
      const beta = await seedTenant("rdzen-beta");
      const orderB = await seedOrder(beta);
      provider.read = readsOf({ [orderB.intentId]: intent({ intentId: orderB.intentId }) });

      const entry = await reconcileOrderPayment({
        tenantId: alfa.tenantId,
        orderId: orderB.orderId,
        db: admin,
        now: NOW,
      });

      expect(entry.outcome).toBe("failed");
      expect(entry.reason).toContain("nie istnieje");
      expect(await paymentStatusOf(orderB.orderId)).toBe("pending");
      expect(callsFor(orderB.intentId)).toHaveLength(0);
    });

    it("NIEZALOGOWANY nie dosięga akcji — zero ruchu u dostawcy", async () => {
      const tenant = await seedTenant("akcja-anon");
      const { orderId, intentId } = await seedOrder(tenant);
      provider.read = readsOf({ [intentId]: intent({ intentId }) });
      memberContext.authError = "Zaloguj się, aby kontynuować.";

      const state = await checkPaymentStatusAction({}, form(orderId));

      expect(state.formError).toBe("Zaloguj się, aby kontynuować.");
      expect(callsFor(intentId)).toHaveLength(0);
      expect(await paymentStatusOf(orderId)).toBe("pending");
    });

    it("zamówienie już opłacone → komunikat neutralny, zero pytań do dostawcy", async () => {
      const tenant = await seedTenant("akcja-oplacone");
      const { orderId, intentId } = await seedOrder(tenant, { paymentStatus: "paid" });
      provider.read = readsOf({ [intentId]: intent({ intentId }) });
      memberContext.current = { tenantId: tenant.tenantId, supabase: tenant.client };

      const state = await checkPaymentStatusAction({}, form(orderId));

      expect(state.success).toBeUndefined();
      expect(state.notice).toContain("paid");
      expect(callsFor(intentId)).toHaveLength(0);
    });

    it("wynik dla UI nie niesie konta u dostawcy ani identyfikatora płatności", async () => {
      const tenant = await seedTenant("akcja-ekspozycja");
      const { orderId, intentId } = await seedOrder(tenant);
      provider.read = readsOf({ [intentId]: intent({ intentId }) });
      memberContext.current = { tenantId: tenant.tenantId, supabase: tenant.client };

      const state = await checkPaymentStatusAction({}, form(orderId));

      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain(tenant.accountId);
      expect(serialized).not.toContain(intentId);
      expect(serialized).not.toContain("acct_");
      expect(serialized).not.toContain("pi_");
    });
  });

  // -------------------------------------------------------------------
  // 6. Ślad przebiegu — bez danych klienta
  // -------------------------------------------------------------------

  it("ślad przebiegu nie niesie konta u dostawcy ani identyfikatora płatności", async () => {
    const tenant = await seedTenant("slad");
    const { orderId, intentId } = await seedOrder(tenant);
    provider.read = readsOf({ [intentId]: intent({ intentId }) });

    const result = await reconcilePayments({ db: admin, now: NOW });
    const entry = entryFor(result, orderId);

    expect(entry).not.toBeNull();
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(tenant.accountId);
    expect(serialized).not.toContain(intentId);
    // Zostają wyłącznie NASZE identyfikatory — tyle wystarczy do diagnozy.
    expect(entry!.orderId).toBe(orderId);
    expect(entry!.tenantId).toBe(tenant.tenantId);
  });
});
