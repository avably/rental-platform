/**
 * Z7 / ADR-061 — prywatne, niezmienne umowy per tenant.
 *
 * Najważniejszy wektor jest niezależny od route handlera: sesja A dostaje
 * wprost document_id i storage_path B, po czym pyta PostgREST i Storage.
 * Obie odpowiedzi mają zostać odcięte przez RLS.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

const migrationUrl = new URL("../supabase/migrations/0026_contract_documents.sql", import.meta.url);
const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);
const BUCKET = "rental-contracts";
const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const SHA = "a".repeat(64);

describe("kontrakt migracji 0026", () => {
  it("istnieje i deklaruje prywatny bucket oraz append-only dokumenty", () => {
    expect(existsSync(fileURLToPath(migrationUrl)), "brak migracji 0026").toBe(true);
    if (!existsSync(fileURLToPath(migrationUrl))) return;

    const sql = readFileSync(fileURLToPath(migrationUrl), "utf8");
    expect(sql).toContain("create table public.contract_documents");
    expect(sql).toMatch(/values\s*\(\s*'rental-contracts'\s*,\s*'rental-contracts'\s*,\s*false\s*\)/i);
    expect(sql).toContain("rental_contract");
    expect(sql).not.toMatch(
      /grant\s+[^;]*(?:update|delete)[^;]*on\s+public\.contract_documents\s+to\s+authenticated/i,
    );
  });
});

let admin: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let orderAId: string;
let orderBId: string;
const uploaded: string[] = [];

async function createOrder(tenantId: string): Promise<string> {
  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email: `contract-${randomUUID()}@test.local`,
      full_name: "Klient umowy",
      address_street: "Testowa 1",
      address_zip: "00-001",
      address_city: "Warszawa",
    })
    .select("id")
    .single();
  if (customerError || !customer) throw new Error(customerError?.message ?? "brak klienta");

  const { data, error } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      start_date: "2026-09-01",
      end_date: "2026-09-03",
      delivery_method: "courier",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "brak zamówienia");
  return data.id as string;
}

function documentRow(tenant: TenantCtx, orderId: string, overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  return {
    id,
    tenant_id: tenant.tenantId,
    order_id: orderId,
    storage_path: `${tenant.tenantId}/${orderId}/${id}.pdf`,
    sha256: SHA,
    locale: "pl",
    terms_version: "2026-07",
    recipient: tenant.ownerEmail,
    created_by: tenant.ownerUserId,
    ...overrides,
  };
}

describe.skipIf(!hasEnv)("umowy per tenant — RLS tabeli i Storage", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    ({ a, b } = await seedTwoTenants());
    orderAId = await createOrder(a.tenantId);
    orderBId = await createOrder(b.tenantId);
  }, 30_000);

  afterAll(async () => {
    if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded);
    await cleanupSeeded(admin);
  });

  it("owner zapisuje i czyta własny dokument oraz prywatny obiekt", async () => {
    const row = documentRow(a, orderAId);
    const { error: uploadError } = await a.ownerClient.storage
      .from(BUCKET)
      .upload(row.storage_path, PDF, { contentType: "application/pdf", upsert: false });
    expect(uploadError).toBeNull();
    uploaded.push(row.storage_path);

    const { error: insertError } = await a.ownerClient.from("contract_documents").insert(row);
    expect(insertError).toBeNull();

    const { data, error } = await a.ownerClient
      .from("contract_documents")
      .select("id, sha256")
      .eq("id", row.id)
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ id: row.id, sha256: SHA });

    const { data: blob, error: downloadError } = await a.ownerClient.storage
      .from(BUCKET)
      .download(row.storage_path);
    expect(downloadError).toBeNull();
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(PDF);
  });

  it("cudzy document_id pada na RLS metadanych ORAZ Storage bez udziału route handlera", async () => {
    const row = documentRow(b, orderBId, { sha256: "b".repeat(64) });
    const { error: uploadError } = await b.ownerClient.storage
      .from(BUCKET)
      .upload(row.storage_path, PDF, { contentType: "application/pdf", upsert: false });
    expect(uploadError).toBeNull();
    uploaded.push(row.storage_path);
    expect((await b.ownerClient.from("contract_documents").insert(row)).error).toBeNull();

    const { data: metadata, error: metadataError } = await a.ownerClient
      .from("contract_documents")
      .select("id")
      .eq("id", row.id);
    expect(metadataError).toBeNull();
    expect(metadata).toEqual([]);

    const { data: object, error: objectError } = await a.ownerClient.storage
      .from(BUCKET)
      .download(row.storage_path);
    expect(object).toBeNull();
    expect(objectError).not.toBeNull();
  });

  it("FK złożony odrzuca własny wiersz wskazujący cudze zamówienie", async () => {
    const { error } = await a.ownerClient
      .from("contract_documents")
      .insert(documentRow(a, orderBId, { sha256: "c".repeat(64) }));
    expect(error?.code).toBe("23503");
  });

  it("dokument jest append-only dla zwykłej sesji", async () => {
    const row = documentRow(a, orderAId, { sha256: "d".repeat(64) });
    expect((await a.ownerClient.from("contract_documents").insert(row)).error).toBeNull();

    const update = await a.ownerClient
      .from("contract_documents")
      .update({ terms_version: "podmieniona" })
      .eq("id", row.id);
    const remove = await a.ownerClient.from("contract_documents").delete().eq("id", row.id);
    expect(update.error).not.toBeNull();
    expect(remove.error).not.toBeNull();

    const { data } = await admin
      .from("contract_documents")
      .select("terms_version")
      .eq("id", row.id)
      .single();
    expect(data?.terms_version).toBe("2026-07");
  });

  it("Storage API sprząta wyłącznie własny orphan, nigdy zarejestrowany dokument", async () => {
    const own = documentRow(a, orderAId, { sha256: "f".repeat(64) });
    expect(
      (await a.ownerClient.storage.from(BUCKET).upload(own.storage_path, PDF, { upsert: false }))
        .error,
    ).toBeNull();
    uploaded.push(own.storage_path);

    const foreignDelete = await b.ownerClient.storage.from(BUCKET).remove([own.storage_path]);
    expect(foreignDelete.error).toBeNull();
    expect((await a.ownerClient.storage.from(BUCKET).download(own.storage_path)).error).toBeNull();

    const ownDelete = await a.ownerClient.storage.from(BUCKET).remove([own.storage_path]);
    expect(ownDelete.error).toBeNull();
    expect((await a.ownerClient.storage.from(BUCKET).download(own.storage_path)).error).not.toBeNull();

    const registered = documentRow(a, orderAId, { sha256: "1".repeat(64) });
    expect((await a.ownerClient.storage.from(BUCKET).upload(registered.storage_path, PDF)).error).toBeNull();
    uploaded.push(registered.storage_path);
    expect((await a.ownerClient.from("contract_documents").insert(registered)).error).toBeNull();
    expect((await a.ownerClient.storage.from(BUCKET).remove([registered.storage_path])).error).toBeNull();
    expect(
      (await a.ownerClient.storage.from(BUCKET).download(registered.storage_path)).error,
      "zarejestrowany dokument musi przeżyć próbę DELETE",
    ).toBeNull();
  });

  it("CHECK contract_document odrzuca niepełne i dopuszcza kompletne ustawienia", async () => {
    const incomplete = await a.ownerClient.from("tenant_settings").insert({
      tenant_id: a.tenantId,
      key: "contract_document",
      value: { address: "Testowa 1" },
    });
    expect(incomplete.error?.code).toBe("23514");

    const valid = await a.ownerClient.from("tenant_settings").insert({
      tenant_id: a.tenantId,
      key: "contract_document",
      value: {
        address: "Testowa 1, 00-001 Warszawa",
        nip: null,
        email: "firma@example.com",
        terms_version: "2026-07",
        terms_body: "Warunki najmu.",
      },
    });
    expect(valid.error).toBeNull();
  });

  it("rental_contract wymaga dokumentu tego samego tenanta i unikalnego klucza próby", async () => {
    const doc = documentRow(a, orderAId, { sha256: "e".repeat(64) });
    expect((await a.ownerClient.from("contract_documents").insert(doc)).error).toBeNull();
    const attempt = randomUUID();
    const base = {
      tenant_id: a.tenantId,
      order_id: orderAId,
      kind: "rental_contract",
      recipient: a.ownerEmail,
      subject: "Umowa najmu",
      status: "sent",
      provider_message_id: `resend-${randomUUID()}`,
      contract_document_id: doc.id,
      idempotency_key: `rental-contract/${doc.id}/${attempt}`,
    };

    expect((await a.ownerClient.from("email_logs").insert(base)).error).toBeNull();
    expect((await a.ownerClient.from("email_logs").insert({ ...base, id: randomUUID() })).error?.code)
      .toBe("23505");

    const missing = await a.ownerClient.from("email_logs").insert({
      ...base,
      idempotency_key: null,
      provider_message_id: `resend-${randomUUID()}`,
    });
    expect(missing.error?.code).toBe("23514");

    const foreign = await a.ownerClient.from("email_logs").insert({
      ...base,
      contract_document_id: randomUUID(),
      idempotency_key: `rental-contract/${randomUUID()}/${randomUUID()}`,
      provider_message_id: `resend-${randomUUID()}`,
    });
    expect(foreign.error?.code).toBe("23503");
  });

  it("stare rodzaje email_logs pozostają zgodne z null w nowych kolumnach", async () => {
    const { error } = await a.ownerClient.from("email_logs").insert({
      tenant_id: a.tenantId,
      order_id: orderAId,
      kind: "rental_confirmed",
      recipient: a.ownerEmail,
      subject: "Potwierdzenie",
      status: "sent",
      provider_message_id: `resend-${randomUUID()}`,
    });
    expect(error).toBeNull();
  });
});
