import * as React from "react";

import { cn } from "../lib/cn";

// Filtr-pigułka z sekcji 07 artefaktu Fazy 2: powierzchnia secondary,
// font 600 13/1, promień md. Stan wciśnięty przechodzi na limonkę WYŁĄCZNIE
// z nośnikiem ink (tekst accent-foreground + obrys foreground) — twardy zakaz
// lime-without-carrier. Reszta stanów jak każda kontrolka: hover podkreśla,
// focus obrysowuje na limonce, disabled wygasza kontrast (opacity) — bez
// obrysu kreskowanego, żeby nie mylił się z fokusem.
interface FilterChipProps extends React.ComponentProps<"button"> {
  /* Pigułka to przełącznik — stan jest jawny i trafia w aria-pressed. */
  pressed: boolean;
}

function FilterChip({ pressed, className, type, ...props }: FilterChipProps) {
  return (
    <button
      type={type ?? "button"}
      data-slot="filter-chip"
      aria-pressed={pressed}
      className={cn(
        "inline-flex cursor-pointer items-center rounded-md border border-transparent bg-secondary px-3.5 py-2 text-[13px] leading-none font-semibold text-secondary-foreground outline-none transition-[color,background-color,border-color,text-decoration-color,outline-color,transform] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] not-disabled:hover:underline not-disabled:hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring active:translate-y-px aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-pressed:border-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress",
        className,
      )}
      {...props}
    />
  );
}

export { FilterChip, type FilterChipProps };
