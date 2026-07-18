/**
 * Wysyłka e-maili po utworzeniu zamówienia (wzorzec 8b — NIGDY nie blokują
 * utworzenia). Dwie wiadomości na WSPÓLNYM transporcie (ADR-033):
 *   1. rental-confirmed → KLIENT (w jego locale, ADR-037),
 *   2. new-order-notification → NAJEMCA (w locale tenanta).
 *
 * Ta funkcja NIE RZUCA — zwraca listę powodów niewysłania (pustą przy sukcesie).
 * Zamówienie jest w tym momencie już utrwalone; żaden problem z pocztą nie może
 * go cofnąć (wzorzec sendRentalEmailForTransition). Transport i dostępność są
 * wstrzykiwane, żeby testy nie biły w sieć.
 *
 * Nadawca (From) = nazwa tenanta + adres platformy (platformFromAddress, ADR-033).
 * Reply-To e-maila klienta = email_sender.reply_to (adres najemcy); Reply-To
 * powiadomienia najemcy = e-mail klienta (najemca odpowiada wprost kupującemu).
 *
 * ADRES POWIADOMIEŃ NAJEMCY (ctx.notify_email) pochodzi WYŁĄCZNIE z
 * email_sender.reply_to (ADR-042, znalezisko recenzji 2.4a): RPC nie zwraca
 * e-maila ownera z auth.users, bo odpowiedź RPC czyta każdy bezpośredni
 * wołający anon keyem — fallback byłby wyciekiem PII. Brak reply_to = brak
 * powiadomienia, z uczciwym powodem wskazującym konfigurację (wzorzec 8b).
 */
import {
  DEFAULT_CURRENCY,
  DEFAULT_TENANT_LOCALE,
  formatMoney,
  isCurrencyCode,
  isLocale,
  platformFromAddress,
  type CurrencyCode,
  type EmailAvailability,
  type EmailTransport,
  type Locale,
} from "@avably/core";
import { emailMessages, renderNewOrderNotification, renderRentalConfirmed } from "@avably/emails";

import type { CheckoutRpcResult } from "./core";

export interface CheckoutEmailDeps {
  transport: EmailTransport;
  availability: EmailAvailability;
  /** Bazowy URL panelu — link do zamówienia w powiadomieniu najemcy. */
  panelBaseUrl: string;
  /** Nadpisanie adresu platformy (test); domyślnie env/stała z @avably/core. */
  fromEmail?: string;
}

/**
 * Data w podanym locale — szablon dostaje gotowy string (kontrakt 8a). Kotwica
 * UTC: daty najmu są kalendarzowe (bez strefy), a `new Date("2026-08-01")` w
 * strefie ujemnej cofnęłoby się o dobę (lustro formatDate z panelu).
 */
function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : "nieznany błąd";
}

export async function sendCheckoutEmails(
  ctx: CheckoutRpcResult,
  deps: CheckoutEmailDeps,
): Promise<string[]> {
  const issues: string[] = [];

  // Bez skonfigurowanego transportu nie ma czego próbować — jeden uczciwy powód,
  // nie dwa udawane sukcesy (ADR-033: nigdy cichy sukces).
  if (!deps.availability.available) {
    return [deps.availability.reason ?? "Wysyłka e-maili jest niedostępna."];
  }

  const tenantLocale: Locale = isLocale(ctx.tenant.locale)
    ? ctx.tenant.locale
    : DEFAULT_TENANT_LOCALE;
  // Locale klienta: preferencja klienta, a gdy jej brak — język tenanta (ADR-037).
  const customerLocale: Locale = isLocale(ctx.customer.locale ?? "")
    ? (ctx.customer.locale as Locale)
    : tenantLocale;
  const currency: CurrencyCode = isCurrencyCode(ctx.currency) ? ctx.currency : DEFAULT_CURRENCY;
  const customerName = ctx.customer.full_name || ctx.customer.email;
  const replyTo = ctx.email_sender?.reply_to ?? undefined;
  const fromOptions = deps.fromEmail ? { fromEmail: deps.fromEmail } : {};

  // --- 1. Potwierdzenie dla klienta (rental-confirmed) ---
  try {
    const { html, text } = await renderRentalConfirmed({
      locale: customerLocale,
      tenantName: ctx.tenant.name,
      orderNumber: ctx.order_number,
      customerName,
      startDate: formatDate(ctx.start_date, customerLocale),
      endDate: formatDate(ctx.end_date, customerLocale),
      totalRentalFormatted: formatMoney(ctx.total_rental_grosze, currency, customerLocale),
    });
    await deps.transport.send({
      from: platformFromAddress(ctx.tenant.name, fromOptions),
      to: ctx.customer.email,
      subject: emailMessages(customerLocale).rentalLifecycle.confirmed.heading,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    });
  } catch (err) {
    issues.push(`Zamówienie złożone, ale potwierdzenie dla klienta nie wyszło: ${reason(err)}`);
  }

  // --- 2. Powiadomienie najemcy (new-order-notification) ---
  //
  // notify_email = null znaczy: operator nie skonfigurował adresu odpowiedzi
  // (email_sender.reply_to). Bez fallbacku na e-mail ownera (ADR-042 —
  // odpowiedź RPC nie niesie PII z auth.users); powód wskazuje wprost, co
  // skonfigurować (wzorzec uczciwej częściowej porażki 8b).
  if (!ctx.notify_email) {
    issues.push(
      "Powiadomienie najemcy nie zostało wysłane — skonfiguruj nadawcę (adres odpowiedzi) w /ustawienia-emaili.",
    );
  } else {
    try {
      const { html, text } = await renderNewOrderNotification({
        customerName,
        locale: tenantLocale,
        orderNumber: ctx.order_number,
        orderUrl: `${deps.panelBaseUrl}/${tenantLocale}/zamowienia`,
        rentalStartDate: formatDate(ctx.start_date, tenantLocale),
        rentalEndDate: formatDate(ctx.end_date, tenantLocale),
        totalAmount: formatMoney(ctx.total_rental_grosze, currency, tenantLocale),
      });
      await deps.transport.send({
        from: platformFromAddress(ctx.tenant.name, fromOptions),
        to: ctx.notify_email,
        subject: emailMessages(tenantLocale).newOrderNotification.heading,
        html,
        text,
        // Najemca odpowiada wprost kupującemu.
        replyTo: ctx.customer.email,
      });
    } catch (err) {
      issues.push(`Zamówienie złożone, ale powiadomienie najemcy nie wyszło: ${reason(err)}`);
    }
  }

  return issues;
}
