import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PrivacyDocument } from "@/app/[locale]/privacy/page";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

function renderPrivacy(locale: "en" | "pl", messages: typeof en) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PrivacyDocument copy={messages.privacy} />
    </NextIntlClientProvider>,
  );
}

describe("privacy page", () => {
  for (const [locale, messages] of [["en", en], ["pl", pl]] as const) {
    it(`renders the complete ${locale} policy`, () => {
      const html = renderPrivacy(locale, messages);
      expect(html).toContain(messages.privacy.title);
      expect(messages.privacy.sections).toHaveLength(10);
      for (const section of messages.privacy.sections) {
        expect(html).toContain(section.heading);
      }
    });
  }

  it("states accurately that IP is not saved with a submission", () => {
    expect(JSON.stringify(pl.privacy)).toContain("Twojego adresu IP nie zapisujemy w zgłoszeniu.");
    expect(JSON.stringify(en.privacy)).toContain("We do not save your IP address with your submission.");
  });

  it("renders the complete IP-handling invariant in both locales", () => {
    const cases = [
      {
        locale: "pl" as const,
        messages: pl,
        statements: [
          "Twojego adresu IP nie zapisujemy w zgłoszeniu.",
          "Używamy go wyłącznie przejściowo, żeby ograniczyć liczbę zgłoszeń z jednego adresu i chronić formularz przed nadużyciami.",
          "Klucz wygasa automatycznie.",
        ],
      },
      {
        locale: "en" as const,
        messages: en,
        statements: [
          "We do not save your IP address with your submission.",
          "We use it only temporarily to limit the number of submissions from one address and protect the form against abuse.",
          "The key expires automatically.",
        ],
      },
    ];

    for (const { locale, messages, statements } of cases) {
      const html = renderPrivacy(locale, messages);
      for (const statement of statements) {
        expect(html).toContain(statement);
      }
    }
  });

  it("keeps the same section shape in both locales", () => {
    expect(en.privacy.sections).toHaveLength(pl.privacy.sections.length);
    expect(en.privacy.sections.map((section) => Object.keys(section).sort())).toEqual(
      pl.privacy.sections.map((section) => Object.keys(section).sort()),
    );
  });

  it("keeps the effective-date placeholder until the publication PR", () => {
    // In the publication PR, invert this guard: require an ISO date and reject the placeholder,
    // together with WAITLIST_ENABLED=true.
    expect(en.privacy.updatedValue).toBe("[[EFFECTIVE_DATE]]");
    expect(pl.privacy.updatedValue).toBe("[[EFFECTIVE_DATE]]");
  });

  it("pins the legal entity name and tax identifier in both locales", () => {
    for (const messages of [en, pl]) {
      const policy = JSON.stringify(messages.privacy);
      expect(policy).toContain("Zakład Graficzny Maciej Godek");
      expect(policy).toContain("7831780263");
    }
    expect(JSON.stringify(pl.privacy)).toContain("NIP: 7831780263");
    expect(JSON.stringify(en.privacy)).toContain("VAT ID (NIP): 7831780263");
  });
});
