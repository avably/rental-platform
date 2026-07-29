/**
 * SPIKE C0 — wariant B (własny silnik na @dnd-kit + kontrolki @avably/ui).
 * Trasa POZA grupą (panel): bez auth, bez DB — samowystarczalny prototyp.
 */
import { CustomEditor } from "./custom-editor";

// Dynamiczny render per żądanie: tylko wtedy Next wstrzykuje nonce żądania
// (z proxy) w tagi <script>. Statyczny prerender + CSP nonce = skrypty bez
// nonce → strict-dynamic je blokuje → brak hydracji. Dotyczy OBU prototypów.
export const dynamic = "force-dynamic";

export default function CustomSpikePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-8 flex flex-col gap-1">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.08em] uppercase">
          Kreator C0 · prototyp
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Wariant B — własny silnik (@dnd-kit)</h1>
        <p className="text-muted-foreground text-sm">
          Edycja inline (contentEditable), reorder bloków klawiaturą, wariant układu. Stan edytora
          JEST naszym jsonb — panel po prawej pokazuje serializację walidowaną Zodem.
        </p>
      </header>
      <CustomEditor />
    </main>
  );
}
