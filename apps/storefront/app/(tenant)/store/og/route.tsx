/**
 * Obrazek Open Graph per TENANT (Zadanie 2.7, ADR-044) — `/store/og`.
 *
 * DLACZEGO ROUTE HANDLER, A NIE KONWENCJA PLIKOWA `opengraph-image`. Próbowano
 * obu. Konwencja plikowa generuje poprawny PNG, ale adres składa Next i rozwija
 * go względem `metadataBase`, którego nie udało się dosięgnąć z osi tenanckiej:
 * wynikowy `og:image` wskazywał HOST NASŁUCHU (`localhost:3033`) zamiast
 * subdomeny sklepu — a miniatura na cudzym origin jest bezużyteczna dla
 * podglądu linku. Własna trasa daje adres STABILNY i budowany przez nas z
 * hosta żądania (`openGraph.images` w lib/seo/tenant-metadata.ts), więc problem
 * znika u źródła. Przy okazji odpada hash w URL-u, który utrudniał weryfikację.
 *
 * Ścieżka `/store/og` (a nie `/og`) jest celowa: pojedynczy segment na korzeniu
 * kolidowałby z dynamicznym `[locale]` osi marketingowej i wpadał w jej 404
 * (sprawdzone). Brak kropki w ścieżce sprawia z kolei, że trasa PRZECHODZI
 * przez middleware, więc dostaje wstrzyknięty `x-tenant-id` i czyta tenanta tym
 * samym kontekstem co strony — bez własnego rozwiązywania hosta.
 *
 * CSP NIE JEST TU PROBLEMEM (rozważane w briefie): trasa oddaje gotowy PNG,
 * czyli zasób obrazu, nie dokument ze skryptami. `next/og` renderuje go
 * serwerowo (satori → PNG); do przeglądarki nie trafia ani jeden skrypt, więc
 * `script-src` z nonce tej ścieżki w ogóle nie dotyczy.
 *
 * TYPOGRAFIA: świadomie bez własnego fontu. `next/og` ma krój wbudowany;
 * dociąganie kroju marki z sieci przy każdym renderze dokładałoby zależność
 * sieciową do ścieżki, która ma być tania i niezawodna. Miniatura ma nieść
 * NAZWĘ SKLEPU, nie odwzorowywać design system co do kroju.
 */
import { ImageResponse } from "next/og";

import { loadStorefrontContext } from "@/lib/storefront/context";

export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };

export async function GET(): Promise<Response> {
  const ctx = await loadStorefrontContext();

  // Brak kontekstu = wejście spoza gałęzi tenanckiej. Neutralne 404 — ta trasa
  // nie jest miejscem na ujawnianie, czy tenant istnieje (ADR-039).
  if (!ctx) {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#0b0b0c",
          color: "#fafafa",
        }}
      >
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>
          {ctx.catalog.tenant.name}
        </div>
      </div>
    ),
    SIZE,
  );
}
