/**
 * Wysyłka e-maili po utworzeniu zamówienia (wzorzec 8b — NIGDY nie blokują
 * utworzenia). Do DWÓCH wiadomości na WSPÓLNYM transporcie (ADR-033):
 *   1. rental-confirmed → KLIENT (w jego locale, ADR-037) — TYLKO tor offline,
 *   2. new-order-notification → NAJEMCA (w locale tenanta) — zawsze.
 *
 * TOR ONLINE (payment_provider='stripe') NIE dostaje potwierdzenia klienta
 * TUTAJ (ADR-271): przy checkoucie płatność jeszcze nie zaszła, więc
 * „Rezerwacja potwierdzona" byłaby fałszem. Klient dostaje potwierdzenie
 * dopiero po zapłacie — mailem „płatność zaksięgowana" ze ścieżki sukcesu
 * płatności (`sendPaymentConfirmedEmail`, ADR-139). Powiadomienie NAJEMCY
 * idzie dla obu torów: najemca ma prawo wiedzieć o zamówieniu `pending`.
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
  sendAndLog,
  type CurrencyCode,
  type EmailAvailability,
  type EmailLogRecorder,
  type EmailTransport,
  type Locale,
} from "@avably/core";
import {
  emailMessages,
  renderNewOrderNotification,
  renderRentalConfirmed,
  type EmailTenantLogo,
} from "@avably/emails";

import type { CheckoutRpcResult } from "./core";

export interface CheckoutEmailDeps {
  transport: EmailTransport;
  availability: EmailAvailability;
  /** Bazowy URL panelu — link do zamówienia w powiadomieniu najemcy. */
  panelBaseUrl: string;
  /**
   * Historia wysyłek (0021/ADR-045). Storefront NIE MA klucza service-role,
   * więc implementacja idzie funkcją SECURITY DEFINER — nie insertem w tabelę.
   * Brak = wysyłka bez logu (testy jednostkowe).
   */
  recorder?: EmailLogRecorder;
  /** Nadpisanie adresu platformy (test); domyślnie env/stała z @avably/core. */
  fromEmail?: string;
  /**
   * ZNAK NAJEMCY, U KTÓREGO ZŁOŻONO ZAMÓWIENIE (ADR-175).
   *
   * Wchodzi WYŁĄCZNIE do potwierdzenia dla KLIENTA. Powiadomienie najemcy
   * jedzie ramką platformy (marka Avably) i to jest ta sama granica, co
   * w ADR-036 D2: klient dostaje wiadomość od wypożyczalni, a operator
   * — od systemu, którego używa.
   *
   * Rozstrzyga go WOŁAJĄCY z powłoki najemcy (tor `get_tenant_appearance`,
   * czyli kolumna OPUBLIKOWANA), bo tylko on zna adres publiczny bucketa.
   */
  tenantLogo?: EmailTenantLogo;
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
  //
  // Rodzaj wpisu to `checkout_confirmation`, NIE `rental_confirmed`: szablon
  // jest wspólny, ale ścieżka (publiczna, anonowa) i diagnoza przy awarii —
  // inne. Sklejenie ich kosztowałoby dokładnie tę informację, po którą
  // operator otwiera historię (0021).
  //
  // TYLKO TOR OFFLINE (payment_provider !== "stripe") — ADR-271.
  //
  // „Rezerwacja potwierdzona" stwierdza fakt dokonany. Dla toru online
  // (`stripe`) w momencie checkoutu ten fakt JESZCZE nie zaszedł: zamówienie
  // jest `pending`/`unpaid`, a płatność następuje na kroku PO tym miejscu
  // (`nextStep: "payment"` w core.ts). Wysłanie potwierdzenia tutaj mówiłoby
  // klientowi „masz rezerwację", zanim zapłacił — mógłby uznać, że nie musi
  // kończyć płatności. Dlatego dla `stripe` potwierdzenie klienta NIE wychodzi
  // przy checkoucie; wychodzi ZE ŚCIEŻKI SUKCESU PŁATNOŚCI jako mail
  // „płatność zaksięgowana" (`sendPaymentConfirmedEmail`, ADR-139), wołany
  // z webhooka/pętli rekoncyliacji/przycisku operatora dokładnie raz na
  // przejście w `paid` (compare-and-set `changed: true`). Reużywamy tamtą
  // wysyłkę zamiast dublować rental-confirmed: to samo zdarzenie biznesowe
  // (klient dostaje potwierdzenie po zapłacie), jedna idempotentna ścieżka.
  //
  // Warunek patrzy na `payment_provider` z WIERSZA (utrwalone przez serwer),
  // nie na deklarację klienta — lustro bramki `nextStep` w core.ts. Tor
  // offline (przelew/gotówka, `manual`) zachowuje zastane: tam checkout JEST
  // przyjęciem rezerwacji, bo płatność dzieje się poza systemem.
  if (ctx.payment_provider !== "stripe") {
    try {
      const { html, text } = await renderRentalConfirmed({
        locale: customerLocale,
        tenantName: ctx.tenant.name,
        orderNumber: ctx.order_number,
        customerName,
        startDate: formatDate(ctx.start_date, customerLocale),
        endDate: formatDate(ctx.end_date, customerLocale),
        totalRentalFormatted: formatMoney(ctx.total_rental_grosze, currency, customerLocale),
        ...(deps.tenantLogo ? { logo: deps.tenantLogo } : {}),
      });
      const { sendError, logIssue } = await sendAndLog({
        transport: deps.transport,
        recorder: deps.recorder,
        kind: "checkout_confirmation",
        email: {
          from: platformFromAddress(ctx.tenant.name, fromOptions),
          to: ctx.customer.email,
          subject: emailMessages(customerLocale).rentalLifecycle.confirmed.heading,
          html,
          text,
          ...(replyTo ? { replyTo } : {}),
        },
      });
      if (sendError) {
        issues.push(
          `Zamówienie złożone, ale potwierdzenie dla klienta nie wyszło: ${reason(sendError)}`,
        );
      }
      if (logIssue) issues.push(logIssue);
    } catch (err) {
      issues.push(`Zamówienie złożone, ale potwierdzenie dla klienta nie wyszło: ${reason(err)}`);
    }
  }

  // --- 2. Powiadomienie najemcy (new-order-notification) ---
  //
  // notify_email = null znaczy: operator nie skonfigurował adresu odpowiedzi
  // (email_sender.reply_to). Bez fallbacku na e-mail ownera (ADR-042 —
  // odpowiedź RPC nie niesie PII z auth.users); powód wskazuje wprost, co
  // skonfigurować (wzorzec uczciwej częściowej porażki 8b).
  if (!ctx.notify_email) {
    issues.push(
      "Powiadomienie najemcy nie zostało wysłane - skonfiguruj nadawcę (adres odpowiedzi) w /ustawienia-emaili.",
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
      const { sendError, logIssue } = await sendAndLog({
        transport: deps.transport,
        recorder: deps.recorder,
        kind: "new_order_notification",
        email: {
          from: platformFromAddress(ctx.tenant.name, fromOptions),
          to: ctx.notify_email,
          subject: emailMessages(tenantLocale).newOrderNotification.heading,
          html,
          text,
          // Najemca odpowiada wprost kupującemu.
          replyTo: ctx.customer.email,
        },
      });
      if (sendError) {
        issues.push(`Zamówienie złożone, ale powiadomienie najemcy nie wyszło: ${reason(sendError)}`);
      }
      if (logIssue) issues.push(logIssue);
    } catch (err) {
      issues.push(`Zamówienie złożone, ale powiadomienie najemcy nie wyszło: ${reason(err)}`);
    }
  }

  return issues;
}
