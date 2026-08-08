"use server";

/**
 * Akcja doręczenia faktury (D3, ADR-076).
 *
 * Wzorzec panelu: walidacja PRZED Supabase, `requireMember` jako guard,
 * odczyty sesją członka (RLS 0007/0021 jest bramką autorytatywną, nie ten
 * kod), wysyłka WYŁĄCZNIE przez `sendInvoice` → `sendAndLog`.
 *
 * ============== ODMOWA NIE ZOSTAWIA WPISU W HISTORII ==============
 *
 * Kolejność bramek jest częścią kontraktu, a nie stylem: zły typ, zły
 * rozmiar, brak adresu klienta i niedostępna poczta rozstrzygają się PRZED
 * `sendInvoice`, więc odmowa nie tworzy wiersza w `email_logs`. To ma
 * znaczenie, bo `sendAndLog` loguje TAKŻE porażki — wpis „failed" oznacza
 * u nas „próbowaliśmy i dostawca odmówił", a nie „operator wybrał zły plik".
 * Sklejenie obu zaśmieciłoby historię komunikacji zdarzeniami, które nigdy
 * nie opuściły panelu, i zabrałoby wpisom „failed" ich jedyne znaczenie.
 *
 * ============== JĘZYK ODMOWY ==============
 *
 * Komunikaty idą przez `getTranslations` (jak w `zamowienia/actions.ts`),
 * bo mówią do OPERATORA i mają parytet EN↔PL. Wyjątkiem jest powód od
 * dostawcy poczty — ten wraca jak przyszedł, bo przetłumaczyć go nie mamy
 * jak, a przetłumaczyć „w przybliżeniu" znaczyłoby zmyślić.
 */
import {
  DEFAULT_TENANT_LOCALE,
  EMAIL_SENDER_KEY,
  EmailConfigError,
  emailAvailability,
  emailSenderFromSettings,
  isLocale,
  resendTransport,
  type Locale,
  type TenantSettingRow,
} from "@avably/core";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { AuthError } from "@/lib/auth";
import { panelEmailLogRecorder } from "@/lib/email-log";
import type { FormState } from "@/lib/form-state";
import { uuidSchema } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";

import {
  INVOICE_MAX_MB,
  checkInvoiceFile,
  invoiceAttachmentFilename,
  type InvoiceFileProblem,
} from "./invoice-email";
import { sendInvoice } from "./invoice-service";

/** Wiersz zamówienia w zakresie potrzebnym do złożenia wiadomości. */
interface InvoiceOrderRow {
  order_number: string;
  customers: { full_name: string | null; email: string; locale: string | null } | null;
}

/** Ile bajtów czytamy na potrzeby sprawdzenia nagłówka `%PDF-`. */
const MAGIC_BYTES = 5;

export async function sendInvoiceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("orders.invoice");

  const orderId = formData.get("orderId");
  if (typeof orderId !== "string" || !uuidSchema.safeParse(orderId).success) {
    return { formError: t("errors.order") };
  }

  const file = formData.get("file");
  const isFile = file instanceof File;

  // Rozmiar i typ deklarowany — zanim dotkniemy bajtów i zanim dotkniemy bazy.
  const declaredProblem = checkInvoiceFile(isFile ? file : null);
  if (declaredProblem) return { formError: fileProblemMessage(t, declaredProblem) };

  // Nagłówek pliku: `File.type` bierze się z rozszerzenia, więc `.pdf`
  // doklejone do czegokolwiek przeszłoby bramkę wyżej.
  const head = new Uint8Array(await (file as File).slice(0, MAGIC_BYTES).arrayBuffer());
  const contentProblem = checkInvoiceFile(file as File, head);
  if (contentProblem) return { formError: fileProblemMessage(t, contentProblem) };

  const availability = emailAvailability();
  if (!availability.available) {
    // Neutralnie, ze słownika (U1, audyt W3): powód z serwera to sprawa
    // platformy i nie schodzi na ekran najemcy.
    return { formError: t("errors.unavailable") };
  }

  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { formError: err.message };
    throw err;
  }

  const [orderResult, settingsResult, tenantResult] = await Promise.all([
    ctx.supabase
      .from("orders")
      .select("order_number, customers(full_name, email, locale)")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", orderId)
      .maybeSingle(),
    ctx.supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", ctx.tenantId)
      .eq("key", EMAIL_SENDER_KEY),
    ctx.supabase.from("tenants").select("name, locale").eq("id", ctx.tenantId).maybeSingle(),
  ]);

  const order = orderResult.data as unknown as InvoiceOrderRow | null;
  const tenant = tenantResult.data as { name: string; locale: string | null } | null;
  if (!order || !tenant) return { formError: t("errors.order") };
  if (!order.customers?.email) return { formError: t("errors.noCustomerEmail") };

  let sender;
  try {
    sender = emailSenderFromSettings((settingsResult.data ?? []) as TenantSettingRow[]);
  } catch (err) {
    // Brak nadawcy jest GŁOŚNY (ADR-033): własny komunikat konfiguracji
    // niesie pełną listę braków, więc lepszy od naszego zdania ogólnego.
    if (err instanceof EmailConfigError) return { formError: err.message };
    throw err;
  }

  // Język ODBIORCY: preferencja klienta, w jej braku język tenanta (ADR-037).
  const locale: Locale = isLocale(order.customers.locale ?? "")
    ? (order.customers.locale as Locale)
    : isLocale(tenant.locale ?? "")
      ? (tenant.locale as Locale)
      : DEFAULT_TENANT_LOCALE;

  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  const result = await sendInvoice(
    {
      transport: resendTransport(),
      // Ślad pisze SESJA CZŁONKA (RLS tenant_insert, 0021) — ta sama bramka
      // co przy każdym innym zapisie panelu. `!`: requireMember rzuca bez tenanta.
      recorder: panelEmailLogRecorder(ctx.supabase, ctx.tenantId!),
    },
    {
      orderId,
      locale,
      tenantName: sender.name,
      customerName: order.customers.full_name?.trim() || order.customers.email,
      customerEmail: order.customers.email,
      orderNumber: order.order_number,
      bytes,
      filename: invoiceAttachmentFilename((file as File).name, order.order_number),
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    },
  );

  // Historia komunikacji i stan „faktura wysłana" (wyprowadzany z tej samej
  // historii) mają się odświeżyć bez ręcznego przeładowania ekranu.
  revalidatePath(`/zamowienia/${orderId}`);

  if (result.sendError) return { formError: t("errors.send", { reason: result.sendError }) };
  if (result.logIssue) {
    // Wiadomość WYSZŁA. Awaria dziennika nie może tego przebrać w porażkę,
    // bo operator wysłałby fakturę drugi raz (ADR-045).
    return { success: `${t("sentSuccess")} ${result.logIssue}` };
  }
  return { success: t("sentSuccess") };
}

function fileProblemMessage(
  t: Awaited<ReturnType<typeof getTranslations<"orders.invoice">>>,
  problem: InvoiceFileProblem,
): string {
  switch (problem) {
    case "missing":
      return t("errors.missing");
    case "empty":
      return t("errors.empty");
    case "size":
      return t("errors.size", { limit: INVOICE_MAX_MB });
    case "type":
      return t("errors.type");
  }
}
