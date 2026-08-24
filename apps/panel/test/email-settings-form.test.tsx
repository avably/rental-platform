import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * Zachowanie formularza nadawcy e-maili — bloker adresu odpowiedzi + prefill
 * z konta operatora (ADR-241, dwie uwagi właściciela do /ustawienia-emaili).
 *
 * Para do `secondary-screens-contract` (który broni chipów i obecności pól):
 * tu pilnujemy, że BRAK adresu odpowiedzi daje WIDOCZNY bloker, a pole jest
 * PODPOWIEDZIANE adresem z sesji (edytowalnym) — czyli że „maile nie giną",
 * bo domyślnie leci realny adres.
 */

// Akcja serwerowa ciągnie klienta Supabase — render jej nie potrzebuje.
vi.mock("@/app/[locale]/(panel)/ustawienia-emaili/email-settings-actions", () => ({
  saveEmailSenderAction: async () => ({}),
}));

const { EmailSenderForm } = await import(
  "@/app/[locale]/(panel)/ustawienia-emaili/email-settings-form"
);

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {node}
    </NextIntlClientProvider>,
  );
}

/** Wartość atrybutu defaultValue/value pola o danym name w wyrenderowanym HTML. */
function inputValue(html: string, name: string): string | null {
  const tag = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`));
  if (!tag) return null;
  const val = tag[0].match(/value="([^"]*)"/);
  return val ? val[1] : "";
}

describe("EmailSenderForm — bloker adresu odpowiedzi (ADR-241)", () => {
  it("BEZ zapisanego adresu: pokazuje bloker i tekst ostrzeżenia", () => {
    const html = render(<EmailSenderForm defaults={null} configured={false} />);
    expect(html).toContain("data-reply-to-blocker");
    expect(html).toContain(messages.emailSettings.replyToBlockerHeading);
    expect(html).toContain(messages.emailSettings.replyToBlockerBody);
  });

  it("Z zapisanym adresem: bloker znika", () => {
    const html = render(
      <EmailSenderForm defaults={{ name: "Demo", replyTo: "biuro@demo.pl" }} configured />,
    );
    expect(html).not.toContain("data-reply-to-blocker");
    expect(html).not.toContain(messages.emailSettings.replyToBlockerHeading);
  });
});

describe("EmailSenderForm — prefill adresu z konta operatora (ADR-241)", () => {
  it("BEZ zapisanego adresu podpowiada e-mail z konta w polu replyTo + nota", () => {
    const html = render(
      <EmailSenderForm defaults={null} configured={false} accountEmail="operator@konto.pl" />,
    );
    expect(inputValue(html, "replyTo")).toBe("operator@konto.pl");
    expect(html).toContain("data-reply-to-prefill-note");
    expect(html).toContain(messages.emailSettings.replyToPrefillNote);
  });

  it("zapisany adres MA pierwszeństwo nad prefillem z konta", () => {
    const html = render(
      <EmailSenderForm
        defaults={{ name: "Demo", replyTo: "zapisany@demo.pl" }}
        configured
        accountEmail="operator@konto.pl"
      />,
    );
    expect(inputValue(html, "replyTo")).toBe("zapisany@demo.pl");
    // Nie nadpisujemy świadomego wyboru operatora ani nie pokazujemy noty prefillu.
    expect(html).not.toContain("data-reply-to-prefill-note");
  });

  it("brak e-maila w sesji: pole puste, bez noty prefillu, bloker nadal jest", () => {
    const html = render(
      <EmailSenderForm defaults={null} configured={false} accountEmail={null} />,
    );
    expect(inputValue(html, "replyTo")).toBe("");
    expect(html).not.toContain("data-reply-to-prefill-note");
    expect(html).toContain("data-reply-to-blocker");
  });
});
