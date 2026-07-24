/**
 * Rodzaj `invoice` w historii wysyłek (0036, ADR-076) — wektory, których nie
 * pokrywają ani testy 0021 (email-logs.test.ts), ani 0026
 * (contract-documents.test.ts):
 *
 *   (a) CHECK PRZEPUSZCZA NOWY RODZAJ. Bez podmiany `email_logs_kind_check`
 *       panel zapisałby wpis „faktura wysłana" wprost w 23514 — a ponieważ
 *       błąd rejestru jest POCHŁANIANY (`sendAndLog`, ADR-045), skutek nie
 *       byłby awarią, tylko ciszą: wiadomość poszłaby do klienta, a ekran
 *       dalej twierdziłby, że faktury nie wysłano.
 *
 *   (b) PODMIANA NICZEGO NIE ZGUBIŁA. CHECK trzeba w Postgresie podać CAŁY,
 *       więc pełna lista rodzajów to jedyna operacja, jaką da się wykonać —
 *       i jedyna, w której da się po cichu wyrzucić rodzaj używany przez
 *       inną ścieżkę wysyłki. Test przechodzi po WSZYSTKICH rodzajach
 *       kontraktu z `@avably/core`, nie po tym jednym nowym.
 *
 *   (c) LISTA POZOSTAJE ZAMKNIĘTA. Wartość spoza kontraktu musi dalej
 *       odbijać się od bazy — inaczej podmiana CHECK-a zamieniłaby bramkę
 *       w ozdobę.
 *
 *   (d) `invoice` NIE WCHODZI W GAŁĄŹ UMOWY. `email_logs_contract_shape`
 *       (0026) wymaga NULL-i w `contract_document_id` i `idempotency_key`
 *       dla każdego rodzaju innego niż `rental_contract`. To jest miejsce,
 *       w którym ta reguła spotyka się z nowym rodzajem po raz pierwszy.
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
    subject: "Faktura do zamówienia AV-TEST-0036",
    status: "sent",
    ...extra,
  };
}

describe.skipIf(!hasEnv)("email_logs.kind — rodzaj „invoice” (0036)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    ({ a } = await seedTwoTenants());
  });

  afterAll(async () => {
    await cleanupSeeded(admin);
  });

  it("przyjmuje wpis kind = 'invoice'", async () => {
    const { data, error } = await a.ownerClient
      .from("email_logs")
      .insert(row(a.tenantId, "invoice"))
      .select("id, kind")
      .single();

    expect(error).toBeNull();
    expect(data?.kind).toBe("invoice");
  });

  it("przyjmuje KAŻDY rodzaj z kontraktu @avably/core (podmiana CHECK-a nic nie zgubiła)", async () => {
    // Kontrola pozytywna: zbiór nie jest pusty i zawiera nowy rodzaj —
    // pętla po pustej liście przeszłaby, nie broniąc niczego.
    expect(EMAIL_LOG_KINDS.length).toBeGreaterThanOrEqual(12);
    expect(EMAIL_LOG_KINDS).toContain("invoice");

    for (const kind of EMAIL_LOG_KINDS) {
      // `rental_contract` ma własny kształt (0026) i własny test — tu
      // sprawdzamy listę dopuszczonych wartości, nie kształt umowy.
      if (kind === "rental_contract") continue;
      const { error } = await a.ownerClient.from("email_logs").insert(row(a.tenantId, kind));
      expect(error, `rodzaj ${kind} odbił się od CHECK-a: ${error?.message}`).toBeNull();
    }
  });

  it("nadal ODRZUCA rodzaj spoza listy (lista pozostała zamknięta)", async () => {
    const { error } = await a.ownerClient.from("email_logs").insert(row(a.tenantId, "faktura"));

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("email_logs_kind_check");
  });

  it("odrzuca wpis 'invoice' z polami zarezerwowanymi dla umowy (kształt 0026)", async () => {
    const { error } = await a.ownerClient
      .from("email_logs")
      .insert(row(a.tenantId, "invoice", { idempotency_key: `invoice/${randomUUID()}` }));

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("email_logs_contract_shape");
  });

  it("stan „faktura wysłana” da się WYPROWADZIĆ z rejestru, bez kolumny w orders", async () => {
    // Zapytanie jest lustrem tego, które robi karta faktury w panelu.
    const orderless = await a.ownerClient
      .from("email_logs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", a.tenantId)
      .eq("kind", "invoice")
      .eq("status", "sent");

    expect(orderless.error).toBeNull();
    expect(orderless.count ?? 0).toBeGreaterThan(0);

    // I kontrola negatywna: tabela `orders` nie dostała flagi, z którą
    // rejestr mógłby się rozjechać.
    const { error: columnError } = await admin.from("orders").select("invoice_sent").limit(1);
    expect(columnError).not.toBeNull();
    expect(columnError?.message).toContain("invoice_sent");
  });
});
