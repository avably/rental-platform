import { createElement, type ReactElement } from "react";
import { render } from "react-email";

import {
  EmailConfirmation,
  type EmailConfirmationProps,
} from "./templates/email-confirmation";
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
