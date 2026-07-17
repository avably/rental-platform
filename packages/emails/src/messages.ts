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

export interface EmailMessages {
  greeting: (recipientName?: string) => string;
  layout: EmailLayoutMessages;
  emailConfirmation: EmailConfirmationMessages;
  passwordReset: PasswordResetMessages;
  organizationInvitation: OrganizationInvitationMessages;
  newOrderNotification: NewOrderNotificationMessages;
  rentalLifecycle: RentalLifecycleMessages;
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
};

export const EMAIL_MESSAGES: Record<Locale, EmailMessages> = { en, pl };

export function emailMessages(locale: Locale): EmailMessages {
  return EMAIL_MESSAGES[locale];
}
