import type { GalleryGap, GalleryStructuredContent, GalleryStructuredItem } from "@avably/core/site";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { siteImageUrl } from "../image-url";
import { externalLinkRel } from "../links";

/**
 * WSPÓLNE CZĘŚCI TRZECH UKŁADÓW GALERII (E3, aneks ADR-094).
 *
 * Trzy układy różnią się KONTENEREM (siatka, mozaika, pas przewijany) i niczym
 * więcej: kafel, opis alternatywny, podpis, atrybucja i reguła „odnośnik
 * wygrywa z powiększeniem" są w każdym z nich takie same. Gdyby każdy plik
 * układu miał własną kopię kafla, jedna z trzech kopii zgubiłaby prędzej czy
 * później `rel` albo atrybucję — a to są warunki bezpieczeństwa i licencji,
 * nie detale wyglądu.
 *
 * ZERO HEKSÓW i zero tokenów panelu: kolor bierze się z ról motywu przez klasy
 * arkusza (`site-*`), a role są ZADEKLAROWANE w rejestrze typu i zestawiane ze
 * źródłami przez `structured-role-usage.test.tsx`.
 */

/**
 * ODSTĘP MIĘDZY KAFLAMI. Trzy nazwy gęstości → trzy pozycje ze skali rozstawu.
 * Mozaika (CSS multi-column) potrzebuje DWÓCH liczb: `gap` ustawia jej odstęp
 * między kolumnami, ale odstęp pionowy niesie margines kafla — stąd druga
 * kolumna tablicy zamiast jednej klasy „na wszystko".
 */
export const GALLERY_GAP_CLASS: Record<GalleryGap, string> = {
  tight: "gap-2",
  regular: "gap-4",
  roomy: "gap-8",
};

export const GALLERY_MASONRY_ITEM_GAP: Record<GalleryGap, string> = {
  tight: "mb-2",
  regular: "mb-4",
  roomy: "mb-8",
};

/**
 * LICZBA KAFLI W RZĘDZIE JAKO WŁAŚCIWOŚĆ NIESTANDARDOWA, nie jako klasa.
 *
 * Liczba pochodzi z TREŚCI (operator wybiera 2/3/4), a Tailwind buduje klasy
 * statycznie — `grid-cols-${columns}` nie istniałoby w arkuszu, bo skaner
 * nigdy nie zobaczy tego napisu. Zmienna CSS przenosi wartość z danych do
 * układu bez generowania klas i bez tablicy trzech wariantów w komponencie.
 */
export function galleryColumnsStyle(columns: number): CSSProperties {
  return { "--gallery-columns": String(columns) } as CSSProperties;
}

/** Czy w tym kafelku kliknięcie prowadzi POZA stronę (odnośnik operatora). */
export function galleryTileHref(item: GalleryStructuredItem): string | undefined {
  return item.link;
}

/**
 * ODNOŚNIK WYGRYWA Z POWIĘKSZENIEM (rozstrzygnięcie E3).
 *
 * Kafel z odnośnikiem prowadzi tam, gdzie wskazał operator; powiększenie
 * dostają WYŁĄCZNIE kafle bez odnośnika. Odwrotna kolejność (najpierw
 * powiększ, potem gdzieś przejdź) zabierałaby operatorowi jedyne narzędzie
 * kierowania ruchem z galerii, a wariant „klik powiększa, a w powiększeniu
 * jest jeszcze jeden przycisk" mnoży kroki tam, gdzie intencja jest jedna.
 */
export function galleryOpensLightbox(
  content: GalleryStructuredContent,
  item: GalleryStructuredItem,
): boolean {
  return content.lightbox && !item.link;
}

/** Indeksy kafli, które POWIĘKSZENIE obejmuje — po nich chodzą strzałki ←/→. */
export function galleryLightboxIndexes(content: GalleryStructuredContent): number[] {
  return content.items.flatMap((item, index) => (galleryOpensLightbox(content, item) ? [index] : []));
}

/**
 * SAM OBRAZ. Dwa źródła, dwa światy (ADR-086): plik w naszym buckecie i hotlink
 * u dostawcy. Bez adresu bazowego Storage kafel degraduje do powierzchni
 * zastępczej — render nie ma prawa zależeć od dostępności Storage.
 *
 * `alt` jedzie WPROST z treści, także wtedy, gdy jest pusty: `alt=""` znaczy
 * „obraz dekoracyjny, pomiń", a BRAK atrybutu każe czytnikowi ekranu przeczytać
 * adres pliku. To jest cała różnica między dostępnością a jej pozorem.
 */
export function GalleryImage({
  item,
  siteImageBase,
  className,
}: {
  item: GalleryStructuredItem;
  siteImageBase?: string;
  className?: string;
}) {
  const src =
    item.image.kind === "unsplash"
      ? item.image.url
      : siteImageBase
        ? siteImageUrl(siteImageBase, item.image.path)
        : null;

  if (!src) return <span className={cn("site-placeholder block", className)} aria-hidden="true" />;
  return <img src={src} alt={item.alt} loading="lazy" className={cn("site-media block", className)} />;
}

/**
 * KAFEL: obraz, a pod nim podpis i atrybucja.
 *
 * Podpis i atrybucja stoją POZA obszarem klikalnym z rozmysłu — odnośnik
 * atrybucji wewnątrz przycisku (albo wewnątrz drugiego odnośnika) to
 * nieprawidłowe drzewo dokumentu, w którym przeglądarka sama rozstrzyga, co
 * właściwie kliknięto. Atrybucja jest WARUNKIEM LICENCJI, więc nie może zależeć
 * od takiego rozstrzygnięcia.
 */
export function GalleryTile({
  item,
  siteImageBase,
  imageClassName,
  children,
}: {
  item: GalleryStructuredItem;
  siteImageBase?: string;
  imageClassName: string;
  /** Obszar klikalny wokół obrazu (przycisk powiększenia albo odnośnik). */
  children?: (image: ReactNode) => ReactNode;
}) {
  const image = <GalleryImage item={item} siteImageBase={siteImageBase} className={imageClassName} />;
  const credit = item.image.kind === "unsplash" ? item.image : null;

  return (
    <figure data-gallery-tile className="site-card m-0 flex flex-col overflow-hidden">
      {children ? children(image) : image}
      {item.caption || credit ? (
        <figcaption className="site-text-muted px-3 py-2 text-sm">
          {item.caption ? <span data-gallery-caption>{item.caption}</span> : null}
          {credit ? (
            <>
              {item.caption ? " " : null}
              <a
                data-gallery-credit
                href={credit.authorUrl}
                rel={externalLinkRel(credit.authorUrl)}
                className="underline"
              >
                {credit.authorName}
              </a>
            </>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * Kafel jako ODNOŚNIK. `rel` liczy JEDNA funkcja wspólna z resztą strony
 * (`externalLinkRel`) — adres pochodzi od najemcy i bywa absolutny, a link do
 * obcego hosta bez `noopener` oddaje mu uchwyt do karty klienta sklepu.
 */
export function GalleryTileLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a data-gallery-link href={href} rel={externalLinkRel(href)} className="block">
      {children}
    </a>
  );
}
