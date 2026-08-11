/**
 * Rodzaj `payment_confirmed` w historii wysyłek (0068, ADR-139) — wektory,
 * których nie pokrywają testy 0021/0026/0036:
 *
 *   (a) CHECK PRZEPUSZCZA NOWY RODZAJ. Bez podmiany `email_logs_kind_check`
 *       pierwszy wpis potwierdzenia płatności skończyłby się 23514 — a że
 *       błąd rejestru jest POCHŁANIANY (`sendAndLog`, ADR-045), skutek nie
 *       byłby awarią, tylko ciszą: mail poszedłby do klienta, a historia
 *       twierdziłaby, że potwierdzenia nie było.
 *
 *   (b) LISTA POZOSTAJE ZAMKNIĘTA. Wartość spoza kontraktu musi dalej
 *       odbijać się od bazy — pełna pętla po EMAIL_LOG_KINDS (podmiana
 *       niczego nie zgubiła) jest już w email-log-invoice-kind.test.ts
 *       i od tej migracji obejmuje także `payment_confirmed`.
 *
 *   (c) `payment_confirmed` NIE WCHODZI W GAŁĄŹ UMOWY.
 *       `email_logs_contract_shape` (0026) wymaga NULL-i w
 *       `contract_document_id` i `idempotency_key` dla rodzajów innych niż
 *       `rental_contract` — kluczem idempotencji tej wysyłki jest samo
 *       przejście stanu (`changed: true` z applySettlement), nie nagłówek
 *       dostawcy, więc kolumna ma zostać pusta.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { EMAIL_LOG_KINDS } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

let admin: SupabaseClient;
let a: TenantCtx;

function row(tenantId: string, kind: string, extra: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId,
    kind,
    recipient: `kind-${randomUUID()}@test.local`,
    subject: "Płatność zaksięgowana — AV-TEST-0068",
    status: "sent",
    ...extra,
  };
}

describe.skipIf(!hasEnv)("email_logs.kind — rodzaj „payment_confirmed” (0068)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    ({ a } = await seedTwoTenants());
  });

  afterAll(async () => {
    await cleanupSeeded(admin);
  });

  it("przyjmuje wpis kind = 'payment_confirmed'", async () => {
    const { data, error } = await a.ownerClient
      .from("email_logs")
      .insert(row(a.tenantId, "payment_confirmed"))
      .select("id, kind")
      .single();

    expect(error).toBeNull();
    expect(data?.kind).toBe("payment_confirmed");
  });

  it("kontrakt @avably/core zawiera nowy rodzaj (lustro CHECK-a nie rozjechało się)", () => {
    // Kontrola pozytywna dla pętli z email-log-invoice-kind.test.ts, która
    // od tej migracji przechodzi także przez `payment_confirmed`.
    expect(EMAIL_LOG_KINDS).toContain("payment_confirmed");
    expect(EMAIL_LOG_KINDS.length).toBeGreaterThanOrEqual(13);
  });

  it("nadal ODRZUCA rodzaj spoza listy (lista pozostała zamknięta)", async () => {
    const { error } = await a.ownerClient
      .from("email_logs")
      .insert(row(a.tenantId, "platnosc_zaksiegowana"));

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("email_logs_kind_check");
  });

  it("odrzuca wpis 'payment_confirmed' z polami zarezerwowanymi dla umowy (kształt 0026)", async () => {
    const { error } = await a.ownerClient
      .from("email_logs")
      .insert(
        row(a.tenantId, "payment_confirmed", {
          idempotency_key: `payment-confirmed/${randomUUID()}`,
        }),
      );

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("email_logs_contract_shape");
  });

  it("fakt „potwierdzenie wysłane” da się WYPROWADZIĆ z rejestru, bez kolumny w orders", async () => {
    const sent = await a.ownerClient
      .from("email_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", a.tenantId)
      .eq("kind", "payment_confirmed")
      .eq("status", "sent");

    expect(sent.error).toBeNull();
    expect(sent.count ?? 0).toBeGreaterThan(0);

    // Kontrola negatywna: orders nie dostało flagi, z którą rejestr mógłby
    // się rozjechać (ten sam argument co przy `invoice`, 0036).
    const { error: columnError } = await admin
      .from("orders")
      .select("payment_email_sent")
      .limit(1);
    expect(columnError).not.toBeNull();
    expect(columnError?.message).toContain("payment_email_sent");
  });
});
