"use server";

import { revalidatePath } from "next/cache";

import { emailSenderFromSettings, resendTransport, type TenantSettingRow } from "@avably/core";

import { contractDocumentSettingsFromRows } from "@/lib/contract-settings";
import { loadCustomFieldDefinitions } from "@/lib/custom-fields";
import { panelEmailLogRecorder } from "@/lib/email-log";
import type { FormState } from "@/lib/form-state";
import { uuidSchema } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";
import { orderCurrencyCode } from "@/lib/tenant-currency";

import { contractServiceDeps } from "./contract-adapters";
import { buildContractPdfProps, type ContractOrderRow } from "./contract-document";
import { generateContract, sendContract } from "./contract-service";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function loadGenerationContext(orderId: string) {
  const context = await requireMember();
  const tenantId = context.tenantId!;
  // Waluta idzie z WIERSZA ZAMÓWIENIA (orders.currency, 0049/ADR-103) —
  // umowa opisuje kwoty w walucie, w której zamówienie POWSTAŁO, a nie
  // w bieżącym ustawieniu najemcy.
  const [orderResult, settingsResult, tenantResult, definitions] = await Promise.all([
    context.supabase.from("orders").select(
      "order_number,start_date,end_date,total_rental_grosze,total_deposit_grosze,delivery_grosze,currency,custom_fields,customers(full_name,email,locale,address_street,address_zip,address_city,custom_fields),order_items(rental_grosze,deposit_grosze,products(name,custom_fields),product_units(serial_number))",
    ).eq("tenant_id", tenantId).eq("id", orderId).maybeSingle(),
    context.supabase.from("tenant_settings").select("key,value").eq("tenant_id", tenantId).in("key", ["contract_document", "email_sender"]),
    context.supabase.from("tenants").select("name,locale").eq("id", tenantId).maybeSingle(),
    // Definicje WSZYSTKICH encji — filtr „umowa" stosuje rdzeń przy budowie
    // propsów, nie to zapytanie.
    loadCustomFieldDefinitions(context.supabase, tenantId),
  ]);
  if (!orderResult.data || !tenantResult.data) throw new Error("Zamówienie nie istnieje.");
  const settingRows = (settingsResult.data ?? []) as TenantSettingRow[];
  const settings = contractDocumentSettingsFromRows(settingRows);
  const order = orderResult.data as unknown as ContractOrderRow;
  if (!order.customers?.email) throw new Error("Klient nie ma adresu e-mail.");
  if (!order.customers.address_street || !order.customers.address_zip || !order.customers.address_city) {
    throw new Error("Uzupełnij pełny adres klienta przed wygenerowaniem umowy.");
  }
  if (!order.order_items.length || order.order_items.some((item) => !item.products)) {
    throw new Error("Zamówienie nie ma kompletnych pozycji.");
  }
  return { context, tenantId, tenant: tenantResult.data as { name: string; locale: "pl" | "en" }, settings, settingRows, order, definitions, currency: orderCurrencyCode(order.currency) };
}

export async function generateContractAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const orderId = field(formData, "orderId");
  if (!uuidSchema.safeParse(orderId).success) return { formError: "Nieprawidłowe zamówienie." };
  try {
    const loaded = await loadGenerationContext(orderId);
    const props = buildContractPdfProps({
      tenant: loaded.tenant,
      tenantLocale: loaded.tenant.locale,
      currency: loaded.currency,
      settings: loaded.settings,
      order: loaded.order,
      customFieldDefinitions: loaded.definitions,
    });
    await generateContract(contractServiceDeps(loaded.context.supabase), {
      tenantId: loaded.tenantId,
      orderId,
      userId: loaded.context.user.id,
      locale: props.locale,
      termsVersion: loaded.settings.terms_version,
      recipient: loaded.order.customers!.email,
      props,
    });
    revalidatePath(`/zamowienia/${orderId}`);
    return { success: "Umowa została wygenerowana." };
  } catch (error) {
    return { formError: error instanceof Error ? error.message : "Nie udało się wygenerować umowy." };
  }
}

export async function sendContractAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const orderId = field(formData, "orderId");
  const documentId = field(formData, "documentId");
  const attemptId = field(formData, "attemptId");
  if (![orderId, documentId, attemptId].every((value) => uuidSchema.safeParse(value).success)) {
    return { formError: "Nieprawidłowe dane próby wysyłki." };
  }
  try {
    const loaded = await loadGenerationContext(orderId);
    const sender = emailSenderFromSettings(loaded.settingRows);
    const result = await sendContract(
      contractServiceDeps(loaded.context.supabase, {
        transport: resendTransport(),
        recorder: panelEmailLogRecorder(loaded.context.supabase, loaded.tenantId),
      }),
      {
        tenantId: loaded.tenantId,
        orderId,
        documentId,
        attemptId,
        tenantName: loaded.tenant.name,
        customerName: loaded.order.customers!.full_name ?? loaded.order.customers!.email,
        orderNumber: loaded.order.order_number,
        ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      },
    );
    revalidatePath(`/zamowienia/${orderId}`);
    return result;
  } catch (error) {
    return { formError: error instanceof Error ? error.message : "Nie udało się wysłać umowy." };
  }
}
