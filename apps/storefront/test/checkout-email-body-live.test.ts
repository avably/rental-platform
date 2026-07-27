/**
 * Pełna ścieżka historii checkoutu na żywym Supabase:
 *
 * sendCheckoutEmails → sendAndLog → checkoutEmailLogRecorder → RPC
 * app.log_public_checkout_email → public.email_logs.
 *
 * Transport wyłącznie przechwytuje OutgoingEmail; żadna wiadomość nie trafia
 * do prawdziwego dostawcy. Rejestrator i baza są produkcyjne.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EmailTransport, OutgoingEmail } from "@avably/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkoutEmailLogRecorder } from "@/lib/checkout/email-log";
import type { CheckoutRpcResult } from "@/lib/checkout/core";
import { sendCheckoutEmails } from "@/lib/checkout/emails";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

function client(key: string): SupabaseClient {
  return createClient(process.env.SUPABASE_LOCAL_API_URL as string, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

const adminClient = () => client(process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string);
const anonClient = () => client(process.env.SUPABASE_LOCAL_ANON_KEY as string);

describe.skipIf(!hasEnv)("treść e-maili checkoutu na żywym Supabase (0037)", () => {
  let admin: SupabaseClient;
  let tenantId: string;
  let customerId: string;
  let orderId: string;
  let orderNumber: string;
  let logToken: string;
  let marker: string;

  beforeEach(async () => {
    admin = adminClient();
    marker = randomUUID();
    logToken = randomUUID();

    const { data: tenant, error: tenantError } = await admin
      .from("tenants")
      .insert({ slug: `checkout-body-${marker}`.slice(0, 39), name: `Checkout body ${marker}` })
      .select("id")
      .single();
    if (tenantError || !tenant) throw new Error(`seed tenanta: ${tenantError?.message}`);
    tenantId = tenant.id as string;

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        tenant_id: tenantId,
        email: `customer-${marker}@test.local`,
        full_name: "Żaneta Checkout",
        locale: "pl",
      })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`seed klienta: ${customerError?.message}`);
    customerId = customer.id as string;

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        start_date: "2026-10-01",
        end_date: "2026-10-03",
        delivery_method: "courier",
        checkout_log_token: logToken,
      })
      .select("id, order_number")
      .single();
    if (orderError || !order) throw new Error(`seed zamówienia: ${orderError?.message}`);
    orderId = order.id as string;
    orderNumber = order.order_number as string;
  });

  afterEach(async () => {
    if (!admin) return;
    if (orderId) await admin.from("email_logs").delete().eq("order_id", orderId);
    if (orderId) await admin.from("orders").delete().eq("id", orderId);
    if (customerId) await admin.from("customers").delete().eq("id", customerId);
    if (tenantId) await admin.from("tenants").delete().eq("id", tenantId);
  });

  function context(): CheckoutRpcResult {
    return {
      order_id: orderId,
      order_number: orderNumber,
      order_status: "pending",
      payment_status: "unpaid",
      payment_method: "transfer",
      payment_provider: "manual",
      start_date: "2026-10-01",
      end_date: "2026-10-03",
      delivery_method: "courier",
      total_rental_grosze: 65_000,
      total_deposit_grosze: 5_000,
      delivery_grosze: 2_000,
      currency: "PLN",
      items: [],
      customer: {
        email: `customer-${marker}@test.local`,
        full_name: "Żaneta Checkout",
        locale: "pl",
      },
      tenant: { name: `Checkout body ${marker}`, locale: "pl" },
      email_sender: { name: "Checkout body", reply_to: `tenant-${marker}@test.local` },
      notify_email: `tenant-${marker}@test.local`,
      log_token: logToken,
    };
  }

  function capturingTransport(): { transport: EmailTransport; sent: OutgoingEmail[] } {
    const sent: OutgoingEmail[] = [];
    return {
      sent,
      transport: {
        send: vi.fn(async (email: OutgoingEmail) => {
          sent.push(email);
          return { id: `capture-${marker}-${sent.length}` };
        }),
      },
    };
  }

  it("zapisuje oba HTML-e dokładnie takie, jakie dostał transport", async () => {
    const { transport, sent } = capturingTransport();
    const issues = await sendCheckoutEmails(context(), {
      transport,
      availability: { available: true },
      recorder: checkoutEmailLogRecorder(anonClient(), tenantId, orderNumber, logToken),
      panelBaseUrl: "https://panel.avably.io",
      fromEmail: "Avably <no-reply@avably.io>",
    });

    expect(issues).toEqual([]);
    expect(sent).toHaveLength(2);

    const { data, error } = await admin
      .from("email_logs")
      .select("kind, recipient, body, hasBody:email_log_has_body")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });
    expect(error, `odczyt service-role: ${error?.message}`).toBeNull();
    expect(data ?? []).toHaveLength(2);

    for (const kind of ["checkout_confirmation", "new_order_notification"] as const) {
      const row = (data ?? []).find((entry) => entry.kind === kind);
      const delivered =
        kind === "checkout_confirmation"
          ? sent.find((email) => email.to === `customer-${marker}@test.local`)
          : sent.find((email) => email.to === `tenant-${marker}@test.local`);
      expect(row, `brak dokładnie jednego wpisu ${kind}`).toBeDefined();
      expect(delivered, `transport nie dostał ${kind}`).toBeDefined();
      expect(row!.body, `${kind}: HTML w bazie różni się od argumentu transportu`).toBe(
        delivered!.html,
      );
      expect(row!.hasBody).toBe(true);
    }
  }, 30_000);

  it("awaria prawdziwego rejestratora nie cofa zamówienia ani udanych wysyłek", async () => {
    const { transport, sent } = capturingTransport();
    const issues = await sendCheckoutEmails(context(), {
      transport,
      availability: { available: true },
      recorder: checkoutEmailLogRecorder(
        anonClient(),
        tenantId,
        orderNumber,
        randomUUID(),
      ),
      panelBaseUrl: "https://panel.avably.io",
      fromEmail: "Avably <no-reply@avably.io>",
    });

    expect(sent, "błąd dziennika nie może cofnąć udanego transportu").toHaveLength(2);
    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.includes("historii wiadomości"))).toBe(true);

    const [{ data: order }, { data: logs }] = await Promise.all([
      admin.from("orders").select("id").eq("id", orderId),
      admin.from("email_logs").select("id, body").eq("order_id", orderId),
    ]);
    expect(order ?? [], "zamówienie zostało cofnięte przez błąd logu").toHaveLength(1);
    expect(logs ?? [], "odmowa RPC zostawiła częściowy wpis lub body").toHaveLength(0);
  }, 30_000);
});
