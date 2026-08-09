import { createElement, type ReactElement } from "react";
import { render } from "react-email";

import {
  EmailConfirmation,
  type EmailConfirmationProps,
} from "./templates/email-confirmation";
import {
  PasswordChanged,
  type PasswordChangedProps,
} from "./templates/password-changed";
import {
  PasswordReset,
  type PasswordResetProps,
} from "./templates/password-reset";
import {
  OrganizationInvitation,
  type OrganizationInvitationProps,
} from "./templates/organization-invitation";
import {
  NewOrderNotification,
  type NewOrderNotificationProps,
} from "./templates/new-order-notification";
import { RentalCancelled } from "./templates/rental-cancelled";
import { RentalConfirmed } from "./templates/rental-confirmed";
import type { RentalLifecycleEmailProps } from "./templates/rental-lifecycle-email";
import {
  PickupReturnReminderEmail,
  type PickupReturnReminderEmailProps,
} from "./templates/pickup-return-reminder";
import { RentalPickedUp } from "./templates/rental-picked-up";
import { RentalReadyForPickup } from "./templates/rental-ready-for-pickup";
import { RentalReturned } from "./templates/rental-returned";
import {
  ReturnLabelEmail,
  type ReturnLabelEmailProps,
} from "./templates/return-label";
import {
  RentalContractEmail,
  type RentalContractEmailProps,
} from "./templates/rental-contract";
import {
  ContactMessageEmail,
  type ContactMessageEmailProps,
} from "./templates/contact-message";

export interface RenderedEmail {
  html: string;
  text: string;
}

async function renderVariants(element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { html, text };
}

export function renderEmailConfirmation(
  props: EmailConfirmationProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(EmailConfirmation, props));
}

export function renderPasswordReset(
  props: PasswordResetProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(PasswordReset, props));
}

export function renderPasswordChanged(
  props: PasswordChangedProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(PasswordChanged, props));
}

export function renderOrganizationInvitation(
  props: OrganizationInvitationProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(OrganizationInvitation, props));
}

export function renderNewOrderNotification(
  props: NewOrderNotificationProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(NewOrderNotification, props));
}

export function renderRentalConfirmed(
  props: RentalLifecycleEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(RentalConfirmed, props));
}

export function renderRentalReadyForPickup(
  props: RentalLifecycleEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(RentalReadyForPickup, props));
}

export function renderRentalPickedUp(
  props: RentalLifecycleEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(RentalPickedUp, props));
}

export function renderRentalReturned(
  props: RentalLifecycleEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(RentalReturned, props));
}

export function renderRentalCancelled(
  props: RentalLifecycleEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(RentalCancelled, props));
}

export function renderReturnLabel(
  props: ReturnLabelEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(ReturnLabelEmail, props));
}

export function renderPickupReturnReminder(
  props: PickupReturnReminderEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(PickupReturnReminderEmail, props));
}

export function renderRentalContractEmail(
  props: RentalContractEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(RentalContractEmail, props));
}

/** Wiadomość z formularza kontaktowego sklepu (E4, ADR-095). */
export function renderContactMessage(
  props: ContactMessageEmailProps,
): Promise<RenderedEmail> {
  return renderVariants(createElement(ContactMessageEmail, props));
}
