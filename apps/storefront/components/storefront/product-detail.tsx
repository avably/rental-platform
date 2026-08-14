"use client";

/**
 * Podstrona produktu (2.4b): galeria + opis + specyfikacja.
 *
 * CZĘŚĆ TRANSAKCYJNA STOI OBOK, W JEDNYM WIDGECIE (faza 5, ADR-180). Do tej
 * zmiany ta podstrona miała własną parę pól daty, własny przycisk „sprawdź
 * dostępność" i własne dodanie do koszyka — czyli DRUGI wybór terminu obok
 * paska powłoki (ADR-179) i drugą ścieżkę odczytu dostępności. Widget
 * (`ProductBooking`) jest jeden i stoi w OBU gałęziach trasy sprzętu, także
 * w szablonie najemcy; gdyby ta podstrona zachowała swoją kopię, najemca
 * z szablonem sprzedawałby innym interfejsem niż najemca bez szablonu.
 *
 * WYGLĄD Z MOTYWU NAJEMCY (K6, ADR-092): podstrona nosi role, nie kolory.
 * Pola i przyciski są ZWYKŁYMI elementami HTML, nie komponentami `@avably/ui` —
 * tamte wnoszą własne tokeny panelu, których skan źródeł tego pliku nie widzi,
 * więc gwarancja „bez palety panelu" byłaby pozorna.
 */
import { useState, type ReactNode } from "react";

import { SITE_HEADING } from "@/components/storefront/store-chrome";
import type { ProductDetailView } from "@/lib/catalog/present";
import type { StorefrontCopy } from "@/lib/storefront/copy";

export function ProductDetail({
  product,
  copy,
  booking,
}: {
  product: ProductDetailView;
  copy: StorefrontCopy;
  /**
   * WIDGET REZERWACJI jako gotowe drzewo, a nie import w tym pliku.
   *
   * Wstawia go TRASA — ta sama, która wstawia go w gałęzi szablonu. Dzięki temu
   * „strona sprzętu ma rezerwację" jest zdaniem o TRASIE i da się je sprawdzić
   * w jednym miejscu dla obu gałęzi, zamiast dwa razy w dwóch komponentach,
   * z których jeden zawsze zostanie w tyle.
   */
  booking: ReactNode;
}) {
  const [activeImage, setActiveImage] = useState(0);

  return (
    <div className="grid gap-10 md:grid-cols-2">
      {/* Galeria */}
      <div className="flex flex-col gap-4">
        {product.images.length > 0 ? (
          <>
            {/* Zdjęcia z publicznego Storage — zwykły <img> jak sekcja products
                w @avably/ui; next/image nie wnosi tu wartości. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={product.images[activeImage]!.url}
              alt={product.images[activeImage]!.alt}
              className="site-media aspect-[4/3] w-full object-cover"
            />
            {product.images.length > 1 ? (
              <ul className="flex list-none flex-wrap gap-2 p-0">
                {product.images.map((image, index) => (
                  <li key={image.url}>
                    <button
                      type="button"
                      onClick={() => setActiveImage(index)}
                      // Przełącznik zdjęcia w galerii, nie wskazanie pozycji
                      // nawigacji — stąd aria-pressed zamiast aria-current.
                      aria-pressed={index === activeImage}
                      // Zaznaczenie miniatury idzie AKCENTEM motywu, a nie
                      // kolorem panelu — obrys jako `outline`, żeby grubość
                      // ramki nie przesuwała sąsiadów przy przełączaniu.
                      className={`site-media block cursor-pointer outline-offset-1 ${
                        index === activeImage
                          ? "outline-2 outline-[color:var(--site-accent)]"
                          : "outline-1 outline-[color:var(--site-border)]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={image.alt} className="h-16 w-16 object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <div className="site-placeholder aspect-[4/3] w-full" aria-hidden="true" />
        )}
      </div>

      {/* Treść + akcja */}
      <div className="flex flex-col gap-5">
        <div>
          <h1 className={`text-3xl tracking-tight ${SITE_HEADING}`}>{product.name}</h1>
          <p className="site-text-muted mt-2 text-lg">{product.basePriceLabel}</p>
          <p className="site-text-muted text-sm">
            {copy.product.depositLabel}: {product.depositFormatted}
          </p>
        </div>

        {product.description ? (
          <div>
            <h2 className="site-text-muted text-sm font-semibold uppercase tracking-wide">
              {copy.product.descriptionHeading}
            </h2>
            <p className="mt-1 whitespace-pre-line leading-7">{product.description}</p>
          </div>
        ) : null}

        {/*
          SPECYFIKACJA TECHNICZNA (faza 1a, ADR-154) — publiczne pola własne
          sprzętu. Tabela, a nie lista: para „etykieta — wartość" powtórzona
          siedem razy JEST tabelą, a czytnik ekranu dostaje wtedy nagłówki
          wierszy zamiast ciągu zdań. Brak ani jednej wypełnionej wartości
          znaczy BRAK TABELI: pusta ramka z samym nagłówkiem czyta się jak
          usterka, a nie jak „ten sprzęt nie ma specyfikacji".
        */}
        {product.specs.length > 0 ? (
          <div>
            <h2 className="site-text-muted text-sm font-semibold uppercase tracking-wide">
              {copy.product.specsHeading}
            </h2>
            <table data-product-specs className="mt-2 w-full text-sm">
              <tbody>
                {product.specs.map((spec) => (
                  <tr key={spec.id} data-product-spec={spec.id} className="site-rule-top">
                    <th scope="row" className="site-text-muted py-2 pr-4 text-left font-normal align-top">
                      {spec.label}
                    </th>
                    <td className="py-2 text-left align-top">{spec.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/*
          REZERWACJA — jedno drzewo podane przez trasę (patrz props `booking`).
          Stoi POD opisem i specyfikacją, czyli po informacji, na której klient
          podejmuje decyzję, a nie przed nią.
        */}
        {booking}
      </div>
    </div>
  );
}
