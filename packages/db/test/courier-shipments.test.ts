/**
 * Kształty i spójność modułu dostaw (0013_courier_shipments.sql) — dowody
 * dla ADR-030 (koszt dostawy + cennik w tenant_settings) i ADR-031 (cykl
 * życia przesyłki).
 *
 * Zakres:
 *   1. CHECK-i courier_shipments: typ przesyłki, status wewnętrzny, dostawca,
 *      gabaryty — wartości spoza list/zakresów odrzucane 23514,
 *   2. FK ZŁOŻONY (tenant_id, order_id): przesyłka wskazująca zamówienie
 *      CUDZEGO tenanta jest niereprezentowalna (23503) nawet dla
 *      service_role, który omija RLS — bramka spójności z 0007,
 *   3. orders.delivery_grosze: ujemny koszt odrzucany 23514,
 *   4. CHECK-i wartości nowych kluczy tenant_settings (wzorzec
 *      order_number_prefix z 0007): wadliwe kształty odrzucane 23514
 *      U ŹRÓDŁA, poprawne przechodzą.
 *
 * Wszystkie asercje na KONKRETNYCH kodach SQLSTATE — „cokolwiek rzuciło"
 * maskowałoby np. literówkę w nazwie kolumny (42703) jako zieleń.
 * Testy idą kluczem service_role: jeśli CHECK trzyma jego, trzyma każdego.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*
 * (patrz docs/konwencje-migracji.md). Bez nich cały plik jest pomijany.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import { createAdminClient } from "./helpers/seed-tenants";

const hasEnv = integrationEnv([
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
]);

/** 23514 = check_violation, 23503 = foreign_key_violation, 23505 = unique_violation. */
const PG_CHECK_VIOLATION = "23514";
const PG_FK_VIOLATION = "23503";
const PG_UNIQUE_VIOLATION = "23505";

/** Poprawne wartości bazowe — dane FIKCYJNE (zero realnych adresów w repo). */
// Od 0024 (ADR-052) credentiale w tenant_settings to CZĘŚĆ JAWNA: hasło żyje
// zaszyfrowane w public.tenant_secrets i jest pod tym kluczem ZAKAZANE.
const VALID_CREDENTIALS = {
  email: "kurier@example.com",
  environment: "test",
};
const VALID_SENDER = {
  name: "Wypożyczalnia Testowa",
  street: "Przykładowa",
  house_number: "1",
  post_code: "00-001",
  city: "Miastko",
  phone: "+48600000000",
  email: "nadawca@example.com",
};
const VALID_PARCEL = { length_cm: 60, width_cm: 40, height_cm: 30, weight_kg: 10.5 };
const VALID_PRICING = {
  courier: { price_grosze: 2500, free_above_grosze: 50_000 },
  own_delivery: { price_grosze: 9900 },
};

describe.skipIf(!hasEnv)("moduł dostaw — 0013_courier_shipments.sql", () => {
  let admin: SupabaseClient;
  const createdTenantIds: string[] = [];

  beforeAll(() => {
    admin = createAdminClient();
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
  });

  async function createTenant(label: string): Promise<string> {
    const { data, error } = await admin
      .from("tenants")
      .insert({
        slug: `ship-${label}-${randomUUID()}`.slice(0, 39),
        name: `Courier shipments test tenant ${label}`,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createTenant(${label}): ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  /** Zamówienie-nośnik przesyłki: klient + orders w jednym kroku. */
  async function createOrder(tenantId: string): Promise<string> {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: tenantId, email: `ship-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError || !customer) {
      throw new Error(`createOrder/customer: ${customerError?.message}`);
    }

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customer.id,
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        delivery_method: "courier",
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`createOrder/order: ${orderError?.message}`);
    return order.id as string;
  }

  function validShipment(tenantId: string, orderId: string): Record<string, unknown> {
    return {
      tenant_id: tenantId,
      order_id: orderId,
      shipment_type: "outbound",
      provider_order_number: `GK-TEST-${randomUUID().slice(0, 8)}`,
      length_cm: 60,
      width_cm: 40,
      height_cm: 30,
      weight_kg: 10,
    };
  }

  describe("CHECK-i courier_shipments", () => {
    let tenantId: string;
    let orderId: string;

    beforeAll(async () => {
      tenantId = await createTenant("chk");
      orderId = await createOrder(tenantId);
    });

    it("poprawna przesyłka przechodzi (baseline — CHECK-i nie nadgorliwe)", async () => {
      const { error } = await admin
        .from("courier_shipments")
        .insert(validShipment(tenantId, orderId));
      expect(error, `INSERT poprawnej przesyłki: ${error?.message}`).toBeNull();
    });

    it.each([
      ["shipment_type spoza listy", { shipment_type: "sideways" }],
      ["status spoza listy", { status: "lost" }],
      ["dostawca spoza listy", { provider: "inny" }],
      ["pusty provider_order_number", { provider_order_number: "   " }],
      ["zerowa waga", { weight_kg: 0 }],
      ["ujemna długość", { length_cm: -1 }],
      ["ujemny koszt nadania", { price_grosze: -1 }],
    ])("%s → 23514", async (_label, patch) => {
      const { error } = await admin
        .from("courier_shipments")
        .insert({ ...validShipment(tenantId, orderId), ...patch });
      expect(error?.code, `oczekiwano 23514: ${error?.message}`).toBe(PG_CHECK_VIOLATION);
    });
  });

  // Idempotencja nadania (L5, ADR-223): claim-first opiera się o unikat CZĘŚCIOWY
  // i CHECK obecności numeru z 0091. Te dowody trzymają SCHEMAT — bramkę, o którą
  // odbija się drugie płatne wywołanie zanim zapłaci. Klucz service_role: jeśli
  // trzyma jego (omija RLS), trzyma każdego.
  describe("idempotencja nadania — 0091_courier_shipment_claim.sql (ADR-223)", () => {
    let tenantId: string;

    beforeAll(async () => {
      tenantId = await createTenant("claim");
    });

    function claim(orderId: string): Record<string, unknown> {
      return {
        tenant_id: tenantId,
        order_id: orderId,
        shipment_type: "outbound",
        status: "pending",
        length_cm: 60,
        width_cm: 40,
        height_cm: 30,
        weight_kg: 10,
      };
    }

    it("zaklepanie: status='pending' bez numeru przechodzi (presence CHECK dopuszcza)", async () => {
      const orderId = await createOrder(tenantId);
      const { error } = await admin.from("courier_shipments").insert(claim(orderId));
      expect(error, `INSERT zaklepania pending: ${error?.message}`).toBeNull();
    });

    it("presence CHECK: żywy status bez numeru → 23514", async () => {
      const orderId = await createOrder(tenantId);
      const { error } = await admin
        .from("courier_shipments")
        .insert({ ...claim(orderId), status: "created" });
      expect(error?.code, `oczekiwano 23514: ${error?.message}`).toBe(PG_CHECK_VIOLATION);
    });

    it("presence CHECK: zwolnione zaklepanie (cancelled bez numeru) przechodzi", async () => {
      const orderId = await createOrder(tenantId);
      const { error } = await admin
        .from("courier_shipments")
        .insert({ ...claim(orderId), status: "cancelled" });
      expect(error, `INSERT cancelled bez numeru: ${error?.message}`).toBeNull();
    });

    it("unikat częściowy: druga AKTYWNA przesyłka (ten sam order+typ) → 23505", async () => {
      const orderId = await createOrder(tenantId);
      const first = await admin
        .from("courier_shipments")
        .insert(validShipment(tenantId, orderId));
      expect(first.error, `pierwsza przesyłka: ${first.error?.message}`).toBeNull();

      const second = await admin
        .from("courier_shipments")
        .insert(validShipment(tenantId, orderId));
      expect(second.error?.code, `oczekiwano 23505: ${second.error?.message}`).toBe(
        PG_UNIQUE_VIOLATION,
      );
    });

    it("unikat częściowy: 'pending' też zajmuje slot — drugie zaklepanie → 23505", async () => {
      const orderId = await createOrder(tenantId);
      const first = await admin.from("courier_shipments").insert(claim(orderId));
      expect(first.error, `pierwsze zaklepanie: ${first.error?.message}`).toBeNull();
      const second = await admin.from("courier_shipments").insert(claim(orderId));
      expect(second.error?.code, `oczekiwano 23505: ${second.error?.message}`).toBe(
        PG_UNIQUE_VIOLATION,
      );
    });

    it("unikat częściowy: outbound i return TEGO SAMEGO zamówienia współistnieją", async () => {
      const orderId = await createOrder(tenantId);
      const out = await admin
        .from("courier_shipments")
        .insert({ ...validShipment(tenantId, orderId), shipment_type: "outbound" });
      expect(out.error, `outbound: ${out.error?.message}`).toBeNull();
      const ret = await admin
        .from("courier_shipments")
        .insert({ ...validShipment(tenantId, orderId), shipment_type: "return" });
      expect(ret.error, `return obok outbound: ${ret.error?.message}`).toBeNull();
    });

    it("unikat częściowy: po anulowaniu pierwszej można nadać nową (WHERE status<>cancelled)", async () => {
      const orderId = await createOrder(tenantId);
      const { data: firstRow, error: firstErr } = await admin
        .from("courier_shipments")
        .insert(validShipment(tenantId, orderId))
        .select("id")
        .single();
      expect(firstErr, `pierwsza przesyłka: ${firstErr?.message}`).toBeNull();

      const { error: cancelErr } = await admin
        .from("courier_shipments")
        .update({ status: "cancelled" })
        .eq("id", (firstRow as { id: string }).id);
      expect(cancelErr, `anulowanie: ${cancelErr?.message}`).toBeNull();

      const second = await admin
        .from("courier_shipments")
        .insert(validShipment(tenantId, orderId));
      expect(second.error, `nowa po anulowaniu: ${second.error?.message}`).toBeNull();
    });
  });

  it("FK złożony: przesyłka z tenant_id A wskazująca zamówienie tenanta B → 23503 nawet dla service_role", async () => {
    const tenantA = await createTenant("fka");
    const tenantB = await createTenant("fkb");
    const orderOfB = await createOrder(tenantB);

    // service_role omija RLS — jeśli wiersz międzytenantowy zatrzymuje się
    // tutaj, zatrzymuje go SCHEMAT (FK złożony z 0013), nie polityka.
    const { error } = await admin
      .from("courier_shipments")
      .insert(validShipment(tenantA, orderOfB));
    expect(error?.code, `oczekiwano 23503: ${error?.message}`).toBe(PG_FK_VIOLATION);
  });

  it("orders.delivery_grosze: ujemny koszt dostawy → 23514, poprawny zapisany", async () => {
    const tenantId = await createTenant("cost");
    const orderId = await createOrder(tenantId);

    const { error: negativeError } = await admin
      .from("orders")
      .update({ delivery_grosze: -1 })
      .eq("id", orderId);
    expect(negativeError?.code, `oczekiwano 23514: ${negativeError?.message}`).toBe(
      PG_CHECK_VIOLATION,
    );

    const { data, error } = await admin
      .from("orders")
      .update({ delivery_grosze: 2500 })
      .eq("id", orderId)
      .select("delivery_grosze")
      .single();
    expect(error, `UPDATE delivery_grosze: ${error?.message}`).toBeNull();
    expect(data?.delivery_grosze).toBe(2500);
  });

  describe("CHECK-i wartości kluczy konfiguracji dostaw (tenant_settings)", () => {
    let tenantId: string;

    beforeAll(async () => {
      tenantId = await createTenant("cfg");
    });

    async function insertSetting(key: string, value: unknown) {
      return admin.from("tenant_settings").insert({ tenant_id: tenantId, key, value });
    }

    it("poprawny komplet ustawień przechodzi (baseline)", async () => {
      for (const [key, value] of [
        ["globkurier_credentials", VALID_CREDENTIALS],
        ["courier_sender", VALID_SENDER],
        ["courier_parcel", VALID_PARCEL],
        ["delivery_pricing", VALID_PRICING],
      ] as const) {
        const { error } = await insertSetting(key, value);
        expect(error, `INSERT ${key}: ${error?.message}`).toBeNull();
      }
    });

    it.each([
      [
        // Odwrócenie reguły z 0013: hasło pod tym kluczem jest teraz ZAKAZANE,
        // nie wymagane (0024/ADR-052). CHECK jest zaporą przed regresem, który
        // odłożyłby sekret z powrotem do jsonb — testy szyfrowania dotyczą
        // innej tabeli i takiego cofnięcia by nie zauważyły.
        "credentiale z hasłem odłożonym jawnie",
        "globkurier_credentials",
        { ...VALID_CREDENTIALS, password: "haslo-testowe" },
      ],
      [
        "credentiale bez e-maila",
        "globkurier_credentials",
        { environment: "test" },
      ],
      [
        "credentiale ze środowiskiem spoza listy",
        "globkurier_credentials",
        { ...VALID_CREDENTIALS, environment: "prod" },
      ],
      ["credentiale jako string", "globkurier_credentials", "kurier@example.com"],
      ["nadawca bez telefonu", "courier_sender", { ...VALID_SENDER, phone: undefined }],
      ["nadawca z pustym miastem", "courier_sender", { ...VALID_SENDER, city: "  " }],
      ["paczka z zerową wagą", "courier_parcel", { ...VALID_PARCEL, weight_kg: 0 }],
      [
        "paczka z wymiarem jako string",
        "courier_parcel",
        { ...VALID_PARCEL, length_cm: "60" },
      ],
      [
        "cennik z nieznaną metodą",
        "delivery_pricing",
        { teleport: { price_grosze: 100 } },
      ],
      [
        "cennik z ujemną ceną",
        "delivery_pricing",
        { courier: { price_grosze: -1 } },
      ],
      // Brakujący klucz w jsonb to SQL NULL w jsonb_typeof — bez `is distinct
      // from`/coalesce w 0013 taki wpis przechodziłby CHECK (logika
      // trójwartościowa; ta para testów przypina poprawkę).
      ["cennik bez ceny", "delivery_pricing", { courier: { free_above_grosze: 100 } }],
      ["nadawca bez nazwy", "courier_sender", { ...VALID_SENDER, name: undefined }],
      [
        "cennik z ułamkową ceną (złote zamiast groszy)",
        "delivery_pricing",
        { courier: { price_grosze: 25.5 } },
      ],
      [
        "cennik z wadliwym progiem",
        "delivery_pricing",
        { courier: { price_grosze: 2500, free_above_grosze: "50000" } },
      ],
    ])("%s → 23514", async (_label, key, value) => {
      const { error } = await insertSetting(key, value);
      expect(error?.code, `oczekiwano 23514 dla ${key}: ${error?.message}`).toBe(
        PG_CHECK_VIOLATION,
      );
    });

    it("cennik bez progu darmowej dostawy jest legalny (pole opcjonalne)", async () => {
      const { error } = await admin.from("tenant_settings").upsert(
        {
          tenant_id: tenantId,
          key: "delivery_pricing",
          value: { parcel_locker: { price_grosze: 1500 } },
        },
        { onConflict: "tenant_id,key" },
      );
      expect(error, `upsert cennika bez progu: ${error?.message}`).toBeNull();
    });
  });
});
