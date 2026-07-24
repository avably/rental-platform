/**
 * DWA KROKI ZAMIAST JEDNEGO, NA ŻYWYM SUPABASE (uwaga właściciela N3,
 * ADR-075): tranzycja statusu i wysyłka powiadomienia są od siebie
 * niezależne, a treść wiadomości nadal ląduje w historii (regresja #124).
 *
 * ================== CO TU JEST NAPRAWDĘ URUCHOMIONE ==================
 *
 * Testy wołają PRAWDZIWE akcje serwerowe z `zamowienia/actions.ts` —
 * `changeOrderStatusAction` i wydzieloną `sendTransitionEmailAction`.
 * Zamockowana jest wyłącznie hydraulika żądania (`requireMember` czytające
 * ciasteczka i `revalidatePath`); w jej miejsce wchodzi klient z REALNĄ sesją
 * członka tenanta. Prawdziwe są: RLS 0007/0021, bramki 0010, `sendAndLog`,
 * `panelEmailLogRecorder` i zapis `email_logs.body` z 0035.
 *
 * Jedyną przechwyconą granicą jest HTTP do dostawcy poczty: `fetch` na adres
 * Resend jest podmieniony, cała reszta ruchu (PostgREST, Auth) idzie
 * normalnie. Dzięki temu „czy poszło żądanie do dostawcy” jest tu
 * POLICZALNE — a nie zakładane.
 *
 * ================== DLACZEGO NIE WYSTARCZY TEST NA ATRAPACH ==================
 *
 * `email-body-contract.test.ts` dowodzi, że `sendRentalEmailForTransition`
 * podaje treść rejestratorowi. Nie odpowiada natomiast na pytanie tego
 * zadania: czy WYDZIELONA AKCJA nadal przez tę ścieżkę idzie. Akcja, która
 * po wydzieleniu zawoła transport i rejestrator sama (np. „bo tu potrzebuję
 * innej obsługi błędu”), cofnęłaby #124 przy zielonych testach ścieżki.
 * Stąd wektor mutacyjny tej paczki: pominięcie `sendAndLog` w akcji MUSI
 * zapalić przypadek „treść wysłanej wiadomości ląduje w historii”.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** Kontekst wstrzykiwany akcjom zamiast odczytu ciasteczek. */
const memberContext = vi.hoisted(() => ({
  current: null as { tenantId: string; supabase: SupabaseClient } | null,
}));

vi.mock("@/lib/supabase-server", () => ({
  requireMember: async () => {
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
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { changeOrderStatusAction, sendTransitionEmailAction } = await import(
  "@/app/[locale]/(panel)/zamowienia/actions"
);

const { createAdminClient, seedTwoTenants, cleanupSeeded } = await import(
  "../../../packages/db/test/helpers/seed-tenants"
);

const RESEND_URL = "https://api.resend.com/emails";

let admin: SupabaseClient;
let tenantId: string;
let orderId: string;
let customerId: string;
let customerEmail: string;

/** Ładunki, które FAKTYCZNIE poszłyby do dostawcy poczty. */
let providerCalls: { html: string; subject: string; to: string[] }[] = [];
let realFetch: typeof fetch;

/** Świeże zamówienie w `pending`, własne dla każdego przypadku. */
async function seedOrder(): Promise<string> {
  const { data, error } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      start_date: "2026-09-01",
      end_date: "2026-09-03",
      // `courier`, nie `pickup`: odbiór osobisty wymaga punktu (CHECK
      // orders_pickup_requires_location), a punkt nie jest tu przedmiotem
      // dowodu.
      delivery_method: "courier",
      order_status: "pending",
      total_rental_grosze: 42_000,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`zamówienie: ${error?.message}`);
  return data.id as string;
}

async function readStatus(id: string): Promise<string> {
  const { data, error } = await admin.from("orders").select("order_status").eq("id", id).single();
  if (error) throw new Error(`odczyt statusu: ${error.message}`);
  return data.order_status as string;
}

async function readLogs(id: string) {
  const { data, error } = await admin
    .from("email_logs")
    .select("kind, status, subject, recipient, body, error")
    .eq("tenant_id", tenantId)
    .eq("order_id", id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`odczyt historii: ${error.message}`);
  return data ?? [];
}

describe.skipIf(!hasEnv)("status i wysyłka to DWA kroki (N3, ADR-075, żywy Supabase)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    const { a } = await seedTwoTenants();
    tenantId = a.tenantId;
    memberContext.current = { tenantId: a.tenantId, supabase: a.ownerClient };

    // Nadawca tenanta — bez niego wysyłka odmówiłaby z powodem konfiguracji.
    const { error: settingsError } = await admin.from("tenant_settings").insert({
      tenant_id: tenantId,
      key: "email_sender",
      value: { name: "Wypożyczalnia Demo" },
    });
    if (settingsError) throw new Error(`nadawca: ${settingsError.message}`);

    customerEmail = `n3-status-${randomUUID().slice(0, 8)}@test.local`;
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: customerEmail, full_name: "Jan Odliczanie" })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`klient: ${customerError?.message}`);
    customerId = customer.id as string;
  });

  afterAll(async () => {
    await cleanupSeeded(admin);
  });

  beforeEach(async () => {
    providerCalls = [];
    realFetch = globalThis.fetch;
    // Podmieniamy WYŁĄCZNIE ruch do dostawcy poczty — PostgREST i Auth mają
    // działać naprawdę, bo to one są tu dowodem.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(RESEND_URL)) return realFetch(input, init);
      const payload = JSON.parse(String(init?.body ?? "{}"));
      providerCalls.push({ html: payload.html, subject: payload.subject, to: payload.to });
      return new Response(JSON.stringify({ id: `resend-${randomUUID().slice(0, 8)}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubEnv("RESEND_API_KEY", "re_test_klucz_lokalny");
    orderId = await seedOrder();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("zmiana statusu SAMA nie wysyła: brak wpisu w historii i brak żądania do dostawcy", async () => {
    const result = await changeOrderStatusAction(
      {},
      formData({ orderId, to: "reserved", expectedFrom: "pending" }),
    );

    expect(result.formError).toBeUndefined();
    expect(result.success).toBe("changed");
    // Status UTRWALONY — to jest cała robota tej akcji…
    expect(await readStatus(orderId)).toBe("reserved");
    // …a klient nie dostał nic, bo nikt o to nie prosił. To jest dowód na
    // „odmowa wysyłki nie cofa przejścia”: przejście jest, wysyłki nie ma.
    expect(await readLogs(orderId)).toEqual([]);
    expect(providerCalls).toHaveLength(0);
  });

  it("dopiero wydzielona akcja wysyła — a treść wysłanej wiadomości LĄDUJE W HISTORII", async () => {
    await changeOrderStatusAction(
      {},
      formData({ orderId, to: "reserved", expectedFrom: "pending" }),
    );
    expect(await readLogs(orderId)).toEqual([]);

    const sendResult = await sendTransitionEmailAction({ orderId, status: "reserved" });
    expect(sendResult.problem).toBeUndefined();

    // Żądanie do dostawcy poszło DOKŁADNIE RAZ…
    expect(providerCalls).toHaveLength(1);
    const sent = providerCalls[0]!;
    expect(sent.to).toEqual([customerEmail]);

    const logs = await readLogs(orderId);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.kind).toBe("rental_confirmed");
    expect(logs[0]!.status).toBe("sent");
    expect(logs[0]!.recipient).toBe(customerEmail);
    expect(logs[0]!.subject).toBe(sent.subject);
    // REGRESJA #124: wpis niesie NIEPUSTĄ treść, i to tę samą, która
    // poszła do dostawcy. Ścieżka omijająca `sendAndLog` zapala tę asercję.
    expect(typeof logs[0]!.body).toBe("string");
    expect((logs[0]!.body as string).length).toBeGreaterThan(0);
    expect(logs[0]!.body).toBe(sent.html);
  });

  it("status zmieniony w oknie na cofnięcie: wysyłka ODMAWIA i nic nie wychodzi", async () => {
    await changeOrderStatusAction(
      {},
      formData({ orderId, to: "reserved", expectedFrom: "pending" }),
    );
    // Ktoś (albo sam operator) przestawia status, zanim upłynie odliczanie.
    await changeOrderStatusAction(
      {},
      formData({ orderId, to: "ready_for_pickup", expectedFrom: "reserved" }),
    );

    const sendResult = await sendTransitionEmailAction({ orderId, status: "reserved" });

    // Wiadomość „potwierdzenie rezerwacji” opisywałaby stan, którego już nie
    // ma — więc nie wychodzi, a operator dostaje powód.
    expect(sendResult.problem).toContain("zmienił się w międzyczasie");
    expect(providerCalls).toHaveLength(0);
    expect(await readLogs(orderId)).toEqual([]);
    expect(await readStatus(orderId)).toBe("ready_for_pickup");
  });

  it("nielegalne przejście: odmowa czytelna dla operatora, status w bazie nietknięty", async () => {
    // `pending → returned` nie istnieje w maszynie stanów ani w bramce 0010.
    const result = await changeOrderStatusAction(
      {},
      formData({ orderId, to: "returned", expectedFrom: "pending" }),
    );

    expect(result.formError).toBe("To przejście statusu nie jest dozwolone.");
    expect(result.success).toBeUndefined();
    expect(await readStatus(orderId)).toBe("pending");
    expect(await readLogs(orderId)).toEqual([]);
  });

  it("wysyłka bez pokrycia w bazie: cudzy identyfikator zamówienia niczego nie wysyła", async () => {
    // Akcja jest wołana WPROST z przeglądarki, więc identyfikator z żądania
    // nie może być jedynym źródłem prawdy — RLS i odczyt statusu są bramką.
    const sendResult = await sendTransitionEmailAction({
      orderId: randomUUID(),
      status: "reserved",
    });

    expect(sendResult.problem).toBeDefined();
    expect(providerCalls).toHaveLength(0);
  });
});

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
