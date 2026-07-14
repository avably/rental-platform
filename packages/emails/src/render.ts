import { createElement, type ReactElement } from "react";
import { render } from "react-email";

import {
  EmailConfirmation,
  type EmailConfirmationProps,
} from "./templates/email-confirmation";

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
