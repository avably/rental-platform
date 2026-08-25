"use client";

/**
 * Koszyk multi-produkt (2.4b; przebudowa prezentacji F8, spec 2026-08-25).
 * Stan z localStorage (useCart); pozycje łączą się z katalogiem przekazanym
 * z serwera po product_id. Jedna linia per produkt (agregacja w modelu — patrz
 * lib/cart/model.ts). Termin jest WSPÓLNY dla całego zamówienia i od ADR-179
 * edytuje się go w PASKU TERMINU powłoki, a nie na podstronie sprzętu.
 *
 * ==================== UKŁAD (F8) ====================
 *
 * Desktop: dwie kolumny `minmax(0,1fr) + 22rem` — pozycje po lewej, karta
 * podsumowania PRZYKLEJONA po prawej (`top-24`), z odnośnikiem do kasy na
 * pełnej szerokości karty (ta sama geometria, co checkout — SummaryList).
 * Mobile: u góry zwijany pasek „Podsumowanie · kwota" (<details>), pełne
 * podsumowanie z odnośnikiem do kasy POD pozycjami. Tory siatek wyłącznie
 * `minmax(0,1fr)` — patrz naprawa S-15 w checkout-form.tsx.
 *
 * POZYCJA = miniatura 64 px + nazwa (link) + meta najem/kaucja + STEPPER
 * ilości `− n +` (cele 44 px, min 1, max = wolne sztuki z odpowiedzi
 * dostępności ADR-180, gdy jest znana) + „Usuń" z etykietą. Pole liczbowe
 * zniknęło: dwa dotknięcia zamiast klawiatury numerycznej, a zero przestało
 * być osiągalne przypadkiem — usunięcie pozycji jest wyłącznie jawne.
 *
 * PUSTY KOSZYK prowadzi do katalogu duzym `.site-cta` (S-28) — do F8 jedyną
 * wyraźną drogą ucieczki był regulamin w stopce.
 *
 * DATY PO LUDZKU (F8/S-10): termin przez `formatRentalRange` — ta sama fraza,
 * co pasek terminu i checkout.
 *
 * ODNOŚNIK DO KASY ZNIKA PRZY KONFLIKCIE (R4, ADR-179). Werdykt bierzemy
 * z powłoki (`useStoreTerm`), a nie liczymy tu drugi raz: dwa niezależne
 * odczyty dostępności mogłyby dać dwie odpowiedzi, a wtedy kasa bywałaby
 * otwarta w chwili, w której pasek terminu pokazuje konflikt.
 *
 * Kwoty tu to PODGLĄD (calculatePrice) — informacyjny szacunek. Wiążącą kwotę
 * policzy serwer przy składaniu zamówienia (ADR-042).
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092): koszyk nosi role (`site-card`,
 * `site-cta`, `site-text-muted`), a nie kolory. Przyciski są ZWYKŁYMI
 * elementami HTML, nie komponentami `@avably/ui`: tamte wnoszą własne tokeny
 * panelu (`bg-primary`, `border-input`) w warstwie utilities, więc „brak
 * tokenu panelu w tym pliku" byłby gwarancją pozorną.
 */
import { calculatePrice, formatMoney, formatRentalRange, type CurrencyCode } from "@avably/core";
import Link from "next/link";
import type { ReactNode } from "react";

import { useStoreTerm } from "@/components/storefront/store-term";
import { SummaryList, type SummaryRow } from "@/components/storefront/summary-list";
import { SITE_HEADING } from "@/components/storefront/store-chrome";
import { isCheckoutReady, MAX_QUANTITY_PER_PRODUCT } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { storagePublicUrl, toPriceParams } from "@/lib/catalog/present";
import { previewTotals } from "@/lib/catalog/preview";
import type { PublicCatalogProduct } from "@/lib/checkout/contract";
import type { StorefrontCopy } from "@/lib/storefront/copy";

/** Przycisk steppera ilości: cel dotykowy 44×44 (spec F8), obrys z pasa. */
const STEPPER_BUTTON =
  "site-cta-secondary grid h-11 w-11 cursor-pointer place-items-center p-0 text-lg leading-none " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/** Zwijany pasek podsumowania (mobile) — ten sam wzorzec, co w checkoucie. */
function SummaryBar({
  heading,
  totalText,
  children,
}: {
  heading: string;
  totalText: string;
  children: ReactNode;
}) {
  return (
    <details className="site-card group lg:hidden" data-cart-summary-bar>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{heading}</span>
        <span className="inline-flex items-center gap-2">
          <span className="site-numeric font-semibold whitespace-nowrap">{totalText}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4 transition-transform group-open:rotate-180"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

export function CartView({
  products,
  productPaths,
  supabaseUrl,
  currency,
  locale,
  copy,
}: {
  products: PublicCatalogProduct[];
  /**
   * ADRESY STRON SPRZĘTU, `id → ścieżka` (ADR-182). Policzone na serwerze:
   * adres liczy się ze SLUGA pozycji, a ten przychodzi rejestrem, którego
   * komponent kliencki nie czyta — i nie ma go czytać, bo wtedy reguła
   * degradacji („bez rejestru linkuj adresem zastanym") stałaby w dwóch
   * miejscach.
   */
  productPaths: Record<string, string>;
  supabaseUrl: string;
  currency: CurrencyCode;
  locale: string;
  copy: StorefrontCopy;
}) {
  const { cart, hydrated, setQty, remove } = useCart();
  // Werdykt konfliktu z POWŁOKI, nie liczony tu jeszcze raz (ADR-179): dwa
  // niezależne odczyty dostępności mogłyby dać dwie odpowiedzi, a wtedy kasa
  // bywałaby odblokowana w chwili, w której pasek terminu pokazuje konflikt.
  const term = useStoreTerm();
  const byId = new Map(products.map((product) => [product.id, product]));

  // Do hydratacji nie znamy koszyka (localStorage) — nie renderujemy treści,
  // żeby serwer i klient się nie rozjechały.
  if (!hydrated) {
    return <div className="min-h-40" aria-hidden="true" />;
  }

  const lines = cart.items
    .map((line) => ({ line, product: byId.get(line.productId) }))
    .filter((entry): entry is { line: typeof entry.line; product: PublicCatalogProduct } =>
      Boolean(entry.product),
    );

  // --- Pusty koszyk: wzrok idzie do katalogu, nie do stopki (S-28) ---------
  if (lines.length === 0) {
    return (
      <div
        className="site-card grid grid-cols-1 justify-items-center gap-5 px-6 py-12 text-center"
        data-cart-empty
      >
        <p className="site-text-muted">{copy.cart.empty}</p>
        <Link
          href="/store"
          className="site-cta inline-flex min-h-11 items-center justify-center px-8 text-base font-semibold"
        >
          {copy.cart.emptyCta}
        </Link>
        <Link href="/" className="site-link text-sm">
          {copy.cart.emptySecondaryCta}
        </Link>
      </div>
    );
  }

  const datesValid = cart.startDate !== null && cart.endDate !== null && cart.endDate >= cart.startDate;
  const totals = previewTotals({
    items: cart.items,
    products,
    startDate: cart.startDate ?? "",
    endDate: cart.endDate ?? "",
    deliveryMethod: null,
    deliveryMethods: [],
  });
  // KONFLIKT ZDEJMUJE ODNOŚNIK DO KASY, a nie tylko go przygasza (R4,
  // ADR-179): przycisk „wyłączony" wizualnie wciąż jest linkiem i klawiatura
  // przeprowadzi po nim klienta wprost na formularz, który i tak padnie.
  const ready = isCheckoutReady(cart) && !term.blocked;

  const summaryRows: SummaryRow[] = [
    {
      label: copy.cart.subtotalRental,
      value: formatMoney(totals.rentalGrosze, currency, locale),
    },
    {
      label: copy.cart.subtotalDeposit,
      value: formatMoney(totals.depositGrosze, currency, locale),
    },
  ];
  const summaryTotal: SummaryRow = {
    label: copy.cart.total,
    value: formatMoney(totals.totalGrosze, currency, locale),
  };

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="grid grid-cols-1 gap-4">
        {/* Zwijany pasek podsumowania — mobile, U GÓRY strony (spec F8). */}
        <SummaryBar
          heading={copy.cart.summaryHeading}
          totalText={formatMoney(totals.totalGrosze, currency, locale)}
        >
          <SummaryList rows={summaryRows} total={summaryTotal} />
        </SummaryBar>

        {/* Termin (wspólny) — data po ludzku (F8/S-10). */}
        <div className="site-card p-4">
          <p className="text-sm font-medium">{copy.cart.rentalPeriod}</p>
          <p className="mt-1 text-sm" data-cart-term>
            {datesValid ? (
              formatRentalRange(cart.startDate!, cart.endDate!, locale)
            ) : (
              <span className="site-text-muted">{copy.cart.noDates}</span>
            )}
          </p>
          <p className="site-text-muted mt-1 text-xs">{copy.cart.editInProduct}</p>
        </div>

        {/* Pozycje */}
        <ul className="grid list-none grid-cols-1 gap-4 p-0">
          {lines.map(({ line, product }) => {
            const image = product.images[0];
            const linePreview = datesValid
              ? calculatePrice(cart.startDate!, cart.endDate!, toPriceParams(product))
              : null;
            /**
             * SUFIT STEPPERA = wolne sztuki w wybranym terminie (ADR-180),
             * gdy odpowiedź dostępności jest znana; inaczej limit modelu.
             * Brak pozycji w mapie to „nie wiem", nie zero — wtedy też limit
             * modelu (kafel może milczeć, ale dodanie sztuki zweryfikuje
             * serwer przy zapisie — ADR-042).
             */
            const availableUnits = term.units?.[product.id];
            const maxQuantity = Math.min(
              MAX_QUANTITY_PER_PRODUCT,
              availableUnits ?? MAX_QUANTITY_PER_PRODUCT,
            );
            return (
              <li
                key={product.id}
                className="site-card grid grid-cols-[4rem_minmax(0,1fr)] gap-x-4 gap-y-3 p-4"
                data-cart-line={product.id}
              >
                {image ? (
                  // Zdjęcia z publicznego Storage — zwykły <img> (jak sekcja
                  // products w @avably/ui); next/image nie wnosi tu wartości.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={storagePublicUrl(supabaseUrl, image.storage_path)}
                    alt={image.alt_text ?? product.name}
                    className="site-media h-16 w-16 object-cover"
                  />
                ) : (
                  <div className="site-placeholder h-16 w-16" aria-hidden="true" />
                )}
                <div className="grid grid-cols-1 gap-1">
                  <Link
                    href={productPaths[product.id] ?? `/product/${product.id}`}
                    className="site-link font-medium"
                  >
                    {product.name}
                  </Link>
                  {linePreview ? (
                    <p className="site-text-muted text-sm">
                      {copy.cart.lineRental}:{" "}
                      <span className="site-numeric">
                        {formatMoney(linePreview.rentalGrosze * line.quantity, currency, locale)}
                      </span>{" "}
                      · {copy.cart.lineDeposit}:{" "}
                      <span className="site-numeric">
                        {formatMoney(linePreview.depositGrosze * line.quantity, currency, locale)}
                      </span>
                    </p>
                  ) : null}
                </div>

                {/* Stepper + Usuń — pod treścią, wyrównane do kolumny treści. */}
                <div className="col-start-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1" data-cart-stepper={product.id}>
                    <button
                      type="button"
                      className={STEPPER_BUTTON}
                      aria-label={`${copy.cart.decrease}: ${product.name}`}
                      disabled={line.quantity <= 1}
                      data-cart-stepper-decrease
                      onClick={() => setQty(product.id, line.quantity - 1)}
                    >
                      −
                    </button>
                    <span
                      className="site-numeric min-w-9 text-center text-sm font-semibold"
                      aria-live="polite"
                      data-cart-stepper-quantity
                    >
                      {line.quantity}
                    </span>
                    <button
                      type="button"
                      className={STEPPER_BUTTON}
                      aria-label={`${copy.cart.increase}: ${product.name}`}
                      disabled={line.quantity >= maxQuantity}
                      data-cart-stepper-increase
                      onClick={() => setQty(product.id, line.quantity + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="site-link inline-flex min-h-11 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-sm"
                    data-cart-remove
                    onClick={() => remove(product.id)}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="size-4"
                    >
                      <path d="M2.5 4h11M6.5 2.5h3M5.5 4v9.5A1 1 0 0 0 6.5 14.5h3a1 1 0 0 0 1-1V4M6.5 6.5v5M9.5 6.5v5" />
                    </svg>
                    {copy.cart.remove}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Podsumowanie (podgląd) — geometria jak w checkoucie (SummaryList). */}
      <aside
        className="site-card grid h-fit grid-cols-1 gap-4 p-5 lg:sticky lg:top-24"
        data-cart-summary
      >
        <h2 className={`text-[17px] ${SITE_HEADING}`}>{copy.cart.summaryHeading}</h2>
        <SummaryList rows={summaryRows} total={summaryTotal} />
        <p className="site-text-muted text-[13px]">{copy.common.estimateNote}</p>

        {ready ? (
          <Link
            href="/checkout"
            className="site-cta inline-flex w-full items-center justify-center text-sm font-semibold"
          >
            {copy.cart.goToCheckout}
          </Link>
        ) : (
          <p className="site-error-panel p-3 text-sm" data-cart-checkout-blocked>
            {term.blocked ? copy.cart.checkoutBlockedConflict : copy.cart.checkoutBlocked}
          </p>
        )}
        <Link href="/store" className="site-link justify-self-center text-sm">
          {copy.common.continueShopping}
        </Link>
      </aside>
    </div>
  );
}
