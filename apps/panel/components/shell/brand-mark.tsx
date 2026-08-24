/**
 * Znak Avably w shellu panelu (ADR-059).
 *
 * ŚCIEŻKI WORDMARKU SĄ KOPIĄ powierzchni `svg-set` artefaktu Fazy 2
 * (`full-lime`), nie rysunkiem od nowa — pełne logo jest ZAMROŻONE. Sygnet
 * `symbol-color` jest zatwierdzonym wariantem dot-only: jedna wyśrodkowana
 * kropka na ciemnym polu, bez litery.
 *
 * Wszystkie cztery warianty `full-*` handoffu mają IDENTYCZNE źródło SVG —
 * artefakt rozróżnia je otoczeniem (CSS `data-brand-mark`), nie rysunkiem.
 * Kapsuła limonkowa jest więc samowystarczalna i czyta się na obu
 * powierzchniach, dlatego shell nie przełącza znaku między motywami.
 *
 * ROZMIARY Z REGUŁ SEKCJI 02: pełne logo co najmniej 120 px szerokości,
 * sygnet co najmniej 24 px. Kropka #A8C743 występuje WYŁĄCZNIE wewnątrz
 * zatwierdzonego znaku — nigdy jako element interfejsu.
 */

import type { CSSProperties } from "react";

export const BRAND_COLORS = {
  capsule: "#EAFFA4",
  dot: "#A8C743",
  ink: "#0B1017",
} as const;

const BRAND_WORDMARK_PATHS = [
  "M280.703 69.8609L268.659 33.4453H276.31L287.434 68.7273L299.336 33.4453H307.2L289.063 84.7389H281.482L286.938 69.8609H280.703Z",
  "M258.992 69.8588V20.2656H266.077V69.8588H258.992Z",
  "M239.521 70.7799C231.302 70.7799 226.627 64.8287 225.422 56.7521V69.8588H218.337V20.2656H225.422V45.9833C226.627 37.6233 232.436 32.5222 239.521 32.5222C248.944 32.5222 255.461 40.528 255.461 51.7219C255.461 62.6324 248.802 70.7799 239.521 70.7799ZM225.139 51.7219C225.139 58.8066 229.815 64.3327 236.616 64.3327C243.205 64.3327 248.235 59.4443 248.235 51.7219C248.235 44.1412 243.205 38.9694 236.758 38.9694C230.381 38.9694 225.139 43.6453 225.139 51.7219Z",
  "M193.072 70.7811C185.775 70.7811 180.603 66.0343 180.603 59.2329C180.603 52.4316 185.633 48.4641 192.647 47.7556L205.045 46.4804C204.974 42.1587 201.857 38.758 196.402 38.758C191.372 38.758 188.963 41.9461 188.325 44.8509L182.02 43.0089C183.649 36.6326 188.892 32.5234 196.402 32.5234C207.029 32.5234 211.988 39.6082 211.988 46.9055V69.86H204.974V58.6662C204.974 66.3885 200.015 70.7811 193.072 70.7811ZM187.688 59.2329C187.688 62.7045 190.663 64.9007 194.56 64.9007C202.07 64.9007 205.045 59.4455 205.045 54.2736V52.2899L194.205 53.4234C189.884 53.9194 187.688 55.9031 187.688 59.2329Z",
  "M154.973 69.8609L143.071 33.4453H150.581L161.775 68.7982L172.543 33.4453H180.195L168.292 69.8609H154.973Z",
  "M100.8 69.8588L116.599 20.2656H130.556L146.355 69.8588H138.774L135.303 58.8775H111.781L108.31 69.8588H100.8ZM113.907 52.0053H133.177L123.542 21.3992L113.907 52.0053Z",
] as const;

/** Zamrożone krzywe Safiro współdzielone przez statyczny znak i loader. */
export function BrandWordmark({
  className,
  pathClassName,
}: {
  className?: string;
  pathClassName?: string;
}) {
  return (
    <g
      transform="translate(-2 0)"
      className={className}
      data-brand-loader-wordmark={pathClassName ? true : undefined}
    >
      <g fill={BRAND_COLORS.ink}>
        {BRAND_WORDMARK_PATHS.map((path, index) => {
          // Artefakt zapisuje ścieżki od prawej (`y`) do lewej (`a`). Delay
          // odwracamy, żeby pojawianie czytało się naturalnie a→v→a→b→l→y.
          const letterIndex = BRAND_WORDMARK_PATHS.length - 1 - index;
          return (
            <path
              key={path}
              d={path}
              className={pathClassName}
              data-brand-loader-letter={pathClassName ? letterIndex : undefined}
              style={
                pathClassName
                  ? ({ "--brand-letter-index": letterIndex } as CSSProperties)
                  : undefined
              }
            />
          );
        })}
      </g>
    </g>
  );
}

/** Pełne logo — sidebar. Minimalna szerokość w interfejsie: 120 px. */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 348 93"
      role="img"
      aria-label="Avably"
      data-brand-mark="full-lime"
      className={className}
    >
      <rect width="348" height="93" rx="44" fill={BRAND_COLORS.capsule} />
      <circle cx="57.5" cy="46" r="15" fill={BRAND_COLORS.dot} />
      <BrandWordmark />
    </svg>
  );
}

/** Sygnet — belka mobilna i belka superadmina. Minimalny rozmiar: 24 px. */
export function BrandSymbol({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      role="img"
      aria-label="Avably"
      data-brand-mark="symbol-color"
      className={className}
    >
      <rect width="96" height="96" rx="25" fill={BRAND_COLORS.ink} />
      <circle data-brand-dot cx="48" cy="48" r="25" fill={BRAND_COLORS.dot} />
    </svg>
  );
}
