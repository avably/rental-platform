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
 * Waluta pochodzi z getTenantCurrency (nie z plans.currency): e-mail musi
 * pokazać klientowi TĘ SAMĄ kwotę, którą operator widzi na ekranie
 * zamówienia — rozjazd tych źródeł byłby cichym bugiem. Locale pochodzi
 * z tenants.locale. Oba: patrz ADR-033.
 */
import {
  emailMessages,
  renderRentalCancelled,
  renderRentalConfirmed,
  renderRentalPickedUp,
  renderRentalReadyForPickup,
  renderRentalReturned,
  type RentalLifecycleEmailProps,
  type RenderedEmail,
} from "@avably/emails";
import {
  formatMoney,
  platformFromAddress,
  type CurrencyCode,
  type EmailSender,
  type Locale,
  type OrderStatus,
  type OutgoingEmail,
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
