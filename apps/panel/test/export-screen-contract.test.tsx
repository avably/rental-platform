/**
 * Kontrakt renderu ekranu „Eksport danych" (C2, ADR-111) — renderToStaticMarkup
 * na fixture, bez Supabase. Bronione WYNIKI:
 *  1. Każdy formularz eksportu to POST — parametry NIE wchodzą do URL
 *     (zasada „zero danych osobowych w URL").
 *  2. Karta klientów: formularz TYLKO dla ownera; staff widzi komunikat
 *     zamiast przycisku (UI jest lustrem bramki serwera, nie bramką).
 *  3. Kody błędów z redirectu tłumaczą się na komunikat (limit/zakres).
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExportView } from "@/app/[locale]/(panel)/eksport-danych/export-view";

import messages from "../messages/pl.json";

function renderView(props: Partial<Parameters<typeof ExportView>[0]> = {}): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <ExportView locale="pl" isOwner error={null} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ekran eksportu danych — kontrakt renderu", () => {
  it("owner: trzy karty, trzy formularze POST na trasy eksportu, daty w ciele formularza", () => {
    const html = renderView();
    for (const slug of ["zamowienia", "klienci", "katalog"]) {
      expect(html).toContain(`action="/pl/eksport-danych/${slug}"`);
    }
    // KAŻDY formularz jest POST (bez wyjątku) i ŻADEN nie celuje w URL z query.
    const forms = html.match(/<form[^>]*>/g) ?? [];
    expect(forms).toHaveLength(3);
    for (const form of forms) {
      expect(form).toContain('method="post"');
      expect(form).not.toContain("?");
    }
    expect(html).toContain('name="date_from"');
    expect(html).toContain('name="date_to"');
    expect(html).not.toContain("data-export-error");
  });

  it("staff: karta klientów bez formularza, z komunikatem „tylko właściciel”", () => {
    const html = renderView({ isOwner: false });
    expect(html).not.toContain('action="/pl/eksport-danych/klienci"');
    expect(html).toContain('data-export-owner-only="true"');
    // Pozostałe dwa eksporty zostają.
    expect(html).toContain('action="/pl/eksport-danych/zamowienia"');
    expect(html).toContain('action="/pl/eksport-danych/katalog"');
  });

  it.each([
    ["limit", "limit 10"],
    ["zakres", "zakres dat"],
  ] as const)("kod błędu %s renderuje przetłumaczony komunikat", (code, fragment) => {
    const html = renderView({ error: code });
    expect(html).toContain(`data-export-error="${code}"`);
    expect(html.toLowerCase()).toContain(fragment);
  });

  it("locale idzie do akcji formularza — wersja EN celuje w /en/…", () => {
    const html = renderView({ locale: "en" });
    expect(html).toContain('action="/en/eksport-danych/zamowienia"');
  });
});
