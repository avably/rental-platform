/**
 * Wygląd pola formularza kreatora zamówienia — JEDNA prawda dla wszystkich
 * jego części (kreator rozrósł się w R3 z jednego pliku do kilku).
 *
 * Stan nieaktywny wyłącznie wygaszeniem kontrastu: `disabled:cursor-not-allowed
 * disabled:opacity-50`, bez obrysu kreskowanego — wspólna konwencja zestawu
 * kontrolek (weto właściciela 2026-07-28, bramka
 * `packages/ui/src/components/states.test.tsx`). Obrys akcentowy zostaje
 * zarezerwowany dla `focus-visible`.
 */
export const FIELD_CLASS =
  "border-input bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";
