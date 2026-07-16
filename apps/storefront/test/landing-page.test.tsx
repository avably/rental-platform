import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LandingPage } from "@/components/landing-page";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

describe("waitlist landing page", () => {
  it("keeps the English success sentence continuous around the email", () => {
    expect(en.landing.form.success.bodyAfterEmail).toMatch(/^,/);
  });

  for (const [locale, messages] of [
    ["en", en],
    ["pl", pl],
  ] as const) {
    it(`renders the complete ${locale} page with one h1`, () => {
      const html = renderToStaticMarkup(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <LandingPage locale={locale} copy={messages.landing} waitlistEnabled={false} />
        </NextIntlClientProvider>,
      );

      expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
      expect(html).toContain(messages.landing.hero.title);
      expect(html).toContain(messages.landing.problem.title);
      expect(html).toContain(messages.landing.founder.title);
      expect(html).toContain(messages.landing.founders.title);
      expect(html).toContain(messages.landing.form.title);
      expect(messages.landing.faq.items).toHaveLength(5);
      expect(html).toContain(messages.landing.faq.title);
      for (const item of messages.landing.faq.items) {
        expect(html).toContain(item.question);
        expect(html).toContain(item.answer);
      }
      expect(html.match(/aria-expanded="false"/g)).toHaveLength(5);
      expect(html).toContain('data-analytics-section="faq"');
      expect(html).toContain(messages.landing.form.disabled.title);
      expect(html).toContain('<form');
      expect(html).toContain('for="waitlist-email"');
      expect(html).toContain('id="waitlist-email"');
      expect(html).toContain('name="rentalType"');
      expect(html).toContain('name="inventoryRange"');
      expect(html).toContain('name="currentProcess"');
      expect(html).toContain('aria-describedby="waitlist-email-help waitlist-email-error"');
      expect(html).toMatch(/<button[^>]*disabled/);
      expect(html).toContain("equipment-workbench.webp");
      expect(html).toContain("equipment-workshop.webp");
      expect(html).toContain(messages.landing.problem.warehouseAlt);
      expect(html).toContain(messages.landing.problem.useAlt);
    });
  }
});
