"use client";

/**
 * SPIKE C0 — wariant A: edytor Puck osadzony w naszej trasie.
 *
 * `<Puck>` maluje CAŁY własny UI (header z „Publish", lista komponentów po
 * lewej, canvas w środku, pola po prawej). To jest dowód wprost pod kryterium 2:
 * chrome edytora jest Pucka, nie naszego design systemu — tokenami dosyłamy co
 * najwyżej akcenty przez zmienne `--puck-*`, ale struktura i zachowania są obce.
 *
 * `iframe={{ enabled: false }}`: domyślnie Puck renderuje canvas w iframzie,
 * co pod naszym CSP (nonce + strict-dynamic, brak frame-src) jest ryzykowne —
 * wyłączamy, żeby prototyp działał; skutki włączenia opisuje raport (kryt. 7).
 */
import { Puck, type Data } from "@puckeditor/core";
import "@puckeditor/core/puck.css";
import { useEffect, useMemo, useState } from "react";

import { defaultHeroContent } from "../spike-hero-schema";
import { puckConfig } from "./puck-config";
import { heroToPuckData, puckDataToHero } from "./puck-data";

export function PuckEditor() {
  const initial = useMemo<Data>(() => heroToPuckData(defaultHeroContent()), []);
  const [data, setData] = useState<Data>(initial);
  // Ciężki edytor montujemy dopiero po hydracji — Puck sięga do window/DOM,
  // a SSR pełnego edytora nic nie daje (i tak jest interaktywny tylko na kliencie).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // kryt.1 — na żywo: co Puck trzyma vs co my zapiszemy do content_draft.
  const extract = puckDataToHero(data);

  return (
    <div className="flex flex-col gap-6">
      <div
        className="border-border h-[70vh] min-h-[560px] overflow-hidden rounded-lg border"
        data-spike-preview="puck"
      >
        {mounted ? (
          <Puck
            config={puckConfig}
            data={data}
            onChange={setData}
            iframe={{ enabled: false }}
          />
        ) : (
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            Ładowanie edytora Puck…
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border-border flex flex-col gap-2 rounded-lg border p-4">
          <h2 className="text-sm font-semibold">Puck.Data (format edytora)</h2>
          <p className="text-muted-foreground text-xs">
            Envelope <code>{"{ root, content:[{type,props}], zones }"}</code> — NIE nasz kształt.
          </p>
          <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs leading-relaxed">
            {JSON.stringify(data, null, 2)}
          </pre>
        </section>

        <section className="border-border flex flex-col gap-2 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">content_draft (po adapterze)</h2>
            <span
              data-zod-status
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                extract.ok
                  ? "bg-status-positive-bg text-status-positive-fg"
                  : "bg-destructive/15 text-destructive"
              }`}
            >
              {extract.ok ? "Zod: valid" : "Zod: invalid"}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">Wynik <code>puckDataToHero(data)</code> — to trafia do bazy.</p>
          <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs leading-relaxed">
            {extract.ok ? JSON.stringify(extract.value, null, 2) : extract.error}
          </pre>
        </section>
      </div>
    </div>
  );
}
