import { cn } from "@avably/ui";
import type { ReactNode } from "react";

import { BrandLoader } from "@/components/shell/brand-loader";

/**
 * Prymitywy ekranu ładowania panelu.
 *
 * Ekran ładowania rezerwuje dokładną geometrię docelowego ekranu: te same
 * regiony, wysokości linii i podział na kolumny. Rezerwa stoi pod
 * `visibility: hidden`, więc nie maluje ramek ani fikcyjnej treści, ale nadal
 * zajmuje identyczne miejsce i zapobiega skokowi po wejściu danych.
 *
 * Jedyną widoczną warstwą jest centralny `BrandLoader`. Prymitywy pozostają w
 * panelu, ponieważ kopiują jego geometrię, a nie publiczny kontrakt
 * `@avably/ui`; testy parytetu wiążą je z konkretnymi ekranami.
 */

/**
 * Wysokości pasków = wysokości LINE BOXÓW realnych stylów tekstu panelu.
 * Zmiana stylu na ekranie musi przejść tędy — inaczej szkielet zacznie mierzyć
 * co innego niż treść i wróci skok układu.
 */
export const SKELETON_LINE = {
  /** mikro-etykieta wersalikami: `text-[11px] leading-[14px]` */
  micro: "h-[14px]",
  /** podpis: `text-xs` (12/16) */
  caption: "h-4",
  /** tekst pomocniczy i większość komórek: `text-sm` (14/20) */
  text: "h-5",
  /** treść bazowa: `text-base` (16/24) */
  body: "h-6",
  /** nagłówek sekcji: `text-xl leading-[26px]` */
  heading: "h-[26px]",
  /** numer zamówienia w nagłówku szczegółu: `text-2xl leading-[30px]` */
  display: "h-[30px]",
} as const;

export type SkeletonLineName = keyof typeof SKELETON_LINE;

/**
 * Puste pudełko w miejsce linii tekstu. Wysokość bierze się z nazwy stylu, nie
 * z oka — szerokość jest umowna (nie znamy treści), bo w pionie nic od niej nie
 * zależy. Pudełko nic nie maluje: rezerwuje miejsce, którego treść nie ruszy.
 */
export function SkeletonLine({
  line = "text",
  className,
}: {
  line?: SkeletonLineName;
  className?: string;
}) {
  return <SkeletonBlock className={cn(SKELETON_LINE[line], className)} />;
}

/**
 * Puste pudełko w miejsce elementu o WŁASNEJ wysokości (przycisk, chip, pole,
 * awatar). Wysokość podaje wołający — klasą skopiowaną z ekranu (`h-9`, `h-7`,
 * `size-7`). Kiedyś malowało się `secondary`; dziś jest wyłącznie rezerwacją
 * miejsca, więc jedynym jego zadaniem jest NIE zmienić układu. Zakaz malowania
 * pilnuje kontrakt osobno od `visibility` całej rezerwy — dwa zamki, bo pierwszy
 * (klasy) czyta się w kodzie, a drugi (niewidoczność) obowiązuje bez wyjątku.
 */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div data-slot="skeleton-box" aria-hidden="true" className={className} />;
}

/**
 * Region szkieletu = jeden region ekranu. Nazwa jest UCHWYTEM KONTRAKTU:
 * `skeleton-parity-contract.test.tsx` porównuje zbiór regionów szkieletu ze
 * zbiorem regionów realnego ekranu, więc przebudowa ekranu bez aktualizacji
 * szkieletu pali test. Czyste kontenery układu (siatka kafli, kolumna belki)
 * regionami NIE są — region opisuje to, co ma odpowiednik na ekranie.
 */
export function SkeletonRegion({
  region,
  className,
  children,
}: {
  region: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div data-skeleton-region={region} className={className}>
      {children}
    </div>
  );
}

/**
 * Korzeń ekranu ładowania: absolutny loader i niewidoczna rezerwa geometrii.
 * `className` pozostaje kopią klasy korzenia realnego ekranu. SVG loadera jest
 * dekoracją, a pojedyncza etykieta `role="status"` przekazuje stan czytnikowi i
 * jest widoczna. Absolutne pozycjonowanie nie zmienia wysokości rezerwy.
 */
export function SkeletonScreen({
  label,
  className,
  children,
}: {
  /** Komunikat „ładowanie…" — widoczny i dla czytnika (z i18n, nie z palca). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-skeleton-frame className="relative">
      <BrandLoader
        label={label}
        variant="full"
        showLabel
        className="pointer-events-none absolute inset-x-0 top-[clamp(7rem,25vh,14rem)] z-10"
      />
      <div
        data-skeleton-screen
        data-screen="loading"
        aria-busy="true"
        aria-hidden="true"
        /* `invisible` = `visibility: hidden`: zero malowania, pełne pudełko.
           Zdjęcie tej klasy przywraca rysunek techniczny z pinezki — pali
           kontrakt „rezerwa nic nie maluje". */
        className={cn("invisible", className)}
      >
        {children}
      </div>
    </div>
  );
}

/** Powtórzenia regionu (wiersze, kafle, kroki) — `[0, 1, …, count-1]`. */
export function times(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}
