/**
 * Treści szablonów w rozbiciu na języki.
 *
 * E-mail nie ma prefiksu ścieżki ani nagłówka Accept-Language — język MUSI
 * przyjść z zewnątrz, jako locale odbiorcy (użytkownika panelu albo najemcy,
 * `tenants.locale`). Dlatego `locale` jest wymaganym propem szablonu, a nie
 * opcją z domyślnym „pl": domyślny język w e-mailach byłby cichym założeniem
 * o rynku i wysłałby polską wiadomość odbiorcy z Berlina.
 *
 * Katalog trzymamy jako typowany `Record<Locale, ...>` — brakujące
 * tłumaczenie to błąd kompilacji, nie pusty string na produkcji.
 */
import type { Locale } from "@avably/core";

export interface EmailLayoutMessages {
  fallbackHint: string;
  footerTagline: string;
  footerAutomated: string;
}

export interface EmailConfirmationMessages {
  heading: string;
  cta: string;
  preview: string;
  body: string;
}

export interface PasswordResetMessages {
  heading: string;
  cta: string;
  preview: string;
  requested: string;
  ignore: string;
}

/**
 * Powiadomienie o ZMIANIE hasła (R14/M-01, ADR-122) — wysyłane po fakcie,
 * bez żadnego tokenu w treści: jedyny link prowadzi na formularz prośby
 * o reset, bo jeśli zmiany nie wykonał właściciel konta, natychmiastowy
 * reset (unieważniający sesje) jest jego drogą odzyskania kontroli.
 */
export interface PasswordChangedMessages {
  heading: string;
  cta: string;
  preview: string;
  changed: string;
  notYou: string;
}

export interface OrganizationInvitationMessages {
  heading: string;
  cta: string;
  preview: (organizationName: string) => string;
  invitedBy: string;
  roleLabel: string;
  roles: { owner: string; staff: string };
}

export interface NewOrderNotificationMessages {
  heading: string;
  cta: string;
  preview: (orderNumber: string) => string;
  intro: string;
  fields: {
    number: string;
    customer: string;
    amount: string;
    rentalPeriod: string;
  };
}

export interface RentalLifecycleStatusMessages {
  body: string;
  heading: string;
  preview: (orderNumber: string) => string;
}

export interface ReturnLabelMessages {
  heading: string;
  preview: (orderNumber: string) => string;
  /** Data końca najmu przychodzi SFORMATOWANA (kontrakt 8a). */
  body: (endDate: string) => string;
  attachmentHint: string;
  fields: {
    orderNumber: string;
    shipmentNumber: string;
    carrier: string;
  };
}

export interface PickupReturnReminderMessages {
  heading: string;
  preview: (orderNumber: string) => string;
  /** Data końca najmu przychodzi SFORMATOWANA (kontrakt 8a). */
  body: (endDate: string) => string;
  fields: {
    orderNumber: string;
    location: string;
    address: string;
    phone: string;
    openingHours: string;
  };
}

export interface RentalContractMessages {
  heading: string;
  preview: (orderNumber: string) => string;
  body: string;
  attachmentHint: string;
  orderNumber: string;
}

export interface RentalLifecycleMessages {
  cancelled: RentalLifecycleStatusMessages;
  confirmed: RentalLifecycleStatusMessages;
  footerAutomated: string;
  greeting: (customerName: string) => string;
  fields: {
    orderNumber: string;
    pickupLocation: string;
    rentalPeriod: string;
    totalRental: string;
  };
  pickedUp: RentalLifecycleStatusMessages;
  readyForPickup: RentalLifecycleStatusMessages;
  returned: RentalLifecycleStatusMessages;
}

export interface ContactMessageMessages {
  heading: string;
  preview: (senderName: string) => string;
  intro: string;
  footer: string;
  /** Subject wiadomości — składa go wysyłka, treść zostaje przy tłumaczeniach. */
  subject: (senderName: string) => string;
  fields: { name: string; email: string; phone: string };
}

/**
 * Mail dunningowy do NAJEMCY (J2 faza 2a, ADR-136) — jeden szablon na
 * `invoice.payment_failed`. Ton rzeczowy, BEZ odliczania dni: zegar ponowień
 * należy do dostawcy płatności (zasada 1 okna dunningowego), a „ton rosnący"
 * i maile przedostatni/ostatni to faza 2b.
 */
export interface SaasPaymentFailedMessages {
  heading: string;
  cta: string;
  preview: (organizationName: string) => string;
  intro: (organizationName: string) => string;
  retry: string;
  action: string;
}

/**
 * Potwierdzenie ZAKSIĘGOWANIA płatności dla klienta końcowego (ADR-139) —
 * mail obiecany przez stronę statusu checkoutu w stanie „sprawdzamy".
 * Ton rzeczowy, ZERO obietnic ponad stan: potwierdzamy wyłącznie fakt
 * zaksięgowania kwoty; o wydaniu sprzętu mówią maile cyklu najmu.
 */
export interface PaymentConfirmedMessages {
  heading: string;
  preview: (orderNumber: string) => string;
  body: string;
  fields: {
    orderNumber: string;
    amountPaid: string;
  };
}

export interface EmailMessages {
  greeting: (recipientName?: string) => string;
  layout: EmailLayoutMessages;
  emailConfirmation: EmailConfirmationMessages;
  passwordReset: PasswordResetMessages;
  passwordChanged: PasswordChangedMessages;
  organizationInvitation: OrganizationInvitationMessages;
  newOrderNotification: NewOrderNotificationMessages;
  rentalLifecycle: RentalLifecycleMessages;
  returnLabel: ReturnLabelMessages;
  pickupReturnReminder: PickupReturnReminderMessages;
  rentalContract: RentalContractMessages;
  contactMessage: ContactMessageMessages;
  saasPaymentFailed: SaasPaymentFailedMessages;
  paymentConfirmed: PaymentConfirmedMessages;
}

const pl: EmailMessages = {
  greeting: (recipientName) => (recipientName ? `Cześć, ${recipientName}!` : "Cześć!"),
  layout: {
    fallbackHint: "Jeśli przycisk nie działa, skopiuj ten link do przeglądarki:",
    footerTagline: "platforma do zarządzania wynajmem",
    footerAutomated: "To wiadomość automatyczna dotycząca Twojego konta.",
  },
  emailConfirmation: {
    heading: "Potwierdź adres e-mail",
    cta: "Potwierdź adres e-mail",
    preview: "Potwierdź adres e-mail w Avably.",
    body: "Potwierdź swój adres e-mail, aby dokończyć tworzenie konta.",
  },
  passwordReset: {
    heading: "Ustaw nowe hasło",
    cta: "Ustaw nowe hasło",
    preview: "Ustaw nowe hasło do konta w Avably.",
    requested: "Otrzymaliśmy prośbę o ustawienie nowego hasła do Twojego konta.",
    ignore: "Jeśli to nie Ty, zignoruj tę wiadomość. Twoje hasło się nie zmieni.",
  },
  passwordChanged: {
    heading: "Twoje hasło zostało zmienione",
    cta: "Poproś o reset hasła",
    preview: "Hasło do Twojego konta w Avably zostało właśnie zmienione.",
    changed:
      "Hasło do Twojego konta zostało właśnie zmienione, a pozostałe sesje wylogowane.",
    notYou:
      "Jeśli to nie Ty, natychmiast poproś o reset hasła przyciskiem poniżej — ustawienie nowego hasła odetnie osobę, która zna obecne.",
  },
  organizationInvitation: {
    heading: "Zaproszenie do organizacji",
    cta: "Dołącz do organizacji",
    preview: (organizationName) => `Dołącz do organizacji ${organizationName} w Avably.`,
    invitedBy: "zaprasza Cię do swojego konta.",
    roleLabel: "Twoja rola",
    roles: { owner: "właściciel", staff: "pracownik" },
  },
  newOrderNotification: {
    heading: "Nowe zamówienie",
    cta: "Zobacz zamówienie",
    preview: (orderNumber) => `Nowe zamówienie ${orderNumber} w Avably.`,
    intro: "Wpadło nowe zamówienie. Najważniejsze dane znajdziesz poniżej.",
    fields: {
      number: "Numer",
      customer: "Klient",
      amount: "Kwota",
      rentalPeriod: "Okres wynajmu",
    },
  },
  rentalLifecycle: {
    greeting: (customerName) => `Dzień dobry, ${customerName}!`,
    footerAutomated: "Wiadomość automatyczna dotycząca Twojego wynajmu.",
    fields: {
      orderNumber: "Numer zamówienia",
      pickupLocation: "Miejsce odbioru",
      rentalPeriod: "Okres wynajmu",
      totalRental: "Wartość wynajmu",
    },
    confirmed: {
      heading: "Rezerwacja potwierdzona",
      preview: (orderNumber) => `Rezerwacja ${orderNumber} została potwierdzona.`,
      body: "Potwierdziliśmy Twoją rezerwację. Szczegóły znajdziesz poniżej.",
    },
    readyForPickup: {
      heading: "Sprzęt jest gotowy do odbioru",
      preview: (orderNumber) => `Zamówienie ${orderNumber} jest gotowe do odbioru.`,
      body: "Sprzęt jest przygotowany i czeka na odbiór.",
    },
    pickedUp: {
      heading: "Sprzęt został wydany",
      preview: (orderNumber) => `Potwierdzenie wydania sprzętu — ${orderNumber}.`,
      body: "Potwierdzamy wydanie sprzętu.",
    },
    returned: {
      heading: "Sprzęt został zwrócony",
      preview: (orderNumber) => `Potwierdzenie zwrotu sprzętu — ${orderNumber}.`,
      body: "Potwierdzamy zwrot sprzętu. Dziękujemy.",
    },
    cancelled: {
      heading: "Zamówienie anulowane",
      preview: (orderNumber) => `Zamówienie ${orderNumber} zostało anulowane.`,
      body: "Potwierdzamy anulowanie zamówienia.",
    },
  },
  returnLabel: {
    heading: "Etykieta zwrotna do Twojego wynajmu",
    preview: (orderNumber) => `Etykieta zwrotna do zamówienia ${orderNumber}.`,
    body: (endDate) =>
      `Twój najem kończy się ${endDate}. W załączniku znajdziesz etykietę zwrotną — wydrukuj ją, naklej na paczkę i nadaj przesyłkę.`,
    attachmentHint: "Etykieta zwrotna (PDF) jest załączona do tej wiadomości.",
    fields: {
      orderNumber: "Numer zamówienia",
      shipmentNumber: "Numer przesyłki",
      carrier: "Przewoźnik",
    },
  },
  pickupReturnReminder: {
    heading: "Przypomnienie o zwrocie sprzętu",
    preview: (orderNumber) => `Przypomnienie o zwrocie sprzętu — zamówienie ${orderNumber}.`,
    body: (endDate) => `Twój najem kończy się ${endDate}. Zwróć sprzęt w punkcie:`,
    fields: {
      orderNumber: "Numer zamówienia",
      location: "Punkt",
      address: "Adres",
      phone: "Telefon",
      openingHours: "Godziny otwarcia",
    },
  },
  rentalContract: {
    heading: "Umowa najmu",
    preview: (orderNumber) => `Umowa najmu do zamówienia ${orderNumber}.`,
    body: "Przesyłamy umowę najmu dotyczącą Twojego zamówienia.",
    attachmentHint: "Umowa najmu (PDF) znajduje się w załączniku.",
    orderNumber: "Numer zamówienia",
  },
  contactMessage: {
    heading: "Wiadomość ze strony",
    preview: (senderName) => `Nowa wiadomość od ${senderName} ze strony sklepu.`,
    intro: "Ktoś napisał do Was przez formularz kontaktowy na stronie.",
    footer: "Wiadomość wysłana przez formularz kontaktowy na Waszej stronie. Odpowiedz na nią zwykłym „Odpowiedz” — trafi wprost do nadawcy.",
    subject: (senderName) => `Wiadomość ze strony: ${senderName}`,
    fields: { name: "Imię", email: "E-mail", phone: "Telefon" },
  },
  saasPaymentFailed: {
    heading: "Płatność za abonament nie powiodła się",
    cta: "Przejdź do rozliczeń",
    preview: (organizationName) =>
      `Płatność za abonament Avably organizacji ${organizationName} nie powiodła się.`,
    intro: (organizationName) =>
      `Ostatnia płatność za abonament Avably organizacji ${organizationName} nie doszła do skutku.`,
    retry:
      "Dostawca płatności ponowi próbę automatycznie. Najczęstszy powód to wygasła albo zablokowana karta.",
    action:
      "Sprawdź metodę płatności w sekcji „Plan i rozliczenia” w panelu — po udanej płatności konto wraca do pełnej sprawności od razu.",
  },
  paymentConfirmed: {
    heading: "Płatność zaksięgowana",
    preview: (orderNumber) => `Płatność za zamówienie ${orderNumber} została zaksięgowana.`,
    body: "Potwierdzamy zaksięgowanie płatności za Twoje zamówienie. Szczegóły znajdziesz poniżej.",
    fields: {
      orderNumber: "Numer zamówienia",
      amountPaid: "Opłacona kwota",
    },
  },
};

const en: EmailMessages = {
  greeting: (recipientName) => (recipientName ? `Hi ${recipientName}!` : "Hi!"),
  layout: {
    fallbackHint: "If the button does not work, copy this link into your browser:",
    footerTagline: "rental management platform",
    footerAutomated: "This is an automated message about your account.",
  },
  emailConfirmation: {
    heading: "Confirm your email address",
    cta: "Confirm email address",
    preview: "Confirm your email address for Avably.",
    body: "Confirm your email address to finish creating your account.",
  },
  passwordReset: {
    heading: "Set a new password",
    cta: "Set a new password",
    preview: "Set a new password for your Avably account.",
    requested: "We received a request to set a new password for your account.",
    ignore: "If this was not you, ignore this message. Your password will not change.",
  },
  passwordChanged: {
    heading: "Your password was changed",
    cta: "Request a password reset",
    preview: "The password for your Avably account was just changed.",
    changed: "The password for your account was just changed and your other sessions were signed out.",
    notYou:
      "If this was not you, request a password reset immediately using the button below — setting a new password will cut off whoever knows the current one.",
  },
  organizationInvitation: {
    heading: "Invitation to an organization",
    cta: "Join the organization",
    preview: (organizationName) => `Join ${organizationName} on Avably.`,
    invitedBy: "is inviting you to their account.",
    roleLabel: "Your role",
    roles: { owner: "owner", staff: "staff" },
  },
  newOrderNotification: {
    heading: "New order",
    cta: "View order",
    preview: (orderNumber) => `New order ${orderNumber} on Avably.`,
    intro: "A new order came in. The key details are below.",
    fields: {
      number: "Number",
      customer: "Customer",
      amount: "Amount",
      rentalPeriod: "Rental period",
    },
  },
  rentalLifecycle: {
    greeting: (customerName) => `Hello ${customerName},`,
    footerAutomated: "This is an automated message about your rental.",
    fields: {
      orderNumber: "Order number",
      pickupLocation: "Pickup location",
      rentalPeriod: "Rental period",
      totalRental: "Rental total",
    },
    confirmed: {
      heading: "Reservation confirmed",
      preview: (orderNumber) => `Reservation ${orderNumber} has been confirmed.`,
      body: "Your reservation is confirmed. The details are below.",
    },
    readyForPickup: {
      heading: "Equipment ready for pickup",
      preview: (orderNumber) => `Order ${orderNumber} is ready for pickup.`,
      body: "Your equipment is ready for pickup.",
    },
    pickedUp: {
      heading: "Equipment picked up",
      preview: (orderNumber) => `Equipment pickup confirmed — ${orderNumber}.`,
      body: "We've recorded the equipment pickup.",
    },
    returned: {
      heading: "Equipment returned",
      preview: (orderNumber) => `Equipment return confirmed — ${orderNumber}.`,
      body: "We've recorded the equipment return. Thank you.",
    },
    cancelled: {
      heading: "Order cancelled",
      preview: (orderNumber) => `Order ${orderNumber} has been cancelled.`,
      body: "Your order has been cancelled.",
    },
  },
  returnLabel: {
    heading: "Return label for your rental",
    preview: (orderNumber) => `Return label for order ${orderNumber}.`,
    body: (endDate) =>
      `Your rental ends on ${endDate}. The return label is attached — print it, stick it on the parcel and ship it back.`,
    attachmentHint: "The return label (PDF) is attached to this message.",
    fields: {
      orderNumber: "Order number",
      shipmentNumber: "Shipment number",
      carrier: "Carrier",
    },
  },
  pickupReturnReminder: {
    heading: "Equipment return reminder",
    preview: (orderNumber) => `Equipment return reminder — order ${orderNumber}.`,
    body: (endDate) => `Your rental ends on ${endDate}. Please return the equipment at:`,
    fields: {
      orderNumber: "Order number",
      location: "Location",
      address: "Address",
      phone: "Phone",
      openingHours: "Opening hours",
    },
  },
  rentalContract: {
    heading: "Rental agreement",
    preview: (orderNumber) => `Rental agreement for order ${orderNumber}.`,
    body: "Please find the rental agreement for your order attached.",
    attachmentHint: "The rental agreement (PDF) is attached to this message.",
    orderNumber: "Order number",
  },
  contactMessage: {
    heading: "Message from your website",
    preview: (senderName) => `New message from ${senderName} via your storefront.`,
    intro: "Someone wrote to you through the contact form on your website.",
    footer: "Sent through the contact form on your website. Just hit Reply — it goes straight to the sender.",
    subject: (senderName) => `Website message: ${senderName}`,
    fields: { name: "Name", email: "Email", phone: "Phone" },
  },
  saasPaymentFailed: {
    heading: "Subscription payment failed",
    cta: "Go to billing",
    preview: (organizationName) =>
      `The Avably subscription payment for ${organizationName} failed.`,
    intro: (organizationName) =>
      `The latest payment for the Avably subscription of ${organizationName} did not go through.`,
    retry:
      "The payment provider will retry automatically. The most common cause is an expired or blocked card.",
    action:
      "Check your payment method in the “Plan & billing” section of the panel — once a payment succeeds, your account is fully restored right away.",
  },
  paymentConfirmed: {
    heading: "Payment confirmed",
    preview: (orderNumber) => `The payment for order ${orderNumber} has been confirmed.`,
    body: "We confirm that the payment for your order has been received. The details are below.",
    fields: {
      orderNumber: "Order number",
      amountPaid: "Amount paid",
    },
  },
};

export const EMAIL_MESSAGES: Record<Locale, EmailMessages> = { en, pl };

export function emailMessages(locale: Locale): EmailMessages {
  return EMAIL_MESSAGES[locale];
}
