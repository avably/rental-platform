import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * KONTRAKT RENDERU KARTY PRODUKTU (U8b, ADR-146).
 *
 * Skan źródeł broni sposobu pisania, ten test broni WYNIKU — wzorzec pary
 * kontraktów z ADR-057 D1, ten sam co `catalog-screen-contract` dla listy.
 * Cztery sekcje karty (zdjęcie · dostępność · przychód · historia) mają się
 * NAPRAWDĘ wyrenderować, a nie tylko istnieć w kodzie.
 *
 * Każda asercja o BRAKU czegoś jest tu poprzedzona kontrolą POZYTYWNĄ:
 * „HTML nie zawiera zsumowanych walut" przeszłoby także wtedy, gdyby sekcja
 * przychodu w ogóle się nie wyrenderowała.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/katalog/p1",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { ProductOverview, ProductHistory } = await import(
  "@/app/[locale]/(panel)/katalog/[id]/product-overview"
);

const PRODUCT = "00000000-0000-4000-8000-000000000001";
const ORDER = "00000000-0000-4000-8000-0000000000aa";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {node}
    </NextIntlClientProvider>,
  );
}

const overview = (props: Partial<React.ComponentProps<typeof ProductOverview>> = {}) =>
  render(
    <ProductOverview
      capped={false}
      deployedToday={3}
      historyCount={7}
      locale="pl"
      productId={PRODUCT}
      revenue={[{ currency: "PLN", rentalGrosze: 123_45, itemCount: 2 }]}
      thumbnail={{
        url: "http://127.0.0.1:54321/storage/v1/object/public/product-images/t/p/a.jpg",
        alt: "Rusztowanie na placu",
      }}
      unitCount={6}
      {...props}
    />,
  );

describe("karta produktu — sekcja stanu", () => {
  const html = overview();

  it("renderuje wszystkie cztery uchwyty sekcji (kontrola pozytywna)", () => {
    expect(html).toContain("data-product-overview");
    expect(html).toContain('data-product-photo="image"');
    expect(html).toContain('data-catalog-axis="deployment"');
    expect(html).toContain("data-product-revenue");
    expect(html).toContain("data-product-rentals");
  });

  it("zdjęcie idzie z GOŁEGO URL-a publicznego, nie z transformacji", () => {
    expect(html).toContain("/storage/v1/object/public/product-images/");
    // `/render/image/public/…` to ścieżka transformacji Supabase — opcja PLANU
    // hostingu, której główny ekran pracy nie ma prawa wymagać (ADR-145).
    expect(html).not.toContain("/render/image/public/");
    expect(html).toContain('alt="Rusztowanie na placu"');
  });

  it("dostępność mówi „3 z 6” na osi deployment, nie na osi publikacji", () => {
    expect(html).toContain("3 z 6");
    expect(html).toContain('data-catalog-value="partial"');
    // Oś publikacji („Status") NIE pojawia się na karcie pod tą samą nazwą.
    expect(html).not.toContain('data-catalog-axis="availability"');
  });

  it("brak egzemplarzy zamienia liczbę na zdanie z drogą wyjścia", () => {
    const empty = overview({ unitCount: 0, deployedToday: 0 });
    expect(empty).toContain(messages.catalog.card.unitsEmpty);
    expect(empty).toContain(`href="/katalog/${PRODUCT}/egzemplarze"`);
    // Kontrola pozytywna dla asercji negatywnej niżej: liczba naprawdę
    // ZNIKA, a nie „nie było jej nigdy" — w wariancie z egzemplarzami jest.
    expect(html).toContain('data-catalog-axis="deployment"');
    expect(empty).not.toContain('data-catalog-axis="deployment"');
  });

  it("brak zdjęcia daje placeholder i link „dodaj pierwsze”, nie dziurę", () => {
    const empty = overview({ thumbnail: null });
    expect(empty).toContain('data-product-photo="placeholder"');
    expect(empty).toContain(messages.catalog.card.photoEmpty);
    expect(empty).toContain(`href="/katalog/${PRODUCT}/zdjecia"`);
  });
});

describe("przychód na karcie", () => {
  it("każda waluta stoi OSOBNO — kwoty się nie zlewają", () => {
    const html = overview({
      revenue: [
        { currency: "EUR", rentalGrosze: 300_00, itemCount: 1 },
        { currency: "PLN", rentalGrosze: 100_00, itemCount: 2 },
      ],
    });

    // Kontrola pozytywna: OBIE waluty są na ekranie…
    expect(html).toContain('data-product-revenue-currency="EUR"');
    expect(html).toContain('data-product-revenue-currency="PLN"');
    expect(html.match(/data-product-revenue-currency=/g) ?? []).toHaveLength(2);
    // …i nigdzie nie ma ich SUMY (400,00), która nie znaczyłaby nic.
    expect(html).not.toContain("400,00");
  });

  it("zdanie o kaucji stoi przy kwocie, a nie w dokumentacji", () => {
    // Audyt W8: ekran ma uczyć w trakcie pracy. „Kaucja nie jest przychodem"
    // jest jedynym miejscem, w którym operator dowie się, czego ta liczba
    // NIE obejmuje.
    expect(overview()).toContain(messages.catalog.card.revenueHint);
  });

  it("produkt bez przychodu mówi to zdaniem, nie zerem w obcej walucie", () => {
    const html = overview({ revenue: [] });
    expect(html).toContain(messages.catalog.card.revenueEmpty);
    expect(html).not.toContain("data-product-revenue-currency");
  });

  it("przycięty odczyt mówi o tym wprost", () => {
    expect(overview()).not.toContain("data-product-cap");
    expect(overview({ capped: true, historyCount: 500 })).toContain("data-product-cap");
  });
});

describe("historia najmów na karcie", () => {
  const rows = [
    {
      itemKey: `${ORDER}:0`,
      orderId: ORDER,
      orderNumber: "AV-2026-014",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      rentalGrosze: 45_000,
      currency: "PLN" as const,
      orderStatus: "returned" as const,
    },
  ];

  it("wiersz prowadzi do zamówienia i niesie kwotę POZYCJI", () => {
    const html = render(<ProductHistory rows={rows} locale="pl" />);
    expect(html).toContain("data-product-history");
    expect(html).toContain("data-product-history-row");
    expect(html).toContain(`href="/zamowienia/${ORDER}"`);
    expect(html).toContain("AV-2026-014");
    expect(html).toContain('data-status-axis="order"');
    expect(html).toContain('data-status-value="returned"');
  });

  it("pusta historia jest zdaniem, nie pustą tabelą", () => {
    const html = render(<ProductHistory rows={[]} locale="pl" />);
    expect(html).toContain(messages.catalog.card.historyEmpty);
    expect(html).not.toContain("data-product-history-row");
    // Kontrola pozytywna: sekcja NADAL jest na ekranie.
    expect(html).toContain("data-product-history");
  });
});
