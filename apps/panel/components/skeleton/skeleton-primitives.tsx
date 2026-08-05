import { LoadingRail, cn } from "@avably/ui";
import type { ReactNode } from "react";

/**
 * Prymitywy ekranu ładowania panelu (uwaga przeglądu N1, delta v3 2026-08-05).
 *
 * ZASADA NACZELNA: ekran ładowania REZERWUJE układ ekranu, którego dotyczy —
 * te same regiony, ta sama geometria, ten sam podział na kolumny. Dlatego pliki
 * szkieletów NIE malują „jakichś pasków", tylko składają regiony z tych samych
 * klas kontenerów co ekran, a w miejsce tekstu wstawiają PUDEŁKO o wysokości
 * LINE BOXA, który ten tekst zajmie. Podmiana treści nie rusza wtedy układu.
 *
 * CZEGO WIDAĆ Z TEJ REZERWY: NIC. Pinezka właściciela z 2026-08-05 („chcę
 * widzieć TYLKO pasek u góry i informację na dole — ładowanie") zamyka drogę,
 * którą delta z 2026-08-04 przeszła w połowie. Wtedy pudełka przestały malować
 * POWIERZCHNIĘ, ale na ekranie zostały jeszcze ramki kafli, obrys tabeli i
 * kreski jej wierszy — pusty rysunek techniczny strony, której nie ma. Dziś
 * cała geometria stoi pod `visibility: hidden` (klasa `invisible`), więc nie
 * maluje ani obrysu, ani tła, ani tekstu — a mimo to zajmuje CO DO PIKSELA to
 * samo miejsce co treść, bo `visibility` nie zdejmuje pudełka z układu.
 *
 * Dlaczego niewidoczność, a nie wycięcie klas malujących: obrys to 1 px z
 * KAŻDEJ strony i wchodzi do wysokości. Zdjęcie `border` przesunęłoby wszystko
 * niżej i wróciłby skok przy podmianie na treść — czyli dokładnie ta wada,
 * przez którą kontrakt odpowiedniości w ogóle powstał. Rezerwa zostaje więc
 * DOKŁADNĄ KOPIĄ ekranu, tylko przestaje być widoczna. Widoczne zostają dwie
 * rzeczy i nic poza nimi: szyna `LoadingRail` u góry i komunikat
 * `role="status"` przy DOLNEJ krawędzi okna.
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
 * Korzeń ekranu ładowania: rama (szyna + komunikat) i pod nią NIEWIDOCZNA
 * rezerwa geometrii.
 *
 * `className` to KOPIA klasy korzenia realnego ekranu (ten sam kierunek osi i
 * ta sama przerwa), bo od niej zależy pozycja każdego regionu niżej.
 *
 * DOSTĘPNOŚĆ. Rezerwa i szyna są DEKORACJĄ, więc idą pod `aria-hidden`; jedyną
 * treścią zostaje komunikat `role="status"` stojący POZA tym poddrzewem (rola
 * `status` to `aria-live="polite"` + `aria-atomic`, czyli czytnik ogłasza go
 * bez przerywania). Komunikat jest WIDOCZNY — wcześniej stał `sr-only`, a od
 * pinezki właściciela z 2026-08-04 to on mówi wprost, co się ładuje. Jeden
 * węzeł obsługuje oba odbiory: nie ma drugiego, ukrytego tekstu, więc czytnik
 * nie ogłasza stanu dwa razy. `visibility: hidden` na rezerwie dokłada do tego
 * drugi zamek: jej treść nie jest renderowana ani dla oka, ani dla czytnika.
 *
 * UKŁAD (delta v3). Szyna stoi ABSOLUTNIE względem ramy, komunikat — STAŁE
 * względem okna, więc żadne z nich nie dokłada ani piksela wysokości i wejście
 * treści nie przesuwa niczego (kontrakt braku skoku z pinezki N1).
 *
 * Dlaczego komunikat jest przy dolnej krawędzi OKNA, a nie na dole rezerwy:
 * rezerwa jest niewidoczna, więc jej dół nie jest żadną widoczną krawędzią, a
 * na dodatek ma inną wysokość na każdym ekranie (lista 638 px, szczegół ponad
 * dwa razy tyle). Komunikat wędrowałby wtedy po ekranie zależnie od trasy, a na
 * szczególe wypadał POD ZGIĘCIE — znikałby dokładnie wtedy, kiedy ładowanie
 * trwa długo i jest najbardziej potrzebny. Okno jest jedynym odniesieniem
 * wspólnym dla wszystkich tras: szyna trzyma górną krawędź, komunikat dolną.
 * Pozycję poziomą (kolumna treści, nie środek okna) ustawia `globals.css` —
 * tam siedzi też odsunięcie od dolnego paska nawigacji mobilnej.
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
      {/* Goły tekst, bez płytki. Płytka (obrys + tło) była z 2026-08-04 łatką
          na to, że komunikat siadał na kresce siatki tabeli — kreski nie ma,
          bo rezerwa nic nie maluje, więc łatka razem z nią wypada. */}
      <p
        role="status"
        data-skeleton-status
        className="text-muted-foreground text-center text-sm"
      >
        {label}
      </p>
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
