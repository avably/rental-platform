"use client";

/**
 * Nagłówek sklepu tenanta (2.4b): nazwa (link do katalogu) + link do koszyka z
 * licznikiem sztuk. Licznik pochodzi z localStorage (useCart), więc pojawia się
 * PO hydratacji — do tego czasu badge jest ukryty, żeby serwer i klient nie
 * rozjechały się na pierwszym renderze.
 *
 * Styl neutralny (tokeny bg-card/border), żeby leżał spójnie nad oboma
 * szablonami (classic „papier” i bold „ciemny”).
 */
import Link from "next/link";

import { cartItemCount } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";

export function StoreHeader({ copy, storeName }: { copy: StorefrontCopy; storeName: string }) {
  const { cart, hydrated } = useCart();
  const count = cartItemCount(cart);

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/store" className="text-lg font-semibold tracking-tight text-card-foreground">
          {storeName}
        </Link>
        <Link
          href="/cart"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
        >
          <span>{copy.nav.cart}</span>
          {hydrated && count > 0 ? (
            <span
              aria-label={format(copy.nav.cartCount, { count })}
              className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-2 text-xs font-semibold text-primary-foreground"
            >
              {count}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}
