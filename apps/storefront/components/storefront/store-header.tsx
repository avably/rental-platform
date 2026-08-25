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
 *
 * KSZTAŁT NAGŁÓWKA MIESZKA OD ADR-172 W PAKIECIE UI, bo składa go teraz także
 * podgląd szkicu w panelu — a panel nie ma prawa importować z drugiej
 * aplikacji. Tutaj zostaje wyłącznie to, czego pakiet mieć nie może: żywy
 * licznik koszyka z `localStorage` i nawigacja `next/link`.
 */
import { StoreShellHeader } from "@avably/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cartItemCount } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import type { StoreLogo } from "@/lib/site/store-logo";
import { format, type StorefrontCopy } from "@/lib/storefront/copy";

export function StoreHeader({
  copy,
  storeName,
  logo,
  nav,
  center,
}: {
  copy: StorefrontCopy;
  storeName: string;
  /**
   * ZNAK FIRMY NAJEMCY (ADR-160). Gdy jest — ZASTĘPUJE napis z nazwą sklepu,
   * bo to jest sens własnego logo; nazwa nie znika z dokumentu, tylko przenosi
   * się do tekstu zastępczego obrazu (`storeLogo` pilnuje, żeby nie był pusty).
   * Dwa razy ta sama nazwa obok siebie — raz obrazkiem, raz napisem — byłaby
   * dla czytnika ekranu powtórzeniem, a nie informacją.
   */
  logo: StoreLogo | null;
  /**
   * MENU KATEGORII (ADR-247) — powłoka wstawia tu rozwijaną listę wejść do
   * stron kategorii. Przechodzi wprost do slotu obok znaku w pakiecie UI.
   */
  nav?: ReactNode;
  /**
   * ŚRODEK BELKI (aneks ADR-194) — powłoka wstawia tu pigułkę terminu na
   * trasach, które sprzedają. Przechodzi wprost do kształtu z pakietu UI;
   * o widoczności rozstrzyga media query TAM, nie tutaj.
   */
  center?: ReactNode;
}) {
  const { cart, hydrated } = useCart();
  const count = cartItemCount(cart);
  /*
    SELF-LINK KOSZYKA (S-52 audytu 2026-08-25): na `/cart` odnośnik „Koszyk"
    dostaje `aria-current="page"` i wagę. Ścieżka z routera klienta — trasa
    koszyka nie jest rewrite'owana, więc to jest jej adres publiczny; komponent
    i tak jest kliencki (licznik z localStorage), więc hook niczego nie dokłada.
  */
  const cartCurrent = usePathname() === "/cart";

  return (
    <StoreShellHeader
      storeName={storeName}
      logo={logo}
      cartLabel={copy.nav.cart}
      cartCurrent={cartCurrent}
      nav={nav}
      center={center}
      /*
        LICZNIK POJAWIA SIĘ PO HYDRATACJI (stan z `localStorage`), więc do tej
        chwili nie ma go w drzewie — inaczej serwer i klient rozjechałyby się
        na pierwszym renderze. To jest zarazem jedyny powód, dla którego ten
        komponent w ogóle istnieje obok kształtu z pakietu.
      */
      cartBadge={
        hydrated && count > 0 ? (
          <span
            aria-label={format(copy.nav.cartCount, { count })}
            className="site-badge inline-flex min-w-6 items-center justify-center px-2 text-xs font-semibold"
          >
            {count}
          </span>
        ) : null
      }
      linkComponent={Link}
    />
  );
}
