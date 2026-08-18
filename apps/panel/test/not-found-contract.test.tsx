/**
 * Kontrakt wzorca 404 panelu (L-UX-01, audyt właściciela 17.08, ADR-197).
 *
 * Cztery zdania, których broni ten plik:
 *   1. 404 poziomu aplikacji renderuje DOKŁADNIE JEDEN `h1` (stoi poza
 *      shellem, więc belka ADR-060 go tu nie niesie — musi mieć własny).
 *   2. Komunikat jest w JĘZYKU TRASY: tytuł pl ≠ tytuł en, każdy równy
 *      swojemu słownikowi — podmiana tekstu na drugi język pali test.
 *   3. Ekran ma wyjście: odnośnik na pulpit (`/`) z etykietą ze słownika.
 *   4. Kontekstowe 404 podstron (`NotFoundScreen`) NIE niosą `h1` — renderują
 *      się POD belką shella, której `h1` jest jedynym na ekranie (ADR-060);
 *      ich tytuł stoi na `h2`, dokładnie jak w 404 zamówienia (ADR-057).
 *
 * Harness: createTranslator nad REALNYMI słownikami (wzorzec
 * raw-i18n-key-contract, ADR-193) — render mierzy produkcyjną rezolucję
 * tłumaczeń, nie atrapę o zgadywanym kształcie.
 */
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";
import enMessages from "../messages/en.json";

const MESSAGES = { pl: plMessages, en: enMessages } as const;
type Locale = keyof typeof MESSAGES;

const activeLocale = vi.hoisted(() => ({ current: "pl" as "pl" | "en" }));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => activeLocale.current,
  getTranslations: async (namespace?: string) =>
    createTranslator({
      locale: activeLocale.current,
      messages: MESSAGES[activeLocale.current],
      namespace: namespace as never,
      onError: () => {},
    }),
}));

// `notFound()` przerywa render rzutem, dokładnie jak w produkcji.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const LocaleNotFound = (await import("@/app/[locale]/not-found")).default;
const CatchAllPage = (await import("@/app/[locale]/[...rest]/page")).default;
const { NotFoundScreen } = await import("@/components/screens/not-found-screen");

async function renderAppNotFound(locale: Locale): Promise<string> {
  activeLocale.current = locale;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} onError={() => {}}>
      {await LocaleNotFound()}
    </NextIntlClientProvider>,
  );
}

/** Teksty nagłówków danego poziomu — z HTML, nie ze źródła. */
function headings(html: string, level: number): string[] {
  return [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "g"))].map(
    (match) => match[1].replace(/<[^>]+>/g, "").trim(),
  );
}

describe("404 poziomu aplikacji (poza shellem)", () => {
  it.each(["pl", "en"] as const)(
    "locale %s: dokładnie jeden h1 z tytułem ze słownika tej trasy",
    async (locale) => {
      const html = await renderAppNotFound(locale);

      const h1 = headings(html, 1);
      expect(h1, "404 aplikacji musi nieść dokładnie jeden h1").toHaveLength(1);
      expect(h1[0]).toBe(MESSAGES[locale].orders.notFound.title);
      // Kod stanu jest częścią wzorca — czytelnik ma wiedzieć, CO się stało.
      expect(html).toContain(MESSAGES[locale].orders.notFound.code);
    },
  );

  it("tytuły pl i en są RÓŻNE — komunikat naprawdę podąża za locale trasy", async () => {
    // Bez tej kontroli ekran z tytułem zaszytym na sztywno w jednym języku
    // przechodziłby oba przypadki wyżej połową słownika.
    expect(MESSAGES.pl.orders.notFound.title).not.toBe(MESSAGES.en.orders.notFound.title);
    expect((await renderAppNotFound("pl")).includes(MESSAGES.en.orders.notFound.title)).toBe(false);
    expect((await renderAppNotFound("en")).includes(MESSAGES.pl.orders.notFound.title)).toBe(false);
  });

  it.each(["pl", "en"] as const)("locale %s: wyjście prowadzi na pulpit", async (locale) => {
    const html = await renderAppNotFound(locale);
    const link = html.match(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    expect(link, "404 aplikacji musi nieść odnośnik powrotu").not.toBeNull();
    expect(link![1]).toBe("/");
    expect(link![2].replace(/<[^>]+>/g, "").trim()).toBe(
      MESSAGES[locale].notFound.backToDashboard,
    );
  });
});

describe("catch-all niedopasowanych adresów", () => {
  it("rzuca notFound() — niedopasowany adres kończy się ekranem 404, nie renderem", () => {
    expect(() => CatchAllPage()).toThrowError("NEXT_NOT_FOUND");
  });
});

describe("kontekstowe 404 podstron (pod belką shella)", () => {
  it("NotFoundScreen nie niesie h1 (jedyny h1 ekranu ma belka, ADR-060) — tytuł na h2", async () => {
    activeLocale.current = "pl";
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pl" messages={MESSAGES.pl} onError={() => {}}>
        {await NotFoundScreen({ back: { href: "/katalog", label: "Katalog" } })}
      </NextIntlClientProvider>,
    );

    expect(headings(html, 1), "drugi h1 pod belką shella łamie ADR-060").toHaveLength(0);
    expect(headings(html, 2)).toEqual([MESSAGES.pl.orders.notFound.title]);
  });
});
