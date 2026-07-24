import { Skeleton, cn } from "@avably/ui";
import type { ReactNode } from "react";

/**
 * Prymitywy szkieletu ładowania panelu (uwaga przeglądu N1).
 *
 * ZASADA NACZELNA: szkielet ODWZOROWUJE układ ekranu, którego dotyczy — te
 * same regiony, ta sama geometria, ten sam podział na kolumny. Dlatego pliki
 * szkieletów NIE malują „jakichś pasków", tylko składają regiony z tych samych
 * klas kontenerów co ekran, a w miejsce tekstu wstawiają pasek o wysokości
 * LINE BOXA, który ten tekst zajmie. Podmiana treści nie rusza wtedy układu.
 *
 * Trzy powody, dla których prymitywy siedzą tutaj, a nie w `@avably/ui`:
 *  1. wysokości linii są kopią stylów typograficznych PANELU (kafle, belki,
 *     tabele), nie kontraktem design systemu;
 *  2. `packages/ui` jest cudzym pasem własności (docs/DOKUMENTACJA.md §2) —
 *     atom `Skeleton` bierzemy stamtąd, kompozycję trzymamy u siebie;
 *  3. kontrakt spójności ekranów (`panel-consistency-contract.test.tsx`)
 *     skanuje katalog `(panel)` na własne szerokości; szkielet potrzebuje
 *     geometrii KOPIOWANEJ z ekranu (np. `min-w-[880px]` tabeli), więc jego
 *     kod mieszka poza skanem, a w `loading.tsx` zostaje sama kompozycja.
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
 * Pasek w miejsce linii tekstu. Wysokość bierze się z nazwy stylu, nie z oka —
 * szerokość jest umowna (nie znamy treści), bo w pionie nic od niej nie zależy.
 */
export function SkeletonLine({
  line = "text",
  className,
}: {
  line?: SkeletonLineName;
  className?: string;
}) {
  return <Skeleton className={cn(SKELETON_LINE[line], className)} />;
}

/**
 * Pasek w miejsce elementu o WŁASNEJ wysokości (przycisk, chip, pole, awatar).
 * Wysokość podaje wołający — klasą skopiowaną z ekranu (`h-9`, `h-7`, `size-7`).
 */
export function SkeletonBlock({ className }: { className?: string }) {
  return <Skeleton className={className} />;
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
 * Korzeń ekranu ładowania.
 *
 * `className` to KOPIA klasy korzenia realnego ekranu (ten sam kierunek osi i
 * ta sama przerwa), bo od niej zależy pozycja każdego regionu niżej.
 *
 * Dostępność: cały szkielet jest DEKORACJĄ, więc idzie pod `aria-hidden`, a
 * jedyną treścią ekranu zostaje komunikat `role="status"` stojący POZA tym
 * poddrzewem. Komunikat jest `sr-only`, czyli pozycjonowany absolutnie — nie
 * jest elementem układu i nie dokłada ani piksela wysokości.
 */
export function SkeletonScreen({
  label,
  className,
  children,
}: {
  /** Komunikat „ładowanie…" dla czytnika ekranu (z i18n, nie z palca). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <>
      <p role="status" className="sr-only">
        {label}
      </p>
      <div
        data-skeleton-screen
        data-screen="loading"
        aria-busy="true"
        aria-hidden="true"
        className={className}
      >
        {children}
      </div>
    </>
  );
}

/** Powtórzenia regionu (wiersze, kafle, kroki) — `[0, 1, …, count-1]`. */
export function times(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}
