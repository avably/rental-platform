/**
 * DOWÓD KOŃCA-DO-KOŃCA: treść, którą dostał transport, LĄDUJE W BAZIE
 * (0035, ADR-073) — na żywym Supabase, przez prawdziwy rejestrator panelu
 * i prawdziwą sesję członka (RLS `tenant_insert` z 0021).
 *
 * ================== CZEGO NIE UDOWODNI ATRAPA ==================
 *
 * `email-body-contract.test.ts` sprawdza, że każda ścieżka PODAJE treść
 * rejestratorowi — i to jest cała asercja, jaką da się postawić na atrapie.
 * Nie odpowiada natomiast na pytanie, czy rejestrator tę treść ZAPISUJE:
 * literówka w nazwie kolumny, brakujący grant, świeży CHECK czy trigger
 * odrzucający wiersz są dla spy-rejestratora niewidzialne, a dla operatora
 * są całą różnicą między podglądem a napisem „treść niedostępna".
 *
 * Dlatego ten test przechodzi PEŁNĄ drogę: transport przechwytujący (nie
 * wysyłamy realnej poczty przez dostawcę) → `sendAndLog` → prawdziwy
 * `panelEmailLogRecorder` sesją członka → odczyt z bazy TĄ SAMĄ sesją,
 * którą czyta ekran zamówienia. Porównanie jest bajt w bajt między
 * argumentem transportu a wierszem w `email_logs`.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OutgoingEmail, TenantSettingRow } from "@avably/core";

import { sendRentalEmailForTransition } from "@/app/[locale]/(panel)/zamowienia/[id]/rental-email";
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

const settings: TenantSettingRow[] = [
  { key: "email_sender", value: { name: "Wypożyczalnia Demo" } } as unknown as TenantSettingRow,
];

let admin: SupabaseClient;
let a: TenantCtx;
let orderId: string;
let customerEmail: string;

describe.skipIf(!hasEnv)("historia komunikacji — treść trafia do bazy (0035, żywy Supabase)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    ({ a } = await seedTwoTenants());

    customerEmail = `body-live-${randomUUID().slice(0, 8)}@test.local`;
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({ tenant_id: a.tenantId, email: customerEmail, full_name: "Jan Historia" })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`klient: ${customerError?.message}`);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: a.tenantId,
        customer_id: customer.id,
        start_date: "2026-09-01",
        end_date: "2026-09-03",
        delivery_method: "courier",
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`zamówienie: ${orderError?.message}`);
    orderId = order.id as string;
  });

  afterAll(async () => {
    await cleanupSeeded(admin);
  });

  it("wysyłka cyklu najmu zapisuje w email_logs.body DOKŁADNIE to, co dostał transport", async () => {
    const sent: OutgoingEmail[] = [];

    const reason = await sendRentalEmailForTransition({
      status: "picked_up",
      order: {
        order_number: "AV-LIVE-0035",
        start_date: "2026-09-01",
        end_date: "2026-09-03",
        total_rental_grosze: 55_000,
        customers: { full_name: "Jan Historia", email: customerEmail },
        pickup_locations: null,
      },
      orderId,
      tenantName: "Wypożyczalnia Demo",
      locale: "pl",
      currency: "PLN",
      settings,
      availability: { available: true },
      transport: {
        send: async (email) => {
          sent.push(email);
          return { id: `resend-${randomUUID().slice(0, 8)}` };
        },
      },
      // PRAWDZIWY rejestrator, sesją członka — nie atrapa.
      recorder: panelEmailLogRecorder(a.ownerClient, a.tenantId),
    });

    expect(reason).toBeUndefined();
    expect(sent).toHaveLength(1);

    const { data, error } = await a.ownerClient
      .from("email_logs")
      .select("kind, status, subject, recipient, body, hasBody:email_log_has_body")
      .eq("tenant_id", a.tenantId)
      .eq("order_id", orderId)
      .single();

    expect(error).toBeNull();
    expect(data?.kind).toBe("rental_picked_up");
    expect(data?.status).toBe("sent");
    expect(data?.recipient).toBe(sent[0]!.to);
    expect(data?.subject).toBe(sent[0]!.subject);
    // Sedno: wiersz w bazie niesie ten sam HTML, który poszedł do transportu.
    expect(data?.body).toBe(sent[0]!.html);
    // …i ekran dowie się o tym z kolumny wyliczanej, bez pobierania treści.
    expect(data?.hasBody).toBe(true);
  });
});
