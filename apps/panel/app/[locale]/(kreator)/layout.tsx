import { ReviewOverlayGate } from "@avably/review/overlay";

import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Powłoka grupy `(kreator)` (naprawa pinezki 494d7445, ADR-083 + ADR-071).
 *
 * Grupa nie miała WŁASNEGO layoutu — nakładka przeglądu montuje się dziś
 * wyłącznie w layoucie `(panel)` (`surface="panel"`), więc na
 * `/strona/[siteId]/kreator` i `/strona/[siteId]/podglad` nie renderowała się w ogóle: trasy
 * stoją POZA `(panel)` świadomie (kreator jest pełnym ekranem, ADR-083).
 * Ten plik nie dokłada żadnej powłoki wizualnej — jedyne zadanie to
 * `{children}` plus TA SAMA potrójna bramka co w `(panel)`: env
 * `REVIEW_MODE=1`, `ctx.superadmin` po stronie serwera, kliencki `?review=1`
 * domyka resztę wewnątrz samej bramki.
 *
 * `surface="panel"` (nie osobna wartość) — `screenFor()` już klasyfikuje
 * `/strona/*` jako ekran „24 Strona sklepu" na powierzchni `panel`
 * (packages/review/src/screens.ts), a kreator i jego launcher (`/strona`)
 * to ten sam ekran przeglądu. Osobna wartość rozjechałaby się z tą listą
 * bez żadnego zysku — uwagi z kreatora i tak trafiają pod tę samą pozycję.
 */
export default async function KreatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const ctx = await getAuthContext(await createSupabaseServerClient());

  return (
    <>
      {children}
      {process.env.REVIEW_MODE === "1" && ctx?.superadmin ? (
        <ReviewOverlayGate surface="panel" />
      ) : null}
    </>
  );
}
