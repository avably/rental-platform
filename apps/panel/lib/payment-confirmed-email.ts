/**
 * Mail „płatność zaksięgowana" do klienta końcowego (ADR-139) — KROK PO
 * utrwalonym przejściu `payment_status` w `paid`, nigdy jego warunek.
 *
 * ================== KTO TĘDY WCHODZI I DLACZEGO WSZYSCY ==================
 *
 * Przejście w `paid` wykonują TRZY wejścia i wszystkie przez wspólny rdzeń
 * `applySettlement` (L11, ADR-104): webhook (przyszło zdarzenie), pętla
 * rekoncyliacji (zdarzenie nie przyszło) i przycisk operatora „Sprawdź
 * status płatności". Klient zapłacił tak samo niezależnie od tego, którą
 * drogą MY się o tym dowiedzieliśmy — więc potwierdzenie dostaje z każdej
 * z nich (rozstrzygnięcie ADR-139). Ta funkcja jest wołana wyłącznie
 * z miejsc, które właśnie dostały `changed: true` i `paymentStatus='paid'`
 * z tego rdzenia.
 *
 * ================== IDEMPOTENCJA — DLACZEGO `changed: true` WYSTARCZA =====
 *
 * `changed: true` zwraca compare-and-set potwierdzony ODCZYTEM po zapisie —
 * przy wyścigu dwóch wejść dostaje je dokładnie jedno. Drugiego przejścia
 * DO `paid` nie ma skąd wziąć: bramka reżimu stripe (0027) nie wpuszcza
 * regresu z `paid`, więc nie istnieje sekwencja, w której warunek spełnia
 * się dwa razy. Ponowna dostawa tego samego zdarzenia odpada wcześniej
 * (dzierżawa `webhook_events`, ADR-024), a rejestr `email_logs` utrwala,
 * co i do kogo wyszło. Świadoma luka (spisana w ADR-139): gdy zapis stanu
 * się powiódł, ale potwierdzający go odczyt PADŁ, ponowna dostawa zastaje
 * `paid` bez zmiany (`changed: false`) i maila nie wysyła — rejestr mówi
 * wtedy prawdę, a „naprawa" wymagałaby zgadywania, czy klient już dostał.
 *
 * ================== NIGDY NIE RZUCA (wzorzec 8b, ADR-033/046) =============
 *
 * Przejście jest w tym momencie UTRWALONE — żaden problem z pocztą nie może
 * go cofnąć ani przebrać w błąd. Brak klucza transportu, brak adresu
 * klienta, wadliwa konfiguracja nadawcy: każdy z tych stanów wraca jako
 * POWÓD (string), który wołający zapisuje w swoim rejestrze
 * (`webhook_events.error` przy `processed`, `reason` wpisu rekoncyliacji) —
 * nigdy cichy sukces, nigdy 5xx wywołujący pętlę retry u dostawcy.
 *
 * ================== DLACZEGO REJESTR PISZE KLIENT WOŁAJĄCEGO ==============
 *
 * Wejścia tego maila działają BEZ sesji członka (webhook i job — klient
 * service-role; ścieżka przycisku przechodzi przez ten sam moduł jobów),
 * więc wpis do `email_logs` idzie tym samym klientem, którym zapisano stan.
 * `tenant_id` wpisu NIE przychodzi z zewnątrz na słowo: odczyt zamówienia
 * niżej filtruje po OBU kolumnach (tenant + id) — pomyłka wołającego kończy
 * się brakiem wiersza i powodem, nie mailem z cudzymi danymi.
 */
import {
  DEFAULT_CURRENCY,
  DEFAULT_TENANT_LOCALE,
  EMAIL_SENDER_KEY,
  EmailConfigError,
  emailAvailability,
  emailSenderFromSettings,
  formatMoney,
  isCurrencyCode,
  isLocale,
  platformFromAddress,
  resendTransport,
  sendAndLog,
  type CurrencyCode,
  type EmailAvailability,
  type EmailTransport,
  type Locale,
  type TenantSettingRow,
} from "@avably/core";
import { emailMessages, renderPaymentConfirmed } from "@avably/emails";
import type { SupabaseClient } from "@supabase/supabase-js";

import { panelEmailLogRecorder } from "./email-log";

/**
 * Nadpisania transportu — wyłącznie dla testów i wejść, które chcą wstrzyknąć
 * granicę sieci. Produkcyjne wejścia nie podają nic: transport i dostępność
 * powstają z env dokładnie tak, jak w pozostałych ścieżkach wysyłki.
 */
export interface PaymentConfirmedEmailOverrides {
  transport?: EmailTransport;
  availability?: EmailAvailability;
  /** Nadpisanie adresu platformy (test); domyślnie env/stała z @avably/core. */
  fromEmail?: string;
}

export interface PaymentConfirmedEmailInput extends PaymentConfirmedEmailOverrides {
  tenantId: string;
  orderId: string;
}

interface OrderEmailRow {
  order_number: string;
  total_rental_grosze: number;
  total_deposit_grosze: number;
  delivery_grosze: number;
  /** Waluta UTRWALONA na zamówieniu (0049, ADR-103) — z niej powstał intent. */
  currency: string;
  customers: { full_name: string | null; email: string; locale?: Locale | null } | null;
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : "nieznany błąd";
}

/**
 * Wysyłka potwierdzenia zaksięgowania płatności. Zwraca POWÓD niewysłania
 * albo undefined (wysłano). NIGDY nie rzuca.
 */
export async function sendPaymentConfirmedEmail(
  db: SupabaseClient,
  input: PaymentConfirmedEmailInput,
): Promise<string | undefined> {
  try {
    const availability = input.availability ?? emailAvailability();
    if (!availability.available) {
      return `Potwierdzenie płatności nie zostało wysłane: ${
        availability.reason ?? "wysyłka e-maili jest niedostępna."
      }`;
    }

    // Zapytania są niezależne — jedna runda. Filtr zamówienia po OBU
    // kolumnach (tenant + id): patrz nagłówek pliku.
    const [orderResult, tenantResult, settingsResult] = await Promise.all([
      db
        .from("orders")
        .select(
          "order_number, total_rental_grosze, total_deposit_grosze, delivery_grosze, currency, customers(full_name, email, locale)",
        )
        .eq("tenant_id", input.tenantId)
        .eq("id", input.orderId)
        .maybeSingle(),
      db.from("tenants").select("name, locale").eq("id", input.tenantId).maybeSingle(),
      db
        .from("tenant_settings")
        .select("key, value")
        .eq("tenant_id", input.tenantId)
        .eq("key", EMAIL_SENDER_KEY),
    ]);

    const order = orderResult.data as OrderEmailRow | null;
    const tenant = tenantResult.data as { name: string; locale: string | null } | null;
    if (orderResult.error || tenantResult.error || !order || !tenant) {
      return (
        "Nie udało się odczytać danych do potwierdzenia płatności — " +
        "klient nie dostał wiadomości: " +
        (orderResult.error?.message ?? tenantResult.error?.message ?? "brak wiersza.")
      );
    }

    const customerEmail = order.customers?.email;
    if (!customerEmail) {
      return "Zamówienie nie ma adresu e-mail klienta — potwierdzenie płatności nie zostało wysłane.";
    }

    // reply_to z email_sender: BRAK wiersza jest legalny (fallback ADR-036 D2,
    // wzorzec zaproszeń), OBECNY ale wadliwy → uczciwy powód zamiast wysyłki
    // z konfiguracją, o której wiemy, że jest zepsuta.
    const settings = (settingsResult.data ?? []) as TenantSettingRow[];
    let replyTo: string | undefined;
    if (settings.some((row) => row.key === EMAIL_SENDER_KEY)) {
      try {
        replyTo = emailSenderFromSettings(settings).replyTo;
      } catch (err) {
        if (err instanceof EmailConfigError) {
          return `${err.message} Potwierdzenie płatności nie zostało wysłane.`;
        }
        throw err;
      }
    }

    // Locale wysyłki (ADR-037): preferencja KLIENTA, a gdy jej brak — język
    // tenanta; nieznana wartość spada na domyślne (lustro Z9).
    const tenantLocale: Locale = isLocale(tenant.locale ?? "")
      ? (tenant.locale as Locale)
      : DEFAULT_TENANT_LOCALE;
    const locale: Locale =
      order.customers?.locale && isLocale(order.customers.locale)
        ? order.customers.locale
        : tenantLocale;
    const currency: CurrencyCode = isCurrencyCode(order.currency)
      ? order.currency
      : DEFAULT_CURRENCY;

    // Kwota ZAKSIĘGOWANA = najem + kaucja + dostawa: ta sama arytmetyka,
    // z której powstał intent i którą werdykt porównał z odczytem
    // (`expectedGrosze` w webhooku i pętli). Mail potwierdza to, co klient
    // realnie zapłacił — nie sam czynsz najmu.
    const amountGrosze =
      order.total_rental_grosze + order.total_deposit_grosze + order.delivery_grosze;

    const { html, text } = await renderPaymentConfirmed({
      locale,
      tenantName: tenant.name,
      orderNumber: order.order_number,
      // Brak nazwiska nie może dać powitania „Dzień dobry, !" — adres jest
      // brzydszy, ale prawdziwy (wzorzec maili cyklu najmu).
      customerName: order.customers?.full_name ?? customerEmail,
      amountPaidFormatted: formatMoney(amountGrosze, currency, locale),
    });

    const { sendError, logIssue } = await sendAndLog({
      transport: input.transport ?? resendTransport(),
      recorder: panelEmailLogRecorder(db, input.tenantId),
      kind: "payment_confirmed",
      orderId: input.orderId,
      email: {
        from: platformFromAddress(
          tenant.name,
          input.fromEmail ? { fromEmail: input.fromEmail } : {},
        ),
        to: customerEmail,
        subject: emailMessages(locale).paymentConfirmed.heading,
        html,
        text,
        ...(replyTo ? { replyTo } : {}),
      },
    });

    if (sendError) {
      return `Płatność zaksięgowana, ale potwierdzenie dla klienta nie wyszło: ${reason(sendError)}`;
    }
    return logIssue;
  } catch (err) {
    // Ostatnia siatka: render albo nieprzewidziany błąd — przejście jest
    // utrwalone, więc jedyną uczciwą odpowiedzią jest powód, nie wyjątek.
    return `Płatność zaksięgowana, ale potwierdzenie dla klienta nie wyszło: ${reason(err)}`;
  }
}
