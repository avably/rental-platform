"use client";

import type { TestimonialsStructuredContent } from "@avably/core/site";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels } from "../types";
import { StructuredSectionShell } from "./shell";
import { TestimonialCard } from "./testimonials-shared";

/**
 * OPINIE — UKŁAD „KARUZELA" (E6, aneks ADR-094).
 *
 * Ta sama technika, co pas galerii z E3, i to jest decyzja, a nie kopia
 * z wygody: trzy rzeczy poniżej były w E3 KOSZTEM znalezionych wad, więc druga
 * ich wersja byłaby drugą okazją do popełnienia tych samych.
 *
 *   1. BEZ AUTOROTACJI. Opinia, która przesuwa się sama, zabiera czytanie
 *      w połowie zdania — a przy cytacie boli to bardziej niż przy zdjęciu,
 *      bo zdjęcie ogląda się w sekundę, a wypowiedź czyta kilkanaście. Ruchu,
 *      którego użytkownik nie zaczął i nie może zatrzymać, wytyczne
 *      dostępności zabraniają wprost. Pas rusza się WYŁĄCZNIE od strzałki,
 *      gestu albo klawiatury.
 *   2. PRZEWIJA KONTENER, NIE STRONA. Krok robi `scrollTo` SAMEGO PASA.
 *      `scrollIntoView` na kafelku przewinąłby całą stronę tak, żeby kafel
 *      wypadł w oknie — czyli przy każdym kliknięciu strzałki strona
 *      skakałaby pod czytającym.
 *   3. ODSŁONA POD `Suspense` PRZEZ `ResizeObserver`. Sekcja odsłonięta po
 *      hydratacji (podgląd kreatora, leniwe wejście) mierzy w chwili
 *      montowania szerokość ZERO, więc wyliczone przesunięcie byłoby zerowe
 *      i pas wracałby na początek. Obserwator wyrównuje pas na krok bieżący
 *      dopiero wtedy, gdy pas naprawdę ma szerokość — i robi to BEZ animacji,
 *      bo to jest ustawienie stanu, a nie ruch, który ktoś zamówił.
 *
 * Gest przesunięcia palcem jest natywnym przewijaniem (`overflow-x: auto`
 * + `scroll-snap`), więc nie ma tu ani jednej linii obsługi dotyku.
 */
export function StructuredTestimonialsCarousel({
  content,
  styles,
  labels,
}: {
  content: TestimonialsStructuredContent;
  styles: TemplateStyles;
  labels: SiteRenderLabels;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [step, setStep] = useState(0);
  /** Krok bieżący dla obserwatora — bez stanu w domknięciu efektu montującego. */
  const stepRef = useRef(0);
  stepRef.current = step;

  /** Kafle pasa — mierzone z DRZEWA, bo to ich realne pozycje robią krok. */
  const tilesOf = (list: HTMLUListElement) =>
    Array.from(list.querySelectorAll<HTMLElement>("[data-testimonial-item]"));

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
      type="testimonials"
      layout="carousel"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <div data-testimonials-carousel className="mt-8 flex flex-col gap-3">
        <ul
          ref={listRef}
          data-testimonials-list
          onScroll={readStep}
          className="flex list-none snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth p-0"
        >
          {content.items.map((item, index) => (
            <li
              key={index}
              data-testimonial-item={index}
              // Jeden kafel na wąskim kontenerze, dwa na szerokim — pas ma
              // pokazywać, że jest CIĄG DALSZY, więc nigdy nie mieści całości.
              className="flex w-[85%] shrink-0 snap-start @min-[40rem]/site:w-[48%]"
            >
              <TestimonialCard item={item} data-testimonial={index} className="w-full" />
            </li>
          ))}
        </ul>

        <div className="flex gap-2">
          <CarouselButton
            marker="prev"
            label={labels.testimonialsPrev}
            glyph="‹"
            disabled={step === 0}
            onClick={() => move(-1)}
          />
          <CarouselButton
            marker="next"
            label={labels.testimonialsNext}
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
 * czytnik ekranu mówił „następna opinia", a nie „prawy nawias trójkątny".
 * Wygaszenie na końcach jest ŚWIADOME: pas pokazuje położenie w ciągu, więc
 * zawijanie do początku byłoby skokiem bez wyjaśnienia.
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
      data-testimonials-carousel-action={marker}
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
