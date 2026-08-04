import { LoadingRail, cn } from "@avably/ui";
import type { ReactNode } from "react";

/**
 * Prymitywy ekranu ładowania panelu (uwaga przeglądu N1, delta z 2026-08-04).
 *
 * ZASADA NACZELNA: ekran ładowania ODWZOROWUJE układ ekranu, którego dotyczy —
 * te same regiony, ta sama geometria, ten sam podział na kolumny. Dlatego pliki
 * szkieletów NIE malują „jakichś pasków", tylko składają regiony z tych samych
 * klas kontenerów co ekran, a w miejsce tekstu wstawiają PUDEŁKO o wysokości
 * LINE BOXA, który ten tekst zajmie. Podmiana treści nie rusza wtedy układu.
 *
 * CO SIĘ ZMIENIŁO (pinezka właściciela „wszędzie nie podobają mi się loading
 * state"): pudełka są dziś PUSTE. Wcześniej każde malowało się powierzchnią
 * `secondary`, przez co ekran zalewała ściana szarych plam udających tekst,
 * którego jeszcze nie ma — czytało się to jak usterka, a nie jak ładowanie.
 * Zostaje sama konstrukcja ekranu (ramki kafli, siatka tabeli), a stan niesie
 * para: szyna `LoadingRail` u góry i WIDOCZNY komunikat `role="status"`.
 * Geometria nie drgnęła ani o piksel, więc kontrakt braku skoku stoi.
 *
 * Trzy powody, dla których prymitywy siedzą tutaj, a nie w `@avably/ui`:
 *  1. wysokości linii są kopią stylów typograficznych PANELU (kafle, belki,
 *     tabele), nie kontraktem design systemu;
 *  2. `packages/ui` jest cudzym pasem własności (docs/DOKUMENTACJA.md §2) —
 *     szynę bierzemy stamtąd, kompozycję trzymamy u siebie;
 *  3. kontrakt spójności ekranów (`panel-consistency-contract.test.tsx`)
 *     skanuje katalog `(panel)` na własne szerokości; ekran ładowania
 *     potrzebuje geometrii KOPIOWANEJ z ekranu (np. `min-w-[880px]` tabeli),
 *     więc jego kod mieszka poza skanem, a w `loading.tsx` zostaje kompozycja.
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
 * miejsca, więc jedynym jego zadaniem jest NIE zmienić układu.
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
 * Korzeń ekranu ładowania: rama (szyna + komunikat) i pod nią geometria.
 *
 * `className` to KOPIA klasy korzenia realnego ekranu (ten sam kierunek osi i
 * ta sama przerwa), bo od niej zależy pozycja każdego regionu niżej.
 *
 * DOSTĘPNOŚĆ. Geometria i szyna są DEKORACJĄ, więc idą pod `aria-hidden`;
 * jedyną treścią zostaje komunikat `role="status"` stojący POZA tym poddrzewem
 * (rola `status` to `aria-live="polite"` + `aria-atomic`, czyli czytnik ogłasza
 * go bez przerywania). Komunikat jest DZIŚ WIDOCZNY — wcześniej stał `sr-only`,
 * a od pinezki właściciela z 2026-08-04 to on mówi wprost, co się ładuje. Jeden
 * węzeł obsługuje oba odbiory: nie ma drugiego, ukrytego tekstu, więc czytnik
 * nie ogłasza stanu dwa razy.
 *
 * UKŁAD. Zarówno szyna, jak i komunikat stoją ABSOLUTNIE względem ramy, więc
 * nie dokładają ani piksela wysokości — wejście treści nie przesuwa niczego
 * (kontrakt braku skoku z pinezki N1). Komunikat siada na 34% wysokości okna:
 * wpada w pierwszy ekran zarówno na krótkiej liście, jak i na długim szczególe,
 * bez przewijania.
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
      <LoadingRail className="pointer-events-none absolute inset-x-0 -top-1" />
      <p
        role="status"
        data-skeleton-status
        className="pointer-events-none absolute inset-x-0 top-[34vh] text-center text-sm"
      >
        {/* Komunikat stoi na WŁASNEJ płytce, a nie gołym tekstem na tle: bez
            niej siada dokładnie na którejś kresce siatki (zmierzone w
            przeglądarce — linia wiersza tabeli przechodziła przez podpis) i
            czyta się jak przypadek. Płytka jest płaska, rozdziela ją obrys, nie
            cień — elewacji w systemie nie ma. */}
        <span className="border-border bg-background text-muted-foreground inline-block rounded-md border px-4 py-2">
          {label}
        </span>
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
    </div>
  );
}

/** Powtórzenia regionu (wiersze, kafle, kroki) — `[0, 1, …, count-1]`. */
export function times(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}
