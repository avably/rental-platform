/**
 * Kształt klucza tenant_settings.email_sender (0014_email_sender.sql) —
 * dowody dla ADR-033 (nadawca e-maili cyklu najmu).
 *
 * Zakres:
 *   1. CHECK wartości email_sender (wzorzec order_number_prefix z 0007 i
 *      kluczy kurierskich z 0013): wadliwe kształty odrzucane 23514
 *      U ŹRÓDŁA, przy zapisie ustawienia — a nie dopiero przy wysyłce,
 *      błędem, którego PostgREST nie umie pokazać,
 *   2. PUŁAPKA NULL: brak wymaganego klucza w jsonb daje SQL NULL, a CHECK
 *      z wynikiem NULL PRZECHODZI — dlatego koniunkcja jest owinięta
 *      w coalesce(..., false). Bez tego nadawca BEZ nazwy przechodziłby
 *      bramkę, mimo że nazwa złego typu już nie (ta sama pułapka co
 *      strażnik `reason_code is not null` w 0011 i credentiale w 0013).
 *
 * Adres nadawcy NIE jest tu walidowany, bo nie jest daną tenanta: pole From
 * składa się ze stałej platformy (RESEND_FROM_EMAIL) i nazwy tenanta —
 * patrz ADR-033. Tenant konfiguruje nazwę i opcjonalny reply_to.
 *
 * Wszystkie asercje na KONKRETNYM kodzie SQLSTATE — „cokolwiek rzuciło"
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

/** 23514 = check_violation. */
const PG_CHECK_VIOLATION = "23514";

describe.skipIf(!hasEnv)("nadawca e-maili — 0014_email_sender.sql", () => {
  let admin: SupabaseClient;
  let tenantId: string;
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    admin = createAdminClient();
    const { data, error } = await admin
      .from("tenants")
      .insert({
        slug: `mail-${randomUUID()}`.slice(0, 39),
        name: "Email sender test tenant",
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`createTenant: ${error?.message}`);
    tenantId = data.id as string;
    createdTenantIds.push(tenantId);
  });

  afterAll(async () => {
    for (const id of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", id);
    }
  });

  function upsertSender(value: unknown) {
    return admin
      .from("tenant_settings")
      .upsert({ tenant_id: tenantId, key: "email_sender", value });
  }

  it("odrzuca email_sender bez name (pułapka NULL w jsonb)", async () => {
    const { error } = await upsertSender({ reply_to: "kontakt@example.com" });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("odrzuca name złożone z samych spacji", async () => {
    const { error } = await upsertSender({ name: "   " });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("odrzuca name o złym typie", async () => {
    const { error } = await upsertSender({ name: 42 });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("odrzuca reply_to o złym typie", async () => {
    const { error } = await upsertSender({ name: "Demo", reply_to: 42 });
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("odrzuca wartość, która nie jest obiektem", async () => {
    const { error } = await upsertSender("Wypożyczalnia Demo");
    expect(error?.code).toBe(PG_CHECK_VIOLATION);
  });

  it("przyjmuje nadawcę bez reply_to", async () => {
    const { error } = await upsertSender({ name: "Wypożyczalnia Demo" });
    expect(error).toBeNull();
  });

  it("przyjmuje nadawcę z reply_to", async () => {
    const { error } = await upsertSender({
      name: "Wypożyczalnia Demo",
      reply_to: "kontakt@example.com",
    });
    expect(error).toBeNull();
  });

  it("nie rusza innych kluczy tenant_settings", async () => {
    const { error } = await admin
      .from("tenant_settings")
      .upsert({ tenant_id: tenantId, key: "currency", value: "PLN" });
    expect(error).toBeNull();
  });
});
