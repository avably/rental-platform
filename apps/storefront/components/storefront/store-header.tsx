"use client";

/**
 * Nagłówek sklepu tenanta (od F7: „pro" — sticky, search na wierzchu, listwa
 * kategorii, koszyk z badge'em licznika POZYCJI).
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
 * licznik koszyka z `localStorage`, nawigacja `next/link` i sonda przewinięcia
 * pod linię sticky (podgląd nagłówka NIE przykleja — ma własny pasek, patrz
 * `sticky` w `StoreShellHeader`).
 *
 * ==================== SONDA PRZEWINIĘCIA (F7) ====================
 *
 * Spec: belka przyklejona, a linia `--site-border` u dołu dopiero PO
 * przewinięciu. Progiem nie jest nasłuch scrolla (praca na każdy piksel),
 * tylko IntersectionObserver na WARTOWNIKU — elemencie 1 px stojącym w toku
 * dokumentu tuż NAD belką (`-mb-px` oddaje ten piksel, układ netto zero).
 * Wartownik znika z okna dokładnie wtedy, gdy strona jest przewinięta —
 * wtedy atrybut `data-store-header-scrolled` na belce włącza linię (reguła
 * w site.css). Bez JavaScriptu atrybut nie stanie — degradacja czysto
 * kosmetyczna (patrz docblock reguły).
 */
import { StoreShellHeader } from "@avably/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import { cartPositionCount } from "@/lib/cart/model";
import { useCart } from "@/lib/cart/use-cart";
import type { StoreLogo } from "@/lib/site/store-logo";
import { pluralCount, type StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";

function StoreHeaderScrollProbe() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = ref.current;
    // jsdom i bardzo stare silniki: bez obserwatora zostaje stan „bez linii".
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    // Belka jest NASTĘPNYM rodzeństwem wartownika (fragment niżej) — celujemy
    // przez sąsiedztwo, nie przez `querySelector` na dokumencie, żeby sonda
    // nie strzelała do cudzego nagłówka, gdyby dokument miał ich więcej.
    const header = sentinel.nextElementSibling;
    if (!header) return;
    const observer = new IntersectionObserver(([entry]) => {
      header.toggleAttribute("data-store-header-scrolled", !entry.isIntersecting);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} aria-hidden className="-mb-px h-px" />;
}

export function StoreHeader({
  copy,
  locale = "pl",
  storeName,
  logo,
  search,
  subnav,
  center,
}: {
  copy: StorefrontCopy;
  /**
   * Język NAJEMCY (oś tenancka) — do ODMIANY licznika pozycji w nazwie
   * dostępnej koszyka (`Intl.PluralRules`). Opcjonalny z domyślnym rynkiem
   * startowym: trasy bez terminu (dokumenty, płatność) nie niosą locale
   * w powłoce, a formy EN w copy mają `few` ≡ `many`, więc reguły PL nigdy
   * nie wybiorą tam błędnego szablonu.
   */
  locale?: StorefrontLocale;
  storeName: string;
  /**
   * ZNAK FIRMY NAJEMCY (ADR-160). Gdy jest — ZASTĘPUJE napis z nazwą sklepu,
   * bo to jest sens własnego logo; nazwa nie znika z dokumentu, tylko przenosi
   * się do tekstu zastępczego obrazu (`storeLogo` pilnuje, żeby nie był pusty).
   */
  logo: StoreLogo | null;
  /**
   * WYSZUKIWANIE W BELCE (F7) — powłoka wstawia tu `StoreHeaderSearch`
   * we właściwym wariancie (pełne pole vs ikona na kasie). Przechodzi wprost
   * do slotu w pakiecie UI.
   */
  search?: ReactNode;
  /**
   * LISTWA KATEGORII (F7, poprzednio menu ADR-247) — drugi rząd nagłówka.
   * Przechodzi wprost do slotu w pakiecie UI; o chipsach mobilnych i braku
   * listwy na kasie rozstrzyga powłoka.
   */
  subnav?: ReactNode;
  /**
   * ŚRODEK BELKI (aneks ADR-194) — powłoka wstawia tu pigułkę terminu na
   * trasach, które sprzedają. Przechodzi wprost do kształtu z pakietu UI;
   * o widoczności rozstrzyga zapytanie kontenerowe TAM, nie tutaj.
   */
  center?: ReactNode;
}) {
  const { cart, hydrated } = useCart();
  /*
    LICZNIK POZYCJI, nie sztuk (spec F7 pkt 5): badge odpowiada na pytanie
    „ile RZECZY mam w koszyku", a nie „ile egzemplarzy" — 2 agregaty × 3 szt.
    to dla klienta dwie pozycje listy. Ta sama migawka koszyka, z której żyło
    dotychczasowe „szt." — zero nowych odczytów.
  */
  const count = cartPositionCount(cart);
  /*
    SELF-LINK KOSZYKA (S-52 audytu 2026-08-25): na `/cart` odnośnik „Koszyk"
    dostaje `aria-current="page"` i wagę. Ścieżka z routera klienta — trasa
    koszyka nie jest rewrite'owana, więc to jest jej adres publiczny; komponent
    i tak jest kliencki (licznik z localStorage), więc hook niczego nie dokłada.
  */
  const cartCurrent = usePathname() === "/cart";
  /*
    LICZNIK POJAWIA SIĘ PO HYDRATACJI (stan z `localStorage`), więc do tej
    chwili nie ma go w drzewie — inaczej serwer i klient rozjechałyby się
    na pierwszym renderze. Nazwa dostępna odnośnika idzie tym samym progiem:
    SSR mówi „Koszyk", po hydratacji „Koszyk, 2 pozycje" (WCAG: nazwa spójna
    z widoczną etykietą — zaczyna się od niej).
  */
  const counted = hydrated && count > 0;

  return (
    <>
      <StoreHeaderScrollProbe />
      <StoreShellHeader
        storeName={storeName}
        logo={logo}
        cartLabel={copy.nav.cart}
        cartAriaLabel={
          counted
            ? pluralCount(count, locale, {
                one: copy.nav.cartCountOne,
                few: copy.nav.cartCountFew,
                many: copy.nav.cartCountMany,
              })
            : undefined
        }
        cartCurrent={cartCurrent}
        search={search}
        subnav={subnav}
        center={center}
        sticky
        cartBadge={
          counted ? (
            /*
              Badge jest WIZUALNYM powtórzeniem licznika z nazwy dostępnej
              odnośnika — dla czytnika ekranu byłby przeczytany drugi raz,
              stąd `aria-hidden`. `tabular-nums`: cyfry o stałej szerokości,
              badge nie faluje przy zmianie 9 → 10 (spec F7).
            */
            <span
              aria-hidden="true"
              className="site-badge inline-flex min-w-6 items-center justify-center px-2 text-xs font-semibold tabular-nums"
            >
              {count}
            </span>
          ) : null
        }
        linkComponent={Link}
      />
    </>
  );
}
