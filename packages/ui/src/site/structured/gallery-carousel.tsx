"use client";

import type { GalleryStructuredContent } from "@avably/core/site";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels } from "../types";
import { GALLERY_GAP_CLASS } from "./gallery-shared";
import { GalleryPhotos } from "./gallery-photos";
import { StructuredSectionShell } from "./shell";

/**
 * GALERIA — UKŁAD „KARUZELA" (E3, aneks ADR-094).
 *
 * Jeden pas przewijany w bok: dla galerii, która ma być akcentem strony, a nie
 * jej połową. Trzy decyzje, które widać w kodzie:
 *
 *   1. BEZ AUTOROTACJI. Zdjęcia, które przesuwają się same, zabierają czytanie
 *      podpisu i są wprost odradzane w wytycznych dostępności (ruch, którego
 *      użytkownik nie zaczął i nie może zatrzymać). Pas rusza się WYŁĄCZNIE
 *      od strzałki, gestu albo klawiatury.
 *   2. PRZEWIJA KONTENER, NIE STRONA. Krok robi `scrollTo` SAMEGO PASA.
 *      `scrollIntoView` na kafelku przewinąłby całą stronę tak, żeby kafel
 *      wypadł w oknie — czyli przy każdym kliknięciu strzałki strona
 *      skakałaby pod użytkownikiem.
 *   3. ODSŁONA POD `Suspense` PRZEZ `ResizeObserver`. Sekcja odsłonięta po
 *      hydratacji (podgląd kreatora, leniwe wejście) mierzy w chwili montowania
 *      szerokość ZERO, więc wyliczone przesunięcie byłoby zerowe i pas
 *      wracałby na początek. Obserwator wyrównuje pas na krok bieżący dopiero
 *      wtedy, gdy pas naprawdę ma szerokość — i robi to BEZ animacji, bo to
 *      jest ustawienie stanu, a nie ruch, który ktoś zamówił.
 *
 * Gest przesunięcia palcem jest natywnym przewijaniem (`overflow-x: auto`
 * + `scroll-snap`), więc nie ma tu ani jednej linii obsługi dotyku: własna
 * implementacja gestu byłaby gorsza od przeglądarkowej na każdym urządzeniu.
 */
export function StructuredGalleryCarousel({
  content,
  styles,
  siteImageBase,
  labels,
}: {
  content: GalleryStructuredContent;
  styles: TemplateStyles;
  siteImageBase?: string;
  labels: SiteRenderLabels;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [step, setStep] = useState(0);
  /** Krok bieżący dla obserwatora — bez stanu w domknięciu efektu montującego. */
  const stepRef = useRef(0);
  stepRef.current = step;

  /** Kafle pasa — mierzone z DRZEWA, bo to ich realne pozycje robią krok. */
  const tilesOf = (list: HTMLUListElement) =>
    Array.from(list.querySelectorAll<HTMLElement>("[data-gallery-item]"));

  const scrollToStep = useCallback((index: number, behavior: ScrollBehavior) => {
    const list = listRef.current;
    if (!list) return;
    const tile = tilesOf(list)[index];
    if (!tile) return;
    // Przesunięcie liczone WZGLĘDEM PASA (a nie okna) — patrz decyzja 2.
    list.scrollTo({ left: tile.offsetLeft - list.offsetLeft, behavior });
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      // Zerowa szerokość znaczy „jeszcze nieodsłonięte" — wtedy nie ma czego
      // wyrównywać, a wyliczone przesunięcie i tak byłoby zerem.
      if (list.clientWidth > 0) scrollToStep(stepRef.current, "instant");
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [scrollToStep]);

  /** Krok bieżący z realnego przewinięcia — kafel najbliższy lewej krawędzi. */
  const readStep = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const tiles = tilesOf(list);
    if (tiles.length === 0) return;
    const left = list.scrollLeft + list.offsetLeft;
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (const [index, tile] of tiles.entries()) {
      const delta = Math.abs(tile.offsetLeft - left);
      if (delta < distance) {
        distance = delta;
        closest = index;
      }
    }
    setStep(closest);
  }, []);

  const move = (direction: -1 | 1) => {
    const next = Math.min(content.items.length - 1, Math.max(0, step + direction));
    setStep(next);
    scrollToStep(next, "smooth");
  };

  return (
    <StructuredSectionShell
      type="gallery"
      layout="carousel"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <div data-gallery-carousel className="mt-8 flex flex-col gap-3">
        <GalleryPhotos
          content={content}
          labels={labels}
          siteImageBase={siteImageBase}
          listRef={listRef}
          onListScroll={readStep}
          listClassName={cn(
            "flex snap-x snap-mandatory overflow-x-auto scroll-smooth",
            GALLERY_GAP_CLASS[content.gap],
          )}
          // Dwa kafle na wąskim kontenerze, trzy na szerokim — pas ma pokazywać,
          // że jest CIĄG DALSZY, więc nigdy nie mieści się w nim całość.
          itemClassName="w-[70%] shrink-0 snap-start @min-[40rem]/site:w-[38%]"
          imageClassName="aspect-[4/3] w-full object-cover"
        />

        <div className="flex gap-2">
          <CarouselButton
            marker="prev"
            label={labels.galleryPrev}
            glyph="‹"
            disabled={step === 0}
            onClick={() => move(-1)}
          />
          <CarouselButton
            marker="next"
            label={labels.galleryNext}
            glyph="›"
            disabled={step >= content.items.length - 1}
            onClick={() => move(1)}
          />
        </div>
      </div>
    </StructuredSectionShell>
  );
}

/**
 * Strzałka pasa. Znak jest DEKORACJĄ — znaczenie niesie dostępna nazwa, żeby
 * czytnik ekranu mówił „następne zdjęcie", a nie „prawy nawias trójkątny".
 * Wygaszenie na końcach jest ŚWIADOME i odwrotne niż w oknie powiększenia: pas
 * pokazuje położenie w ciągu, więc zawijanie do początku byłoby skokiem bez
 * wyjaśnienia — a w oknie widać JEDNO zdjęcie i licznik, który mówi, gdzie się
 * jest.
 */
function CarouselButton({
  marker,
  label,
  glyph,
  disabled,
  onClick,
}: {
  marker: string;
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-gallery-carousel-action={marker}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "site-card flex size-9 items-center justify-center text-lg leading-none",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
