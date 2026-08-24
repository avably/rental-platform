// @vitest-environment jsdom

import { NextIntlClientProvider } from "next-intl";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

const openBillingPortalAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/billing-management", () => ({
  openBillingPortalAction,
}));

const { BillingPortalButton } = await import(
  "@/components/billing/billing-portal-button"
);

describe("BillingPortalButton", () => {
  beforeEach(() => {
    openBillingPortalAction.mockReset();
  });

  it("podczas oczekiwania pokazuje jeden kompaktowy status i blokuje CTA", async () => {
    openBillingPortalAction.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();

    render(
      <NextIntlClientProvider
        locale="pl"
        messages={messages}
        timeZone="Europe/Warsaw"
      >
        <BillingPortalButton />
      </NextIntlClientProvider>,
    );

    const button = screen.getByRole("button", {
      name: messages.organization.billing.manage.portalCta,
    });
    await user.click(button);

    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    const status = screen.getByRole("status");
    expect(status.hasAttribute("data-brand-loader")).toBe(true);
    expect(status.getAttribute("data-brand-loader-variant")).toBe("compact");
    expect(status.textContent).toContain(
      messages.organization.billing.manage.portalRedirecting,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
