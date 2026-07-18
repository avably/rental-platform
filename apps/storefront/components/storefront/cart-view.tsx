"use client";

/**
 * Koszyk multi-produkt (2.4b). Stan z localStorage (useCart); pozycje łączą się
 * z katalogiem przekazanym z serwera po product_id. Jedna linia per produkt
 * (agregacja w modelu — patrz lib/cart/model.ts). Termin jest WSPÓLNY dla całego
 * zamówienia (edytowany na podstronie produktu).
 *
 * Kwoty tu to PODGLĄD (calculatePrice) — informacyjny szacunek. Wiążącą kwotę
 * policzy serwer przy składaniu zamówienia (ADR-042).
 */
import { calculatePrice, formatMoney, type CurrencyCode } from "@avably/core";
import { Button, Input, Label } from "@avably/ui";
import Link from "next/link";

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
        <p className="text-muted-foreground">{copy.cart.empty}</p>
        <Link href="/store" className="font-medium underline underline-offset-4">
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
  const ready = isCheckoutReady(cart);

  return (
    <div className="grid gap-8">
      {/* Termin (wspólny) */}
      <div className="rounded-lg border border-border p-4">
        <p className="text-sm font-medium">{copy.cart.rentalPeriod}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {datesValid ? `${cart.startDate} → ${cart.endDate}` : copy.cart.noDates}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{copy.cart.editInProduct}</p>
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
              className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4"
            >
              {image ? (
                // Zdjęcia z publicznego Storage — zwykły <img> (jak sekcja
                // products w @avably/ui); next/image nie wnosi tu wartości.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={storagePublicUrl(supabaseUrl, image.storage_path)}
                  alt={image.alt_text ?? product.name}
                  className="h-16 w-16 rounded-md object-cover"
                />
              ) : (
                <div className="h-16 w-16 rounded-md bg-muted" aria-hidden="true" />
              )}
              <div className="min-w-40 flex-1">
                <Link href={`/product/${product.id}`} className="font-medium hover:underline">
                  {product.name}
                </Link>
                {linePreview ? (
                  <p className="text-sm text-muted-foreground">
                    {copy.cart.lineRental}: {formatMoney(linePreview.rentalGrosze * line.quantity, currency, locale)}{" "}
                    · {copy.cart.lineDeposit}:{" "}
                    {formatMoney(linePreview.depositGrosze * line.quantity, currency, locale)}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`qty-${product.id}`} className="sr-only">
                  {copy.cart.quantity}
                </Label>
                <Input
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
                  className="w-20"
                />
              </div>
              <Button type="button" variant="outline" onClick={() => remove(product.id)}>
                {copy.cart.remove}
              </Button>
            </li>
          );
        })}
      </ul>

      {/* Podsumowanie (podgląd) */}
      <div className="grid gap-2 rounded-lg border border-border p-4">
        <div className="flex justify-between text-sm">
          <span>{copy.cart.subtotalRental}</span>
          <span>{formatMoney(totals.rentalGrosze, currency, locale)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>{copy.cart.subtotalDeposit}</span>
          <span>{formatMoney(totals.depositGrosze, currency, locale)}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{copy.common.estimateNote}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        {ready ? (
          <Link
            href="/checkout"
            className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {copy.cart.goToCheckout}
          </Link>
        ) : (
          <p className="text-sm text-destructive">{copy.cart.checkoutBlocked}</p>
        )}
        <Link href="/store" className="text-sm underline underline-offset-4">
          {copy.common.continueShopping}
        </Link>
      </div>
    </div>
  );
}
