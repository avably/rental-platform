"use client";

/**
 * Nagłówek sklepu tenanta (2.4b): nazwa (link do katalogu) + link do koszyka z
 * licznikiem sztuk. Licznik pochodzi z localStorage (useCart), więc pojawia się
 * PO hydratacji — do tego czasu badge jest ukryty, żeby serwer i klient nie
 * rozjechały się na pierwszym renderze.
 *
 * KOLOR NIE JEST TU DECYZJĄ (K6, ADR-092). Nagłówek nosi wyłącznie ROLE
 * (`site-header`, `site-title`, `site-nav-link`, `site-badge`), a wartości
 * przychodzą ze zmiennych motywu z korzenia strony. Warunkiem jest to, że
 * nagłówek stoi POD tym korzeniem — dlatego renderuje go `StoreChrome`, a nie
 * trasa obok powłoki (poza korzeniem zmienne nie istnieją i te klasy są
 * bezzębne).
 */
import Link from "next/link";

import { SITE_HEADING } from "@/components/storefront/store-chrome";
import { cartItemCount } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";

export function StoreHeader({ copy, storeName }: { copy: StorefrontCopy; storeName: string }) {
  const { cart, hydrated } = useCart();
  const count = cartItemCount(cart);

  return (
    <header className="site-header">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
        <Link href="/store" className={`text-lg tracking-tight ${SITE_HEADING}`}>
          {storeName}
        </Link>
        <Link href="/cart" className="site-nav-link inline-flex items-center gap-2 text-sm font-medium">
          <span>{copy.nav.cart}</span>
          {hydrated && count > 0 ? (
            <span
              aria-label={format(copy.nav.cartCount, { count })}
              className="site-badge inline-flex min-w-6 items-center justify-center px-2 text-xs font-semibold"
            >
              {count}
            </span>
          ) : null}
        </Link>
      </div>
    </header>
  );
}
