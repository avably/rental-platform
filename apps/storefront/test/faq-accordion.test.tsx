import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FaqAccordion, toggleFaqItem } from "@/components/faq-accordion";

const items = [
  { question: "Question one", answer: "Answer one" },
  { question: "Question two", answer: "Answer two" },
] as const;

describe("FAQ accordion", () => {
  it("links every button to its panel", () => {
    const html = renderToStaticMarkup(<FaqAccordion items={items} />);

    expect(html).toContain('aria-controls="faq-panel-0"');
    expect(html).toContain('id="faq-panel-0"');
    expect(html).toContain('aria-labelledby="faq-trigger-0"');
  });

  it("opens one item and closes the same item", () => {
    expect(toggleFaqItem(null, 1)).toBe(1);
    expect(toggleFaqItem(1, 1)).toBeNull();
    expect(toggleFaqItem(1, 0)).toBe(0);
  });

  it("renders an optional locale-aware policy link", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pl" messages={{}}>
        <FaqAccordion items={[{ question: "Dane", answer: "Opis", linkLabel: "Polityka" }]} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain('href="/pl/privacy"');
    expect(html).toContain("Polityka");
  });
});
