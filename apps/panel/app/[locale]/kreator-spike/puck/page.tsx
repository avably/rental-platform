/**
 * SPIKE C0 — wariant A (Puck / @puckeditor/core). Trasa POZA (panel): bez auth, bez DB.
 */
import { PuckEditor } from "./puck-editor";

// Dynamiczny render: nonce żądania w <script> (proxy) — inaczej CSP
// strict-dynamic blokuje skrypty prerenderu. Patrz custom/page.tsx.
export const dynamic = "force-dynamic";

export default function PuckSpikePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-col gap-1">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
          Kreator C0 · prototyp
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Wariant A — Puck (@puckeditor/core)</h1>
        <p className="text-muted-foreground text-sm">
          Gotowy silnik edycji. Canvas = ten sam render co storefront. Panele niżej pokazują
          format Pucka i nasz jsonb po adapterze (koszt mapowania = kryt. 1).
        </p>
      </header>
      <PuckEditor />
    </main>
  );
}
