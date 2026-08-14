"use client";

/**
 * Koszyk multi-produkt (2.4b). Stan z localStorage (useCart); pozycje łączą się
 * z katalogiem przekazanym z serwera po product_id. Jedna linia per produkt
 * (agregacja w modelu — patrz lib/cart/model.ts). Termin jest WSPÓLNY dla całego
 * zamówienia i od ADR-179 edytuje się go w PASKU TERMINU powłoki, a nie na
 * podstronie sprzętu — bo wspólny termin ustawiany w miejscu poświęconym
 * jednej pozycji był interfejsem mówiącym co innego, niż robi.
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
 * `site-field`, `site-cta`, `site-text-muted`), a nie kolory. Pola i przyciski
 * są ZWYKŁYMI elementami HTML, nie komponentami `@avably/ui`: tamte wnoszą
 * własne tokeny panelu (`bg-primary`, `border-input`) w warstwie utilities,
 * więc „brak tokenu panelu w tym pliku" byłby gwarancją pozorną — token
 * wjeżdżałby tu przez komponent, którego skan źródeł nie widzi.
 */
import { calculatePrice, formatMoney, type CurrencyCode } from "@avably/core";
import Link from "next/link";

import { useStoreTerm } from "@/components/storefront/store-term";
import { isCheckoutReady, MAX_QUANTITY_PER_PRODUCT } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { storagePublicUrl, toPriceParams } from "@/lib/catalog/present";
import { previewTotals } from "@/lib/catalog/preview";
import type { PublicCatalogProduct } from "@/lib/checkout/contract";
import type { StorefrontCopy } from "@/lib/storefront/copy";

export function CartView({
  products,
  supabaseUrl,
  currency,
  locale,
  copy,
}: {
  products: PublicCatalogProduct[];
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

  if (lines.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="site-text-muted">{copy.cart.empty}</p>
        <Link href="/store" className="site-link font-medium">
          {copy.cart.emptyCta}
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

  return (
    <div className="grid gap-8">
      {/* Termin (wspólny) */}
      <div className="site-card p-4">
        <p className="text-sm font-medium">{copy.cart.rentalPeriod}</p>
        <p className="site-text-muted mt-1 text-sm">
          {datesValid ? `${cart.startDate} → ${cart.endDate}` : copy.cart.noDates}
        </p>
        <p className="site-text-muted mt-1 text-xs">{copy.cart.editInProduct}</p>
      </div>

      {/* Pozycje */}
      <ul className="grid list-none gap-4 p-0">
        {lines.map(({ line, product }) => {
          const image = product.images[0];
          const linePreview = datesValid
            ? calculatePrice(cart.startDate!, cart.endDate!, toPriceParams(product))
            : null;
          return (
            <li
              key={product.id}
              className="site-card flex flex-wrap items-center gap-4 p-4"
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
              <div className="min-w-40 flex-1">
                <Link href={`/product/${product.id}`} className="site-link font-medium">
                  {product.name}
                </Link>
                {linePreview ? (
                  <p className="site-text-muted text-sm">
                    {copy.cart.lineRental}: {formatMoney(linePreview.rentalGrosze * line.quantity, currency, locale)}{" "}
                    · {copy.cart.lineDeposit}:{" "}
                    {formatMoney(linePreview.depositGrosze * line.quantity, currency, locale)}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1">
                <label htmlFor={`qty-${product.id}`} className="sr-only">
                  {copy.cart.quantity}
                </label>
                <input
                  id={`qty-${product.id}`}
                  type="number"
                  min={1}
                  max={MAX_QUANTITY_PER_PRODUCT}
                  value={line.quantity}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    if (Number.isNaN(parsed)) return;
                    setQty(product.id, parsed);
                  }}
                  className="site-field h-9 w-20 px-3 text-sm"
                />
              </div>
              <button
                type="button"
                className="site-cta-secondary cursor-pointer text-sm font-semibold"
                onClick={() => remove(product.id)}
              >
                {copy.cart.remove}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Podsumowanie (podgląd) */}
      <div className="site-card grid gap-2 p-4">
        <div className="flex justify-between text-sm">
          <span>{copy.cart.subtotalRental}</span>
          <span>{formatMoney(totals.rentalGrosze, currency, locale)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>{copy.cart.subtotalDeposit}</span>
          <span>{formatMoney(totals.depositGrosze, currency, locale)}</span>
        </div>
        <p className="site-text-muted mt-1 text-xs">{copy.common.estimateNote}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {ready ? (
          <Link
            href="/checkout"
            className="site-cta inline-flex items-center justify-center text-sm font-semibold"
          >
            {copy.cart.goToCheckout}
          </Link>
        ) : (
          <p className="site-error text-sm" data-cart-checkout-blocked>
            {term.blocked ? copy.cart.checkoutBlockedConflict : copy.cart.checkoutBlocked}
          </p>
        )}
        <Link href="/store" className="site-link text-sm">
          {copy.common.continueShopping}
        </Link>
      </div>
    </div>
  );
}
