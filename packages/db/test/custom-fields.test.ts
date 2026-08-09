/**
 * Pola własne (migracja 0057, ADR-118) na ŻYWYM lokalnym Supabase — realne
 * sesje, realne RLS, realne triggery.
 *
 * Suita pokrywa sześć niezależnych mechanizmów:
 *   1. IZOLACJA DEFINICJI: anon nic nie widzi, najemca nie czyta ani nie
 *      zakłada definicji u sąsiada;
 *   2. ZAPIS WARTOŚCI POD CUDZYM ID — najciekawszy wektor tego zadania. Klucz
 *      JSONB nie ma klucza obcego, więc jedyną ochroną jest jawny filtr
 *      najemcy w triggerze walidacji. Odmowa MUSI być twarda, a wiersz ofiary
 *      i wiersz atakującego mają zostać bez zmian;
 *   3. ZGODNOŚĆ Z TYPEM: siedem typów, dla każdego wartość dobra i zła —
 *      surowe API nie może zapisać śmiecia;
 *   4. ZAMROŻENIE TYPU po pierwszej wartości (z kontrolą pozytywną: na polu
 *      bez wartości typ zmienić WOLNO — inaczej test dowodziłby tylko tego,
 *      że nic nie działa);
 *   5. ARCHIWIZACJA ZAMIAST USUNIĘCIA: DELETE odmówiony, wartości po
 *      archiwizacji dalej czytelne, nowych już nie wolno dopisać;
 *   6. GRANICE RÓL: definicjami zarządza wyłącznie właściciel, ale wartości
 *      wpisuje każdy członek (inaczej lada nie mogłaby obsłużyć klienta).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { CUSTOM_FIELD_PARITY_VECTORS } from "@avably/core";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** 42501 = insufficient_privilege — odmowa z polityki RLS albo z GRANT-u. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** 22023 = invalid_parameter_value — nieistniejąca albo CUDZA definicja. */
const PG_INVALID_PARAMETER = "22023";
/** 23514 = check_violation — wartość niezgodna z definicją / zamrożenie. */
const PG_CHECK_VIOLATION = "23514";

const TEST_PASSWORD = "CustomFieldsTest!12345678";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

const createAdminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createAnonClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

async function createUser(admin: SupabaseClient, label: string): Promise<{ email: string; id: string }> {
  const email = `cfields-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { email, id: data.user.id };
}

async function createTenantWithOwner(
  admin: SupabaseClient,
  label: string,
): Promise<{ tenantId: string; ownerClient: SupabaseClient }> {
  const owner = await createUser(admin, `owner-${label}`);
  const bootstrap = await signIn(owner.email);
  const { data: tenantId, error } = await bootstrap.schema("app").rpc("create_tenant", {
    p_slug: `cfields-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja pól własnych ${label}`,
  });
  if (error) throw new Error(`create_tenant(${label}): ${error.message}`);
  createdTenantIds.push(tenantId as string);
  return { tenantId: tenantId as string, ownerClient: await signIn(owner.email) };
}

type DefinitionInput = {
  entity?: "customer" | "order" | "product";
  field_type: string;
  label?: string;
  options?: unknown;
  required?: boolean;
  position?: number;
};

async function insertDefinition(
  client: SupabaseClient,
  tenantId: string,
  input: DefinitionInput,
): Promise<string> {
  const { data, error } = await client
    .from("custom_field_definitions")
    .insert({
      tenant_id: tenantId,
      entity: input.entity ?? "customer",
      field_type: input.field_type,
      label: input.label ?? `Pole ${input.field_type} ${randomUUID().slice(0, 8)}`,
      options: input.options ?? [],
      required: input.required ?? false,
      position: input.position ?? 0,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertDefinition(${input.field_type}): ${error?.message}`);
  return data.id as string;
}

async function insertCustomer(
  client: SupabaseClient,
  tenantId: string,
  customFields: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await client
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email: `klient-${randomUUID()}@test.local`,
      full_name: "Klient testowy",
      custom_fields: customFields,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insertCustomer: ${error?.message}`);
  return data.id as string;
}

describe.skipIf(!hasEnv)("pola własne (0057, ADR-118)", () => {
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let tenantA: string;
  let tenantB: string;
  let ownerA: SupabaseClient;
  let ownerB: SupabaseClient;
  let staffA: SupabaseClient;

  /** Definicje tenanta A — po jednej na każdy z siedmiu typów. */
  const defA: Record<string, string> = {};
  /** Definicja tenanta B — cel ataku „zapis pod cudzym ID". */
  let defB: string;
  /** Definicja A przypięta do ZAMÓWIENIA (dowód filtra encji). */
  let defAOrder: string;

  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();

    ({ tenantId: tenantA, ownerClient: ownerA } = await createTenantWithOwner(admin, "a"));
    ({ tenantId: tenantB, ownerClient: ownerB } = await createTenantWithOwner(admin, "b"));

    // Zwykły członek A — bohater dowodu granicy ról. MUSI być członkiem,
    // inaczej odmowa pochodziłaby z izolacji najemców, a nie z bramki roli.
    const staff = await createUser(admin, "staff-a");
    const { error: memberError } = await admin
      .from("members")
      .insert({ tenant_id: tenantA, user_id: staff.id, role: "staff" });
    if (memberError) throw new Error(`insert members(staff): ${memberError.message}`);
    await admin.auth.admin.updateUserById(staff.id, {
      app_metadata: { tenant_id: tenantA, role: "staff" },
    });
    staffA = await signIn(staff.email);

    for (const type of [
      "text",
      "textarea",
      "number",
      "date",
      "select",
      "checkbox",
      "phone",
    ] as const) {
      defA[type] = await insertDefinition(ownerA, tenantA, {
        field_type: type,
        options: type === "select" ? ["Alfa", "Beta"] : [],
      });
    }
    defAOrder = await insertDefinition(ownerA, tenantA, { entity: "order", field_type: "text" });
    defB = await insertDefinition(ownerB, tenantB, { field_type: "text", label: "Pole B" });
  }, 90_000);

  afterAll(async () => {
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  // -------------------------------------------------------------------
  // 1. Izolacja definicji
  // -------------------------------------------------------------------

  describe("izolacja definicji", () => {
    it("anon nie czyta definicji ani nie pyta o ich użycie", async () => {
      const { data, error } = await anon.from("custom_field_definitions").select("id");
      // Brak grantu dla anona: odmowa albo pusty zbiór — nigdy wiersz.
      if (!error) expect(data ?? []).toHaveLength(0);
      else expect(error.code).toBe(PG_INSUFFICIENT_PRIVILEGE);

      const inUse = await anon.schema("app").rpc("custom_fields_in_use");
      expect(inUse.error, "anon nie ma prawa wykonania funkcji").not.toBeNull();
    });

    it("najemca nie widzi definicji sąsiada", async () => {
      const { data, error } = await ownerB.from("custom_field_definitions").select("id, label");
      expect(error).toBeNull();
      const ids = (data ?? []).map((row) => row.id as string);
      expect(ids).toContain(defB);
      for (const id of Object.values(defA)) expect(ids).not.toContain(id);
    });

    it("najemca nie założy definicji na cudzym najemcy", async () => {
      const { error } = await ownerA.from("custom_field_definitions").insert({
        tenant_id: tenantB,
        entity: "customer",
        field_type: "text",
        label: `Podrzucone ${randomUUID().slice(0, 8)}`,
      });
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);

      const { count } = await admin
        .from("custom_field_definitions")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantB);
      expect(count, "u sąsiada nie przybyło definicji").toBe(1);
    });

    it("app.custom_fields_in_use widzi wyłącznie własne dane", async () => {
      const customerId = await insertCustomer(ownerA, tenantA, { [defA.text!]: "W użyciu" });

      const mine = await ownerA.schema("app").rpc("custom_fields_in_use");
      expect(mine.error).toBeNull();
      expect((mine.data as { definition_id: string }[]).map((r) => r.definition_id)).toContain(
        defA.text,
      );

      const theirs = await ownerB.schema("app").rpc("custom_fields_in_use");
      expect(theirs.error).toBeNull();
      expect((theirs.data as { definition_id: string }[]).map((r) => r.definition_id)).not.toContain(
        defA.text,
      );

      await admin.from("customers").delete().eq("id", customerId);
    });
  });

  // -------------------------------------------------------------------
  // 2. Zapis wartości pod CUDZYM identyfikatorem definicji
  // -------------------------------------------------------------------

  describe("wartość pod cudzą definicją", () => {
    it("odmawia zapisu pod ID definicji sąsiada — i nie rusza żadnego wiersza", async () => {
      const before = await admin
        .from("custom_field_definitions")
        .select("*")
        .eq("id", defB)
        .single();
      expect(before.error).toBeNull();

      const { error } = await ownerA.from("customers").insert({
        tenant_id: tenantA,
        email: `atak-${randomUUID()}@test.local`,
        full_name: "Atakujący",
        custom_fields: { [defB]: "wartość pod cudzym kluczem" },
      });

      // 22023, nie 42501: definicja nie istnieje W TYM najemcy. Rozróżnienie
      // „cudza" od „nieistniejąca" zdradzałoby, co u sąsiada jest.
      expect(error?.code).toBe(PG_INVALID_PARAMETER);

      // ZERO ZMIAN u ofiary…
      const after = await admin
        .from("custom_field_definitions")
        .select("*")
        .eq("id", defB)
        .single();
      expect(after.data).toEqual(before.data);

      // …i zero śladu u atakującego: wiersz nie powstał wcale.
      const { data: rows } = await admin
        .from("customers")
        .select("id")
        .eq("tenant_id", tenantA)
        .not("custom_fields", "eq", "{}");
      for (const row of rows ?? []) {
        const { data: full } = await admin
          .from("customers")
          .select("custom_fields")
          .eq("id", row.id as string)
          .single();
        expect(Object.keys((full?.custom_fields ?? {}) as object)).not.toContain(defB);
      }
    });

    it("odmawia zapisu pod cudzym ID TAKŻE ścieżką z wyłączonym RLS", async () => {
      // TO JEST właściwy dowód jawnego filtra `tenant_id = new.tenant_id`
      // w triggerze. Dla sesji najemcy odmowę dałaby także RLS na tabeli
      // definicji — czyli test wykonany wyłącznie sesją NIE dowodziłby
      // niczego o filtrze (sprawdzone mutacją: zdjęcie filtra zostawiało
      // taki test zielony). Ścieżki, które RLS mają wyłączone, to
      // `service_role` ORAZ funkcje SECURITY DEFINER, którymi pisze
      // storefront (app.public_checkout wpisze pola własne zamówienia
      // w części 2) — tam filtr w triggerze jest JEDYNĄ ochroną.
      const { error } = await admin.from("customers").insert({
        tenant_id: tenantA,
        email: `bypass-${randomUUID()}@test.local`,
        full_name: "Ścieżka bez RLS",
        custom_fields: { [defB]: "wartość pod cudzym kluczem" },
      });
      expect(error?.code).toBe(PG_INVALID_PARAMETER);

      const { count } = await admin
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantA)
        .eq("full_name", "Ścieżka bez RLS");
      expect(count, "wiersz powstał mimo odmowy").toBe(0);
    });

    it("nie jest wyrocznią o danych sąsiada, gdy wiersz NIESIE cudzy tenant_id", async () => {
      // Wyzwalacze BEFORE ROW wykonują się PRZED sprawdzeniem WITH CHECK
      // polityki RLS, a `new.tenant_id` to na tym etapie WCIĄŻ wartość od
      // wołającego. Bez bramki najemcy w triggerze członek A mógł wysłać
      // wiersz z `tenant_id` najemcy B i — mimo że zapis i tak kończył się
      // odmową — ODCZYTAĆ z kodu i treści odmowy, czy definicja u B istnieje,
      // jakiego jest typu i (opcja po opcji) co ma na liście. Zapis był
      // niemożliwy, ODCZYT przez kanał błędu jak najbardziej.
      const probes = [
        { label: "cudza definicja, wartość poprawna", key: defB, value: "cokolwiek" },
        { label: "cudza definicja, wartość złego typu", key: defB, value: 12345 },
        { label: "identyfikator nieistniejący", key: randomUUID(), value: "cokolwiek" },
      ];

      const codes = new Set<string | undefined>();
      for (const probe of probes) {
        const { error } = await ownerA.from("customers").insert({
          tenant_id: tenantB,
          email: `wyrocznia-${randomUUID()}@test.local`,
          full_name: "Sonda",
          custom_fields: { [probe.key]: probe.value },
        });
        expect(error, `${probe.label}: zapis przeszedł`).not.toBeNull();
        codes.add(error?.code);
      }

      // Wszystkie trzy sondy muszą dać JEDNĄ odpowiedź, i to tę samą, którą
      // odda RLS — inaczej różnica sama w sobie jest odczytem.
      expect([...codes], "odmowy się różnią — kanał błędu jest wyrocznią").toEqual([
        PG_INSUFFICIENT_PRIVILEGE,
      ]);

      const { count } = await admin
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantB)
        .eq("full_name", "Sonda");
      expect(count, "u sąsiada powstał wiersz").toBe(0);
    });

    it("odmawia zapisu pod definicją INNEJ ENCJI tego samego najemcy", async () => {
      // Definicja zamówienia nie może opisać wartości zapisanej na kliencie —
      // inaczej etykieta i typ pochodziłyby z formularza, którego ten wiersz
      // nigdy nie widział.
      const { error } = await ownerA.from("customers").insert({
        tenant_id: tenantA,
        email: `encja-${randomUUID()}@test.local`,
        full_name: "Zła encja",
        custom_fields: { [defAOrder]: "wartość" },
      });
      expect(error?.code).toBe(PG_INVALID_PARAMETER);
    });

    it("odmawia klucza, który nie jest identyfikatorem definicji", async () => {
      for (const key of ["numer_uprawnien", "", "123", defA.text!.toUpperCase()]) {
        const { error } = await ownerA.from("customers").insert({
          tenant_id: tenantA,
          email: `klucz-${randomUUID()}@test.local`,
          full_name: "Zły klucz",
          custom_fields: { [key]: "x" },
        });
        expect(error?.code, `klucz "${key}" przeszedł`).toBe(PG_INVALID_PARAMETER);
      }
    });

    it("nie da się podmienić wartości na wierszu sąsiada (odmowa i zero zmian)", async () => {
      const victimId = await insertCustomer(ownerB, tenantB, { [defB]: "wartość ofiary" });
      const before = await admin.from("customers").select("*").eq("id", victimId).single();

      const { data: updated } = await ownerA
        .from("customers")
        .update({ custom_fields: { [defB]: "podmienione" } })
        .eq("id", victimId)
        .select("id");
      expect(updated ?? []).toHaveLength(0);

      const after = await admin.from("customers").select("*").eq("id", victimId).single();
      expect(after.data).toEqual(before.data);

      await admin.from("customers").delete().eq("id", victimId);
    });
  });

  // -------------------------------------------------------------------
  // 3. Zgodność wartości z typem
  // -------------------------------------------------------------------

  describe("zgodność wartości z typem definicji", () => {
    const good: Record<string, unknown> = {
      text: "Numer uprawnień 123",
      textarea: "Linia 1\nLinia 2",
      number: 1234.5,
      date: "2026-08-09",
      select: "Beta",
      checkbox: true,
      phone: "+48 501 234 567",
    };
    const bad: Record<string, unknown> = {
      text: 42,
      textarea: false,
      number: "1234",
      date: "2026-02-31",
      select: "Gamma",
      checkbox: "tak",
      phone: "nie-telefon",
    };

    for (const type of Object.keys(good)) {
      it(`typ ${type}: przyjmuje wartość zgodną, odrzuca niezgodną`, async () => {
        const okId = await insertCustomer(ownerA, tenantA, { [defA[type]!]: good[type] });
        const { data: stored } = await admin
          .from("customers")
          .select("custom_fields")
          .eq("id", okId)
          .single();
        // Wartość wraca TYPOWANA — nie jako string. Na tym stoi cała
        // przewaga modelu: filtr i sortowanie w części 2 będą tanie.
        expect((stored?.custom_fields as Record<string, unknown>)[defA[type]!]).toEqual(good[type]);
        await admin.from("customers").delete().eq("id", okId);

        const { error } = await ownerA.from("customers").insert({
          tenant_id: tenantA,
          email: `zly-${type}-${randomUUID()}@test.local`,
          full_name: "Zła wartość",
          custom_fields: { [defA[type]!]: bad[type] },
        });
        expect(error?.code, `typ ${type} wpuścił śmieć`).toBe(PG_CHECK_VIOLATION);
      });
    }

    it("odrzuca pustkę zapisaną JSON-owym null-em (jedna reprezentacja braku)", async () => {
      const { error } = await ownerA.from("customers").insert({
        tenant_id: tenantA,
        email: `null-${randomUUID()}@test.local`,
        full_name: "Null",
        custom_fields: { [defA.text!]: null },
      });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("odrzuca znaki sterujące w wartości tekstowej", async () => {
      const { error } = await ownerA.from("customers").insert({
        tenant_id: tenantA,
        email: `ctrl-${randomUUID()}@test.local`,
        full_name: "Sterujące",
        custom_fields: { [defA.text!]: `a${String.fromCharCode(1)}b` },
      });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("odrzuca mapę większą niż limit kolumny", async () => {
      const { error } = await ownerA.from("customers").insert({
        tenant_id: tenantA,
        email: `duze-${randomUUID()}@test.local`,
        full_name: "Za duże",
        custom_fields: { [defA.textarea!]: "ą".repeat(5000) },
      });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("aktualizacja NIEDOTYKAJĄCA pól własnych przechodzi bez walidacji", async () => {
      // Warunek poprawności, nie optymalizacja: po zarchiwizowaniu definicji
      // zwykła edycja wiersza musi dalej działać.
      const customerId = await insertCustomer(ownerA, tenantA, { [defA.text!]: "wartość" });
      const archived = await insertDefinition(ownerA, tenantA, { field_type: "text" });
      await ownerA
        .from("customers")
        .update({ custom_fields: { [defA.text!]: "wartość", [archived]: "druga" } })
        .eq("id", customerId);
      await ownerA
        .from("custom_field_definitions")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", archived);

      const { error } = await ownerA
        .from("customers")
        .update({ full_name: "Nowe imię" })
        .eq("id", customerId);
      expect(error, "archiwizacja zablokowała niezwiązaną edycję").toBeNull();

      await admin.from("customers").delete().eq("id", customerId);
    });
  });

  // -------------------------------------------------------------------
  // 4. Zamrożenie typu
  // -------------------------------------------------------------------

  describe("zamrożenie typu po pierwszej wartości", () => {
    it("typ pola BEZ wartości wolno zmienić (kontrola pozytywna)", async () => {
      const id = await insertDefinition(ownerA, tenantA, { field_type: "text" });
      const { error } = await ownerA
        .from("custom_field_definitions")
        .update({ field_type: "number" })
        .eq("id", id);
      expect(error, "zamrożenie zadziałało za wcześnie").toBeNull();
      await admin.from("custom_field_definitions").delete().eq("id", id);
    });

    it("typ pola Z wartością jest zamrożony", async () => {
      const id = await insertDefinition(ownerA, tenantA, { field_type: "text" });
      const customerId = await insertCustomer(ownerA, tenantA, { [id]: "zapisana wartość" });

      const { error } = await ownerA
        .from("custom_field_definitions")
        .update({ field_type: "number" })
        .eq("id", id);
      expect(error?.code).toBe(PG_CHECK_VIOLATION);

      const { data } = await admin
        .from("custom_field_definitions")
        .select("field_type")
        .eq("id", id)
        .single();
      expect(data?.field_type).toBe("text");

      await admin.from("customers").delete().eq("id", customerId);
      await admin.from("custom_field_definitions").delete().eq("id", id);
    });

    it("encja jest niezmienna zawsze, także na polu bez wartości", async () => {
      const id = await insertDefinition(ownerA, tenantA, { field_type: "text" });
      const { error } = await ownerA
        .from("custom_field_definitions")
        .update({ entity: "product" })
        .eq("id", id);
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
      await admin.from("custom_field_definitions").delete().eq("id", id);
    });

    it("opcji używanej listy wyboru nie da się usunąć, ale wolno dołożyć", async () => {
      const id = await insertDefinition(ownerA, tenantA, {
        field_type: "select",
        options: ["Alfa", "Beta"],
      });
      const customerId = await insertCustomer(ownerA, tenantA, { [id]: "Beta" });

      const narrowed = await ownerA
        .from("custom_field_definitions")
        .update({ options: ["Alfa"] })
        .eq("id", id);
      expect(narrowed.error?.code).toBe(PG_CHECK_VIOLATION);

      const widened = await ownerA
        .from("custom_field_definitions")
        .update({ options: ["Alfa", "Beta", "Gamma"] })
        .eq("id", id);
      expect(widened.error, "dołożenie opcji zostało zablokowane").toBeNull();

      await admin.from("customers").delete().eq("id", customerId);
      await admin.from("custom_field_definitions").delete().eq("id", id);
    });

    it("odrzuca listę wyboru o złym kształcie (pusta, duplikaty, nie-tekst)", async () => {
      for (const options of [[], ["Alfa", "alfa"], [1, 2], ["Alfa", ""]]) {
        const { error } = await ownerA.from("custom_field_definitions").insert({
          tenant_id: tenantA,
          entity: "customer",
          field_type: "select",
          label: `Select ${randomUUID().slice(0, 8)}`,
          options,
        });
        expect(error?.code, `opcje ${JSON.stringify(options)} przeszły`).toBe(PG_CHECK_VIOLATION);
      }
    });
  });

  // -------------------------------------------------------------------
  // 5. Archiwizacja zamiast usunięcia
  // -------------------------------------------------------------------

  describe("archiwizacja zamiast usunięcia", () => {
    it("właściciel NIE MOŻE usunąć definicji — zostaje w bazie", async () => {
      const id = await insertDefinition(ownerA, tenantA, { field_type: "text" });

      const { error, data } = await ownerA
        .from("custom_field_definitions")
        .delete()
        .eq("id", id)
        .select("id");
      if (!error) expect(data ?? [], "usunięcie przeszło po cichu").toHaveLength(0);
      else expect(error.code).toBe(PG_INSUFFICIENT_PRIVILEGE);

      const { count } = await admin
        .from("custom_field_definitions")
        .select("id", { count: "exact", head: true })
        .eq("id", id);
      expect(count, "definicja zniknęła — los danych przestał być zdefiniowany").toBe(1);

      await admin.from("custom_field_definitions").delete().eq("id", id);
    });

    it("po archiwizacji wartości zostają czytelne, nowych dopisać nie wolno, usunąć wolno", async () => {
      const id = await insertDefinition(ownerA, tenantA, { field_type: "text" });
      const withValue = await insertCustomer(ownerA, tenantA, { [id]: "stara wartość" });

      const { error: archiveError } = await ownerA
        .from("custom_field_definitions")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      expect(archiveError).toBeNull();

      // (a) wartość dalej czytelna
      const { data: stored } = await ownerA
        .from("customers")
        .select("custom_fields")
        .eq("id", withValue)
        .single();
      expect((stored?.custom_fields as Record<string, unknown>)[id]).toBe("stara wartość");

      // (b) NOWA wartość pod zarchiwizowaną definicją — odmowa
      const { error: freshError } = await ownerA.from("customers").insert({
        tenant_id: tenantA,
        email: `arch-${randomUUID()}@test.local`,
        full_name: "Po archiwizacji",
        custom_fields: { [id]: "nowa wartość" },
      });
      expect(freshError?.code).toBe(PG_CHECK_VIOLATION);

      // (c) ZMIANA istniejącej wartości — odmowa
      const { error: changeError } = await ownerA
        .from("customers")
        .update({ custom_fields: { [id]: "podmieniona" } })
        .eq("id", withValue);
      expect(changeError?.code).toBe(PG_CHECK_VIOLATION);

      // (d) USUNIĘCIE klucza — dozwolone, bo inaczej usunięcie danych
      // klienta (ADR-116) trafiałoby na ścianę.
      const { error: clearError } = await ownerA
        .from("customers")
        .update({ custom_fields: {} })
        .eq("id", withValue);
      expect(clearError, "usunięcie wartości zablokowane").toBeNull();

      await admin.from("customers").delete().eq("id", withValue);
      await admin.from("custom_field_definitions").delete().eq("id", id);
    });

    it("powtórka usunięcia czyści pola własne dopisane PO anonimizacji", async () => {
      // W 0056 wszystkie redagowane kolumny były związane schematem, więc
      // wiersz raz zanonimizowany nie mógł ponownie nabrać danych osobowych
      // i powtórka mogła być czystym no-opem. 0057 dokłada do TYCH SAMYCH
      // wierszy kolumnę na dowolną treść operatora — gdyby czyszczenie
      // zostało za wczesnym wyjściem, treść wpisana po anonimizacji byłaby
      // z panelu nieusuwalna.
      const definition = await insertDefinition(ownerA, tenantA, { field_type: "text" });
      const customerId = await insertCustomer(ownerA, tenantA);
      const { error: orderError } = await ownerA.from("orders").insert({
        tenant_id: tenantA,
        customer_id: customerId,
        start_date: "2026-08-01",
        end_date: "2026-08-03",
        delivery_method: "courier",
      });
      expect(orderError).toBeNull();

      // Pierwsze usunięcie → anonimizacja (klient ma zamówienie).
      const first = await ownerA.schema("app").rpc("erase_customer", {
        p_customer_id: customerId,
      });
      expect(first.error).toBeNull();
      expect((first.data as { mode: string }).mode).toBe("anonymized");

      // Operator wpisuje dane osobowe do pola własnego JUŻ PO anonimizacji.
      const { error: writeError } = await ownerA
        .from("customers")
        .update({ custom_fields: { [definition]: "numer telefonu wpisany po fakcie" } })
        .eq("id", customerId);
      expect(writeError, "zapis po anonimizacji jest możliwy — i o to chodzi w tym teście").toBeNull();

      // Powtórka MUSI to zabrać (i policzyć profil, nie tylko zamówienia).
      const second = await ownerA.schema("app").rpc("erase_customer", {
        p_customer_id: customerId,
      });
      expect(second.error).toBeNull();
      expect((second.data as { mode: string }).mode).toBe("already_anonymized");
      expect((second.data as { custom_fields: number }).custom_fields).toBe(1);

      const { data: after } = await admin
        .from("customers")
        .select("custom_fields")
        .eq("id", customerId)
        .single();
      expect(after?.custom_fields, "dane osobowe zostały w polu własnym").toEqual({});

      await admin.from("customers").delete().eq("id", customerId);
      await admin.from("custom_field_definitions").delete().eq("id", definition);
    });

    it("usunięcie danych klienta czyści też pola własne (art. 17, ADR-116)", async () => {
      const definition = await insertDefinition(ownerA, tenantA, { field_type: "text" });
      const customerId = await insertCustomer(ownerA, tenantA, {
        [definition]: "PESEL wpisany w polu własnym",
      });

      const { error } = await ownerA.schema("app").rpc("erase_customer", {
        p_customer_id: customerId,
      });
      expect(error).toBeNull();

      const { count } = await admin
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("id", customerId);
      // Klient bez zamówień znika w całości — razem z polami własnymi.
      expect(count).toBe(0);

      await admin.from("custom_field_definitions").delete().eq("id", definition);
    });
  });

  // -------------------------------------------------------------------
  // 6. Granice ról
  // -------------------------------------------------------------------

  describe("granice ról", () => {
    it("zwykły członek CZYTA definicje", async () => {
      const { data, error } = await staffA.from("custom_field_definitions").select("id");
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id as string)).toContain(defA.text);
    });

    it("zwykły członek NIE zakłada, NIE zmienia i NIE archiwizuje definicji", async () => {
      const insert = await staffA.from("custom_field_definitions").insert({
        tenant_id: tenantA,
        entity: "customer",
        field_type: "text",
        label: `Członek ${randomUUID().slice(0, 8)}`,
      });
      expect(insert.error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);

      const { data: updated } = await staffA
        .from("custom_field_definitions")
        .update({ label: "Przejęte" })
        .eq("id", defA.text!)
        .select("id");
      expect(updated ?? [], "członek zmienił definicję").toHaveLength(0);

      const { data: fresh } = await admin
        .from("custom_field_definitions")
        .select("label")
        .eq("id", defA.text!)
        .single();
      expect(fresh?.label).not.toBe("Przejęte");
    });

    it("zwykły członek WPISUJE wartości pól własnych", async () => {
      // Granica jest tu świadoma: definicje to konfiguracja organizacji,
      // ale wypełnianie formularza to codzienna praca lady.
      const { data, error } = await staffA
        .from("customers")
        .insert({
          tenant_id: tenantA,
          email: `lada-${randomUUID()}@test.local`,
          full_name: "Klient lady",
          custom_fields: { [defA.text!]: "wpisane przez ladę" },
        })
        .select("id")
        .single();
      expect(error, `lada nie mogła zapisać wartości: ${error?.message}`).toBeNull();
      await admin.from("customers").delete().eq("id", (data as { id: string }).id);
    });
  });

  // -------------------------------------------------------------------
  // 7. Parytet z rdzeniem — TE SAME wektory, PRAWDZIWY trigger
  // -------------------------------------------------------------------

  describe("parytet ze wspólnymi wektorami (lustro @avably/core)", () => {
    // Zestaw jest JEDEN (@avably/core/custom-fields/vectors) i jedzie tu przez
    // trigger 0057, a w suicie rdzenia przez validateCustomFieldValues.
    // Wcześniej obie strony miały WŁASNE wektory — i to właśnie ta duplikacja
    // przepuściła telefon bez cyfr („+()-()") oraz liczbę 1e-7: każda strona
    // testowała to, co sama umiała.
    const definitions = new Map<string, string>();

    async function definitionFor(
      type: string,
      options: readonly string[] | undefined,
    ): Promise<string> {
      const key = `${type}:${JSON.stringify(options ?? [])}`;
      const known = definitions.get(key);
      if (known) return known;
      const id = await insertDefinition(ownerA, tenantA, {
        field_type: type,
        options: options ? [...options] : [],
      });
      definitions.set(key, id);
      return id;
    }

    it("zestaw nie jest pusty (asercja anty-pustkowa)", () => {
      expect(CUSTOM_FIELD_PARITY_VECTORS.length).toBeGreaterThanOrEqual(30);
      expect(CUSTOM_FIELD_PARITY_VECTORS.some((v) => v.valid)).toBe(true);
      expect(CUSTOM_FIELD_PARITY_VECTORS.some((v) => !v.valid)).toBe(true);
    });

    for (const vector of CUSTOM_FIELD_PARITY_VECTORS) {
      it(`${vector.name} → ${vector.valid ? "przyjęta" : "odrzucona"}`, async () => {
        const definitionId = await definitionFor(vector.type, vector.options);
        const { data, error } = await ownerA
          .from("customers")
          .insert({
            tenant_id: tenantA,
            email: `parytet-${randomUUID()}@test.local`,
            full_name: "Parytet",
            custom_fields: { [definitionId]: vector.value },
          })
          .select("id");

        if (vector.valid) {
          expect(error, `${vector.name}: baza odrzuciła wartość uznaną za poprawną`).toBeNull();
          await admin.from("customers").delete().eq("id", (data as { id: string }[])[0]!.id);
        } else {
          expect(error?.code, `${vector.name}: baza przyjęła wartość uznaną za błędną`).toBe(
            PG_CHECK_VIOLATION,
          );
        }
      });
    }
  });
});
