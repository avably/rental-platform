/**
 * Checkout storefrontu (Zadanie 2.4b). Serwer podaje katalog (produkty do
 * podglądu, metody dostawy z cennikiem, punkty odbioru), locale/copy tenanta i
 * site key Turnstile; formularz (klient) zbiera dane, bierze pozycje/termin z
 * koszyka i woła submitCheckout (rdzeń 2.4a).
 *
 * Site key Turnstile z NEXT_PUBLIC_TURNSTILE_SITE_KEY (stała build-time; brak =
 * widget i weryfikacja jawnie wyłączone — dev). Ten sam warunek co proxy CSP.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckoutForm } from "@/components/storefront/checkout-form";
import { categoryNavItems } from "@/lib/catalog/category-nav";
import { PageShell } from "@/components/storefront/page-shell";
import { SITE_HEADING } from "@/components/storefront/store-chrome";
import { checkoutCustomFields } from "@avably/core";

import { customFieldsFromPublicRows } from "@/lib/checkout/custom-fields";
import { readOnlinePaymentAvailability } from "@/lib/checkout/online-availability";
import { availablePaymentMethods } from "@/lib/checkout/payment-options";
import { findLegalDocument, legalVersionPath } from "@/lib/legal/published";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { pageTitle, tenantMetadata } from "@/lib/seo/tenant-metadata";
import { siteImageBaseUrl } from "@/lib/site/image-base";
import { storeLogo } from "@/lib/site/store-logo";
import { loadStorefrontContext } from "@/lib/storefront/context";
import { storeTermInput } from "@/lib/storefront/term-input";

export const dynamic = "force-dynamic";

/** Strona transakcyjna — `transactional` wymusza noindex (patrz tenantMetadata). */
export async function generateMetadata(): Promise<Metadata> {
  const ctx = await loadStorefrontContext();
  if (!ctx) return {};

  const storeName = ctx.catalog.tenant.name;
  return tenantMetadata({
    title: pageTitle(storeName, ctx.copy.checkout.title),
    description: ctx.copy.checkout.title,
    storeName,
    published: ctx.site !== null,
    transactional: true,
    origin: await tenantOrigin(),
    pathname: "/checkout",
    locale: ctx.locale,
  });
}

export default async function TenantCheckoutPage() {
  const ctx = await loadStorefrontContext();
  if (!ctx) notFound();

  const { catalog, copy, locale, currency, style, site, tenantId } = ctx;

  // Które metody pokazać — liczone TU, na serwerze, ze ŚWIEŻEGO odczytu stanu
  // konta najemcy u dostawcy (ADR-049). Strona jest `force-dynamic`, więc
  // odczyt jest jednorazowy na wejście w checkout, a nie cache'owany między
  // klientami: konto zablokowane godzinę temu ma zniknąć z listy dzisiaj,
  // a nie po następnym wdrożeniu.
  const paymentMethods = availablePaymentMethods(await readOnlinePaymentAvailability(tenantId));

  // Zawężenie do pól WYPEŁNIALNYCH liczymy TU, na serwerze — tą samą funkcją,
  // którą stosuje zapis w rdzeniu checkoutu. Gdyby filtr żył w komponencie,
  // pole spoza zamawiania byłoby niewidoczne, ale wciąż zapisywalne żądaniem
  // z pominięciem formularza.
  const customFields = checkoutCustomFields(customFieldsFromPublicRows(catalog.custom_fields));

  // Regulamin i jego etykieta wersji — z SERWERA (B4/R18). Od ADR-191
  // (H-COMP-01) sprzedaż wymaga KOMPLETU opublikowanych dokumentów: regulaminu
  // ORAZ polityki prywatności (checkbox dotyczy regulaminu, ale nota o
  // przetwarzaniu danych nie jest opcjonalna przy formularzu, który te dane
  // zbiera). Brak któregokolwiek → `terms` zostaje `undefined` i formularz
  // renderuje blokadę zamiast checkboxa; tę samą odmowę trzymają server
  // action (rdzeń checkoutu) i baza (0086), więc ominięcie strony nic nie da.
  const publishedTerms = findLegalDocument(ctx.legalDocuments, "terms");
  const publishedPrivacy = findLegalDocument(ctx.legalDocuments, "privacy");
  const legalGateOpen = publishedTerms !== null && publishedPrivacy !== null;

  return (
    <PageShell
      style={style}
      copy={copy}
      storeName={catalog.tenant.name}
      site={site}
      logo={storeLogo(ctx)}
      siteImageBase={siteImageBaseUrl(ctx.supabaseUrl)}
      /*
        Ta trasa SPRZEDAJE — pasek terminu na niej stoi (faza 5, ADR-179),
        chyba że najemca wyłączył pigułkę (ADR-203): regułę trzyma
        `storeTermInput`, wspólny dla wszystkich tras handlowych.
        */
      term={storeTermInput(ctx.storeFlags, catalog.products, locale)}
      /*
        MENU KATEGORII TAKŻE W KASIE (S-30). Dotychczasowy brak nie był
        decyzją o redukcji dystrakcji, tylko historią przepływu danych (trasa
        nie miała pozycji pod ręką) — a nagłówek i tak niesie logo i koszyk,
        więc menu nie otwiera tu żadnej nowej drogi ucieczki.
      */
      categoryNav={categoryNavItems(catalog)}
      /* KASA = TRYB KASOWY (F7 pkt 4): bez listwy, search jako ikona. */
      headerMode="checkout"
      currentPath="/checkout"
    >
      <h1 className={`text-2xl tracking-tight ${SITE_HEADING}`}>{copy.checkout.title}</h1>
      <div className="mt-6">
        <CheckoutForm
          products={catalog.products}
          deliveryMethods={catalog.delivery_methods}
          pickupLocations={catalog.pickup_locations}
          currency={currency}
          locale={locale}
          copy={copy}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          paymentMethods={paymentMethods}
          customFields={customFields}
          terms={
            legalGateOpen && publishedTerms
              ? {
                  /*
                    PERMALINK KONKRETNEJ WERSJI, nie żywy /regulamin (ADR-191):
                    klient klika dokładnie ten tekst, na który za chwilę
                    przystanie — także wtedy, gdy najemca jutro opublikuje
                    nową wersję i żywy adres zacznie pokazywać inną treść.
                  */
                  href: legalVersionPath("terms", publishedTerms.version_no),
                  versionLabel: publishedTerms.version_label,
                }
              : undefined
          }
        />
      </div>
    </PageShell>
  );
}
