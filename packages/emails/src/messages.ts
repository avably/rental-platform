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

export interface EmailMessages {
  greeting: (recipientName?: string) => string;
  layout: EmailLayoutMessages;
  emailConfirmation: EmailConfirmationMessages;
  passwordReset: PasswordResetMessages;
  organizationInvitation: OrganizationInvitationMessages;
  newOrderNotification: NewOrderNotificationMessages;
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
};

export const EMAIL_MESSAGES: Record<Locale, EmailMessages> = { en, pl };

export function emailMessages(locale: Locale): EmailMessages {
  return EMAIL_MESSAGES[locale];
}
