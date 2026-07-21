/** Identyfikator celu — jeden, żeby link i `<main>` nie rozjechały się cicho. */
export const MAIN_CONTENT_ID = "tresc";

/**
 * Skok do treści (ADR-059) — dług dostępności spisany przy P3.
 *
 * Shell stawia PRZED treścią kilkanaście linków nawigacji. Bez tego skrótu
 * użytkownik klawiatury i czytnika przechodzi je na KAŻDEJ podstronie, zanim
 * dotrze do tego, po co przyszedł.
 *
 * Etykieta przychodzi PROPEM (wzorzec `OrderRowActions` z P4): komponent jest
 * wtedy czysty i renderowalny w teście bez serwera Next.js, a `getTranslations`
 * — który działa wyłącznie po stronie serwera — zostaje w layoucie.
 *
 * Link jest PIERWSZYM elementem w kolejności tabulacji i widoczny wyłącznie
 * po otrzymaniu fokusu (`sr-only` + `focus:not-sr-only`) — nie jest ukryty
 * przed czytnikiem, tylko przed wzrokiem, dopóki nie jest potrzebny.
 * Ukrycie go przez `display:none` wyjęłoby go z kolejności tabulacji i
 * zniweczyło cały zabieg.
 */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      data-skip-link
      className="bg-background text-foreground border-border sr-only rounded-md border px-4 py-2 text-sm font-medium outline-none focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:outline-solid focus:outline-[3px] focus:outline-offset-2 focus:outline-accent dark:focus:outline-ring"
    >
      {label}
    </a>
  );
}
