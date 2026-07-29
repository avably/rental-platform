/**
 * SPIKE C0 — rozdzielacz: dwa prototypy silnika edycji hero.
 * Trasa POZA grupą (panel): publiczna, bez DB (jak /design-system).
 */
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function KreatorSpikeHub() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
        Kreator stron · etap C · spike C0
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Silnik edycji: Puck vs własny</h1>
      <p className="text-muted-foreground mt-3">
        Ta sama sekcja hero (nagłówek, podtytuł, przycisk, bloki zalet, wariant układu) w dwóch
        silnikach edycji. Oba serializują do tego samego jsonb walidowanego Zodem.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="./kreator-spike/puck"
          className="border-border hover:border-foreground focus-visible:outline-accent rounded-lg border p-6 outline-none transition-colors focus-visible:outline-[3px] focus-visible:outline-offset-2"
        >
          <h2 className="text-lg font-semibold">Wariant A — Puck</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            @puckeditor/core 0.22 (gotowy edytor, TipTap, własny chrome i format Data).
          </p>
        </Link>
        <Link
          href="./kreator-spike/custom"
          className="border-border hover:border-foreground focus-visible:outline-accent rounded-lg border p-6 outline-none transition-colors focus-visible:outline-[3px] focus-visible:outline-offset-2"
        >
          <h2 className="text-lg font-semibold">Wariant B — własny (@dnd-kit)</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            contentEditable + @dnd-kit + kontrolki @avably/ui (stan = nasz jsonb).
          </p>
        </Link>
      </div>
    </main>
  );
}
