/**
 * Złożenie e-maila cyklu najmu dla tranzycji statusu (ADR-033).
 *
 * KONTRAKT SZABLONÓW (Zadanie 8a, packages/emails — pas cudzy, nietykany):
 * renderRental* przyjmuje gotowe STRINGI i zwraca {html, text}. Formatowanie
 * kwot i dat należy do WOŁAJĄCEGO — czyli tutaj — bo tylko panel zna locale
 * i walutę tenanta. Tematu szablon nie zwraca, więc budujemy go z
 * emailMessages (też eksportowane z pakietu); nagłówek wiadomości jest
 * naturalnym tematem i trzyma spójność z treścią bez duplikowania tekstów.
 *
 * Waluta pochodzi z WIERSZA ZAMÓWIENIA (orders.currency, 0049/ADR-103;
 * wcześniej getTenantCurrency): e-mail musi pokazać klientowi TĘ SAMĄ
 * kwotę, którą operator widzi na ekranie zamówienia — a oba ekrany mówią
 * odtąd walutą, w której zamówienie POWSTAŁO, więc zmiana ustawienia
 * najemcy nie przepisuje ani ekranu, ani maila. Locale pochodzi
 * z tenants.locale (ADR-033).
 */
import {
  emailMessages,
  renderRentalCancelled,
  renderRentalConfirmed,
  renderRentalPickedUp,
  renderRentalReadyForPickup,
  renderRentalReturned,
  type EmailTenantLogo,
  type RentalLifecycleEmailProps,
  type RenderedEmail,
} from "@avably/emails";
import {
  EmailConfigError,
  emailSenderFromSettings,
  formatMoney,
  platformFromAddress,
  sendAndLog,
  type CurrencyCode,
  type EmailAvailability,
  type EmailLogKind,
  type EmailLogRecorder,
  type EmailSender,
  type EmailTransport,
  type Locale,
  type OrderStatus,
  type OutgoingEmail,
  type TenantSettingRow,
} from "@avably/core";

/**
 * Typ szablonu. Odtworzony lokalnie, bo index.ts pakietu eksportuje
 * RentalLifecycleEmailProps, ale nie RentalLifecycleTemplate — a do cudzego
 * pasa nie sięgamy po jeden eksport. Zgodność pilnuje RENDERERS poniżej:
 * rozjazd nazw nie skompiluje się.
 */
type RentalLifecycleTemplate = "confirmed" | "readyForPickup" | "pickedUp" | "returned" | "cancelled";

/**
 * Tranzycja → szablon. Statusy spoza mapy (draft) NIE mają wiadomości do
 * klienta i to jest stan legalny, nie błąd — patrz buildRentalEmail → null.
 */
export const TEMPLATE_FOR_STATUS: Partial<Record<OrderStatus, RentalLifecycleTemplate>> = {
  reserved: "confirmed",
  ready_for_pickup: "readyForPickup",
  picked_up: "pickedUp",
  returned: "returned",
  cancelled: "cancelled",
};

/**
 * Szablon → rodzaj wpisu w historii wysyłek (0021/ADR-045). Osobna mapa, nie
 * przekształcenie nazwy stringiem: rodzaje są kontraktem z CHECK-iem w bazie,
 * więc rozjazd ma się nie kompilować, a nie wychodzić na 23514 przy zapisie.
 */
const LOG_KIND_FOR_TEMPLATE: Record<RentalLifecycleTemplate, EmailLogKind> = {
  confirmed: "rental_confirmed",
  readyForPickup: "rental_ready_for_pickup",
  pickedUp: "rental_picked_up",
  returned: "rental_returned",
  cancelled: "rental_cancelled",
};

const RENDERERS: Record<
  RentalLifecycleTemplate,
  (props: RentalLifecycleEmailProps) => Promise<RenderedEmail>
> = {
  confirmed: renderRentalConfirmed,
  readyForPickup: renderRentalReadyForPickup,
  pickedUp: renderRentalPickedUp,
  returned: renderRentalReturned,
  cancelled: renderRentalCancelled,
};

export interface RentalEmailInput {
  status: OrderStatus;
  locale: Locale;
  currency: CurrencyCode;
  sender: EmailSender;
  tenantName: string;
  /** Znak najemcy, KTÓREGO DOTYCZY wiadomość (ADR-175); brak = nazwa tekstem. */
  tenantLogo?: EmailTenantLogo;
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  startDate: string;
  endDate: string;
  totalRentalGrosze: number;
  pickupLocationName?: string;
  /** Nadpisanie adresu platformy (test); domyślnie env/stała z @avably/core. */
  fromEmail?: string;
}

/**
 * Data w locale tenanta — szablon dostaje gotowy string (kontrakt 8a).
 * Kotwica UTC: daty najmu są kalendarzowe (bez strefy), a `new Date("2026-08-01")`
 * w strefie ujemnej cofnęłoby się o dobę.
 */
function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

export async function buildRentalEmail(input: RentalEmailInput): Promise<OutgoingEmail | null> {
  const template = TEMPLATE_FOR_STATUS[input.status];
  if (!template) return null;

  const props: RentalLifecycleEmailProps = {
    locale: input.locale,
    tenantName: input.tenantName,
    orderNumber: input.orderNumber,
    customerName: input.customerName,
    startDate: formatDate(input.startDate, input.locale),
    endDate: formatDate(input.endDate, input.locale),
    totalRentalFormatted: formatMoney(input.totalRentalGrosze, input.currency, input.locale),
    ...(input.pickupLocationName ? { pickupLocationName: input.pickupLocationName } : {}),
    ...(input.tenantLogo ? { logo: input.tenantLogo } : {}),
  };

  const { html, text } = await RENDERERS[template](props);

  return {
    from: platformFromAddress(
      input.tenantName,
      input.fromEmail ? { fromEmail: input.fromEmail } : {},
    ),
    to: input.customerEmail,
    subject: emailMessages(input.locale).rentalLifecycle[template].heading,
    html,
    text,
    ...(input.sender.replyTo ? { replyTo: input.sender.replyTo } : {}),
  };
}

/** Wiersz zamówienia w zakresie potrzebnym do złożenia wiadomości. */
export interface RentalEmailOrderRow {
  order_number: string;
  start_date: string;
  end_date: string;
  total_rental_grosze: number;
  /** Waluta UTRWALONA na zamówieniu (orders.currency, 0049/ADR-103). */
  currency: string;
  // locale KLIENTA (customers.locale, 0016/ADR-037): opcjonalne, bo NULL/brak
  // = brak preferencji → spada na locale tenanta. CHECK 0016 gwarantuje, że
  // wartość niepusta jest w LOCALES.
  customers: { full_name: string | null; email: string; locale?: Locale | null } | null;
  pickup_locations: { name: string } | null;
}

export interface SendRentalEmailInput {
  status: OrderStatus;
  order: RentalEmailOrderRow;
  /** Zamówienie, do którego przypina się wpis historii (0021/ADR-045). */
  orderId?: string;
  tenantName: string;
  /** Znak najemcy, KTÓREGO DOTYCZY wiadomość (ADR-175); brak = nazwa tekstem. */
  tenantLogo?: EmailTenantLogo;
  locale: Locale;
  currency: CurrencyCode;
  settings: TenantSettingRow[];
  availability: EmailAvailability;
  transport: EmailTransport;
  /** Historia wysyłek; brak = wysyłka bez logu (testy jednostkowe). */
  recorder?: EmailLogRecorder;
  fromEmail?: string;
}

/**
 * Wysyłka wiadomości po UDANEJ tranzycji. Zwraca POWÓD NIEWYSŁANIA albo
 * undefined, gdy wysłano (lub gdy dla tego statusu nie ma czego wysyłać).
 *
 * NIGDY NIE RZUCA — i to jest cały sens tej funkcji. Tranzycja jest w tym
 * momencie już utrwalona w bazie; żaden problem z pocztą nie może jej cofnąć
 * ani przebrać w błąd, bo operator zobaczyłby „nie udało się" przy statusie,
 * który JEST zmieniony. Zamiast tego mówimy dokładnie, co się nie udało
 * (wzorzec uczciwej częściowej porażki z akcji kaucji, ADR-027).
 *
 * Dane dostaje w argumencie, transport wstrzyknięty — dzięki temu testuje
 * się bez Supabase i bez sieci.
 */
export async function sendRentalEmailForTransition(
  input: SendRentalEmailInput,
): Promise<string | undefined> {
  // Kolejność bramek jest celowa: najpierw powody, o których wiemy BEZ
  // renderowania czegokolwiek — żeby nie robić pracy, którą i tak
  // wyrzucimy, i żeby operator dostał najbardziej konkretny powód.
  if (!input.availability.available) return input.availability.reason;

  const email = input.order.customers?.email;
  if (!email) {
    return "Zamówienie nie ma adresu e-mail klienta — wiadomość nie została wysłana.";
  }

  let sender: EmailSender;
  try {
    sender = emailSenderFromSettings(input.settings);
  } catch (err) {
    if (err instanceof EmailConfigError) return `${err.message} Wiadomość nie została wysłana.`;
    throw err;
  }

  // Źródło locale wysyłki (ADR-037): preferencja KLIENTA, a gdy jej brak —
  // język tenanta (input.locale, już zsanityzowany przez wołającego).
  // Kontrakt buildRentalEmail bez zmian: nadal dostaje jedno gotowe locale.
  const locale = input.order.customers?.locale ?? input.locale;

  let message: OutgoingEmail | null;
  try {
    message = await buildRentalEmail({
      status: input.status,
      locale,
      currency: input.currency,
      sender,
      tenantName: input.tenantName,
      ...(input.tenantLogo ? { tenantLogo: input.tenantLogo } : {}),
      customerEmail: email,
      // Brak nazwiska nie może dać powitania „Dzień dobry, !" — adres jest
      // brzydszy, ale prawdziwy.
      customerName: input.order.customers?.full_name ?? email,
      orderNumber: input.order.order_number,
      startDate: input.order.start_date,
      endDate: input.order.end_date,
      totalRentalGrosze: input.order.total_rental_grosze,
      ...(input.order.pickup_locations?.name
        ? { pickupLocationName: input.order.pickup_locations.name }
        : {}),
      ...(input.fromEmail ? { fromEmail: input.fromEmail } : {}),
    });
  } catch (err) {
    return `Status zmieniony, ale nie udało się wysłać wiadomości: ${
      err instanceof Error ? err.message : "nieznany błąd"
    }`;
  }

  if (!message) return undefined; // status bez szablonu — nie ma czego wysyłać

  // Od tego miejsca w dół wysyłka i log idą jednym krokiem (sendAndLog):
  // wpis powstaje TAK SAMO przy sukcesie, jak przy porażce, a błąd samego
  // zapisu nie może przebrać udanej wysyłki w nieudaną (ADR-045).
  const { sendError, logIssue } = await sendAndLog({
    transport: input.transport,
    recorder: input.recorder,
    email: message,
    // `!` bezpieczne: buildRentalEmail zwróciło wiadomość WYŁĄCZNIE dla
    // statusu obecnego w TEMPLATE_FOR_STATUS, a obie mapy mają ten sam klucz.
    kind: LOG_KIND_FOR_TEMPLATE[TEMPLATE_FOR_STATUS[input.status]!],
    orderId: input.orderId ?? null,
  });

  if (sendError) {
    return `Status zmieniony, ale nie udało się wysłać wiadomości: ${
      sendError instanceof Error ? sendError.message : "nieznany błąd"
    }`;
  }
  // Wysłano; jedyne, co może tu jeszcze wrócić, to awaria samego dziennika.
  return logIssue;
}
