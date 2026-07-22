import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { EmailTransport } from "@avably/core";
import type { ContractPdfProps } from "@avably/pdf";

import { contractServiceDeps } from "@/app/[locale]/(panel)/zamowienia/[id]/contract-adapters";
import {
  downloadContract,
  generateContract,
  sendContract,
} from "@/app/[locale]/(panel)/zamowienia/[id]/contract-service";
import { sha256Hex } from "@/app/[locale]/(panel)/zamowienia/[id]/contract-document";
import { panelEmailLogRecorder } from "@/lib/email-log";

import { integrationEnv } from "../../../packages/db/test/helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "../../../packages/db/test/helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);
const loadUnpdf = async () => {
  // Verifier jest już zależnością testową @avably/pdf; Z7 nie dodaje drugiej
  // zależności zewnętrznej do panelu tylko po to, by odczytać ten sam format.
  const requireFromPdf = createRequire(new URL("../../../packages/pdf/package.json", import.meta.url));
  return import(requireFromPdf.resolve("unpdf")) as Promise<{
    getDocumentProxy(bytes: Uint8Array): Promise<unknown>;
    extractText(pdf: unknown, options: { mergePages: boolean }): Promise<{ text: string | string[] }>;
  }>;
};

const props: ContractPdfProps = {
  locale: "pl",
  tenant: { name: "Wypożyczalnia Integracyjna", address: "Testowa 1, Warszawa", nip: null, email: "firma@example.pl" },
  customer: { fullName: "Anna Integracyjna", address: "Klienta 2, Kraków", email: "anna@example.pl" },
  order: { number: "ZAM-INTEGRACJA", startDate: "22 lipca 2026", endDate: "24 lipca 2026", days: 3 },
  items: [{ name: "Aparat integracyjny", serialNumber: "SN-INT", rentalGrosze: 45_000, depositGrosze: 90_000 }],
  totals: { rentalGrosze: 45_000, depositGrosze: 90_000, deliveryGrosze: 2_500, currency: "PLN" },
  terms: { version: "2026-07", body: "Warunki integracyjne umowy." },
};

describe.skipIf(!hasEnv)("trwały obieg umowy — panel + prawdziwy Storage", () => {
  let admin: SupabaseClient;
  let a: TenantCtx;
  let b: TenantCtx;
  let orderA: string;
  let orderB: string;
  const documentIds: string[] = [];
  const storagePaths: string[] = [];

  async function createOrder(tenant: TenantCtx): Promise<string> {
    const { data: customer, error: customerError } = await admin.from("customers").insert({
      tenant_id: tenant.tenantId,
      email: `contract-flow-${randomUUID()}@test.local`,
      full_name: "Klient integracyjny",
      address_street: "Testowa 1",
      address_zip: "00-001",
      address_city: "Warszawa",
    }).select("id").single();
    if (customerError || !customer) throw new Error(customerError?.message ?? "brak klienta");
    const { data: order, error } = await admin.from("orders").insert({
      tenant_id: tenant.tenantId,
      customer_id: customer.id,
      start_date: "2026-09-01",
      end_date: "2026-09-03",
      delivery_method: "courier",
    }).select("id").single();
    if (error || !order) throw new Error(error?.message ?? "brak zamówienia");
    return order.id as string;
  }

  beforeAll(async () => {
    admin = createAdminClient();
    ({ a, b } = await seedTwoTenants());
    orderA = await createOrder(a);
    orderB = await createOrder(b);
  }, 60_000);

  afterAll(async () => {
    if (storagePaths.length) {
      // Produkcyjny trigger celowo blokuje usunięcie zarejestrowanego pliku.
      // Teardown service-role usuwa zależne logi, metadane, a na końcu osierocone bajty.
      const { error: logsError } = await admin
        .from("email_logs")
        .delete()
        .in("contract_document_id", documentIds);
      if (logsError) throw new Error(`Teardown logów umów: ${logsError.message}`);
      const { error: metadataError } = await admin
        .from("contract_documents")
        .delete()
        .in("storage_path", storagePaths);
      if (metadataError) throw new Error(`Teardown metadanych umów: ${metadataError.message}`);
      const { error: storageError } = await admin.storage.from("rental-contracts").remove(storagePaths);
      if (storageError) throw new Error(`Teardown plików umów: ${storageError.message}`);
    }
    await cleanupSeeded(admin);
  }, 60_000);

  it("zapisuje, parsuje, pobiera i wysyła dokładnie te same bajty", async () => {
    const generationDeps = contractServiceDeps(a.ownerClient);
    const document = await generateContract(generationDeps, {
      tenantId: a.tenantId,
      orderId: orderA,
      userId: a.ownerUserId,
      locale: "pl",
      termsVersion: props.terms.version,
      recipient: props.customer.email,
      props,
    });
    documentIds.push(document.id);
    storagePaths.push(document.storage_path);

    const downloaded = await downloadContract(generationDeps, {
      tenantId: a.tenantId,
      orderId: orderA,
      documentId: document.id,
    });
    expect(sha256Hex(downloaded.bytes)).toBe(document.sha256);
    const exactBytes = downloaded.bytes.slice();

    const { getDocumentProxy, extractText } = await loadUnpdf();
    const parsed = await getDocumentProxy(downloaded.bytes);
    const extracted = await extractText(parsed, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
    expect(text).toContain("Anna Integracyjna");
    expect(text).toContain("ZAM-INTEGRACJA");
    expect(text).toContain("Warunki integracyjne umowy");

    const transport: EmailTransport = { send: vi.fn(async () => ({ id: "mail-integration" })) };
    const result = await sendContract(
      contractServiceDeps(a.ownerClient, {
        transport,
        recorder: panelEmailLogRecorder(a.ownerClient, a.tenantId),
      }),
      {
        tenantId: a.tenantId,
        orderId: orderA,
        documentId: document.id,
        attemptId: randomUUID(),
        tenantName: props.tenant.name,
        customerName: props.customer.fullName,
        orderNumber: props.order.number,
      },
    );
    expect(result.formError).toBeUndefined();
    const attachment = vi.mocked(transport.send).mock.calls[0]?.[0].attachments?.[0];
    expect(attachment?.content).toEqual(exactBytes);

    const { data: logs } = await a.ownerClient.from("email_logs").select("status,contract_document_id,idempotency_key").eq("contract_document_id", document.id);
    expect(logs).toHaveLength(1);
    expect(logs?.[0]).toMatchObject({ status: "sent", contract_document_id: document.id });
  }, 30_000);

  it("sesja A nie czyta document_id ani obiektu B bez route handlera", async () => {
    const document = await generateContract(contractServiceDeps(b.ownerClient), {
      tenantId: b.tenantId,
      orderId: orderB,
      userId: b.ownerUserId,
      locale: "pl",
      termsVersion: props.terms.version,
      recipient: props.customer.email,
      props: { ...props, order: { ...props.order, number: "ZAM-B" } },
    });
    documentIds.push(document.id);
    storagePaths.push(document.storage_path);
    const metadata = await a.ownerClient.from("contract_documents").select("id").eq("id", document.id);
    expect(metadata.error).toBeNull();
    expect(metadata.data).toEqual([]);
    const object = await a.ownerClient.storage.from("rental-contracts").download(document.storage_path);
    expect(object.data).toBeNull();
    expect(object.error).not.toBeNull();
  }, 30_000);
});
