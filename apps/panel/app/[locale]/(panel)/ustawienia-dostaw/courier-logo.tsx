/**
 * Neutralny placeholder logotypu przewoźnika (ADR-236).
 *
 * W repo NIE MA jeszcze assetów marek GlobKurier ani InPost, a logotypów nie
 * ściągamy z sieci (mogłyby być nieaktualne albo objęte prawami do znaku).
 * Do czasu dostarczenia oficjalnych plików kafelek integracji niesie monogram
 * z inicjałów nazwy — jednoznaczny, spójny wizualnie i pozbawiony ryzyka
 * cudzego znaku. Gdy assety wejdą do repo, wystarczy podmienić TĘ jedną
 * powierzchnię; kafelki nie znają logotypu poza nią.
 *
 * `decorative` (wyszarzenie) obsługuje kafelek nieaktywny („wkrótce").
 */
function monogram(name: string): string {
  const letters = name.match(/\p{Lu}/gu) ?? [];
  if (letters.length >= 2) return `${letters[0]}${letters[1]}`;
  return name.slice(0, 2).toUpperCase();
}

export function CourierLogo({ name, decorative = false }: { name: string; decorative?: boolean }) {
  return (
    <span
      data-courier-logo-placeholder={decorative ? "muted" : "default"}
      aria-hidden="true"
      className={`border-border flex size-10 shrink-0 items-center justify-center rounded-md border text-sm font-semibold tracking-[0.02em] ${
        decorative ? "bg-muted/50 text-muted-foreground" : "bg-muted text-foreground"
      }`}
    >
      {monogram(name)}
    </span>
  );
}
