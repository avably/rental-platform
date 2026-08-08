// @vitest-environment jsdom
/**
 * Instrukcja „Podłącz WordPressa" na ekranie /ustawienia-api (M2, ADR-110).
 *
 * Bramka istnienia i treści: instrukcja jest jedyną drogą, którą operator
 * dowiaduje się, CO zrobić z wygenerowanym kluczem — jej zniknięcie albo
 * rozjazd shortcode'u z tym, co rejestruje wtyczka, jest regresją produktu.
 */
import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import { WordPressGuide } from "@/app/[locale]/(panel)/ustawienia-api/wordpress-guide";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

afterEach(cleanup);

function renderGuide(locale: "pl" | "en", hasActiveKey = false) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "pl" ? pl : en}>
      <WordPressGuide
        hasActiveKey={hasActiveKey}
        pluginDownloadHref={`/${locale}/ustawienia-api/wtyczka`}
        pluginFilename="avably-booking-0.1.0.zip"
        pluginVersion="0.1.0"
      />
    </NextIntlClientProvider>,
  );
}

describe("instrukcja podłączenia WordPressa (/ustawienia-api)", () => {
  it("pokazuje trzy kroki i shortcode w obu językach", () => {
    for (const locale of ["pl", "en"] as const) {
      const { container } = renderGuide(locale);
      const guide = container.querySelector("[data-wordpress-guide]");
      expect(guide, `brak sekcji dla ${locale}`).not.toBeNull();

      // Kroki są numerowane 1-2-3 (kontrakt układu instrukcji).
      const steps = guide!.querySelectorAll("li");
      expect(steps.length, `liczba kroków dla ${locale}`).toBe(3);
      expect(Array.from(steps).map((li) => li.textContent?.trim()[0])).toEqual(["1", "2", "3"]);

      cleanup();
    }
  });

  it("shortcode jest DOKŁADNIE tym, który rejestruje wtyczka", () => {
    const { container } = renderGuide("pl");
    const shortcode = container.querySelector("[data-wordpress-shortcode]");
    // Rozjazd z `add_shortcode( 'avably_booking' )` po stronie wtyczki
    // zostawiłby operatora z instrukcją, która nic nie wstawia.
    expect(shortcode?.textContent).toBe("[avably_booking]");
  });

  it("ma sekcję „co zrobić, gdy nie działa” z trzema przypadkami", () => {
    for (const locale of ["pl", "en"] as const) {
      const { container } = renderGuide(locale);
      const cases = container.querySelectorAll("dt");
      expect(cases.length, `przypadki awarii dla ${locale}`).toBe(3);
      cleanup();
    }
  });

  it("krok 1 mówi co innego, gdy klucz już istnieje", () => {
    const withoutKey = renderGuide("pl", false).container.textContent ?? "";
    cleanup();
    const withKey = renderGuide("pl", true).container.textContent ?? "";
    expect(withKey).not.toBe(withoutKey);
    expect(withKey).toContain(pl.apiSettings.wordpress.step1DoneBody);
    expect(withoutKey).toContain(pl.apiSettings.wordpress.step1Body);
  });

  it("krok 2 daje pobranie paczki jednym kliknięciem", () => {
    for (const locale of ["pl", "en"] as const) {
      const { container } = renderGuide(locale);
      const link = container.querySelector("a[data-plugin-download]");
      expect(link, `brak przycisku pobierania dla ${locale}`).not.toBeNull();
      // Adres musi nieść prefiks locale — zwykły <a> nie przechodzi przez
      // Link next-intl, więc brak prefiksu dałby 404 na trasie panelu.
      expect(link?.getAttribute("href")).toBe(`/${locale}/ustawienia-api/wtyczka`);
      // Nazwa pliku z wersją: operator ma widzieć, co pobiera, także po
      // zapisaniu na dysk.
      expect(link?.getAttribute("download")).toBe("avably-booking-0.1.0.zip");
      expect(link?.textContent).toContain("0.1.0");
      cleanup();
    }
  });

  it("krok 2 mówi wprost, że po wgraniu trzeba wtyczkę WŁĄCZYĆ", () => {
    for (const [locale, needle] of [
      ["pl", "Włącz wtyczkę"],
      ["en", "Activate Plugin"],
    ] as const) {
      const text = renderGuide(locale).container.textContent ?? "";
      expect(text, `${locale} nie mówi o włączeniu`).toContain(needle);
      cleanup();
    }
  });

  it("nie obiecuje płatności online (iteracja 1 to tor offline)", () => {
    for (const locale of ["pl", "en"] as const) {
      const text = (renderGuide(locale).container.textContent ?? "").toLowerCase();
      for (const forbidden of ["płatnoś", "payment", "stripe", "karta", "card"]) {
        expect(text, `${locale} obiecuje ${forbidden}`).not.toContain(forbidden);
      }
      cleanup();
    }
  });
});
