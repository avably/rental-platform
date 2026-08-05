import { directionsRouteHref, type DirectionsStructuredItem } from "@avably/core/site";

import { externalLinkRel } from "../links";
import type { SiteRenderLabels } from "../types";

/**
 * DOJAZD — CZĘŚĆ WSPÓLNA OBU UKŁADÓW (E5, ADR-096).
 *
 * Karty punktów są zwykłym, serwerowym drzewem: adres, godziny i odnośnik
 * „Prowadź". Nic tu nie czeka na kliknięcie i nic nie zależy od JavaScriptu —
 * odwiedzający z wyłączonymi skryptami (i wyszukiwarka) dostaje komplet
 * adresów, a interaktywna jest WYŁĄCZNIE mapa (patrz `directions-map.tsx`).
 *
 * ZERO HEKSÓW — kolor wyłącznie przez klasy ról (`site-*`), zestawiane ze
 * źródłami przez `structured-role-usage.test.tsx`.
 */

/**
 * Nazwa punktu do pokazania człowiekowi: etykieta, a gdy jej nie ma — sam
 * adres. Nazwa jest OPCJONALNA (patrz schemat), więc każde miejsce, które musi
 * punkt jakoś zawołać (chip wyboru, tytuł ramki mapy), pyta tą jedną funkcją.
 * Bez niej „bez nazwy" objawiłoby się pustym chipem, którego nie da się kliknąć
 * świadomie ani przeczytać czytnikiem ekranu.
 */
export function directionsLocationName(item: DirectionsStructuredItem): string {
  return item.label ?? item.address;
}

/** Jedna karta punktu — nazwa, adres, godziny i odnośnik nawigacji. */
export function DirectionsCard({
  item,
  labels,
}: {
  item: DirectionsStructuredItem;
  labels: SiteRenderLabels;
}) {
  const route = directionsRouteHref(item.address);
  return (
    <article data-directions-location className="site-card flex flex-col gap-2 rounded-lg p-4">
      {item.label ? <h3 className="site-title text-lg">{item.label}</h3> : null}
      <dl className="m-0 flex flex-col gap-1 text-base">
        <div className="flex flex-wrap gap-2">
          <dt className="site-label">{labels.directionsAddress}</dt>
          {/*
            `whitespace-pre-line`: adres bywa wpisany w dwóch wierszach i tak ma
            zostać. Zwijanie go do jednej linii jest zmianą treści najemcy.
          */}
          <dd className="m-0 whitespace-pre-line">{item.address}</dd>
        </div>
        {item.hours ? (
          <div className="flex flex-wrap gap-2">
            <dt className="site-label">{labels.directionsHours}</dt>
            <dd className="site-text-muted m-0 whitespace-pre-line">{item.hours}</dd>
          </div>
        ) : null}
      </dl>
      {/*
        „Prowadź" wychodzi POZA stronę, więc liczy `rel` wspólną regułą linków
        wychodzących: obcy serwis nie dostaje ani uchwytu do karty klienta
        (`noopener`), ani adresu podstrony, z której wyszedł (`noreferrer`).
        Nowa karta, bo nawigacja to osobna praca — po niej wraca się do sklepu.
      */}
      <a
        data-directions-route
        className="site-link text-sm"
        href={route}
        target="_blank"
        rel={externalLinkRel(route)}
      >
        {labels.directionsRoute}
      </a>
    </article>
  );
}

/** Lista kart punktów — jedyna różnica między układami jest w kontenerze. */
export function DirectionsCards({
  items,
  labels,
  className,
}: {
  items: readonly DirectionsStructuredItem[];
  labels: SiteRenderLabels;
  className?: string;
}) {
  return (
    <div data-directions-locations className={className}>
      {items.map((item, index) => (
        <DirectionsCard key={`${item.address}-${index}`} item={item} labels={labels} />
      ))}
    </div>
  );
}
