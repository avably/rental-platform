/**
 * BRAMKA ŚRODOWISKOWA OBEJMUJE TEŻ OŚ TENANCKĄ (ADR-128).
 *
 * DLACZEGO OSOBNY PLIK. `review-api.test.ts` pilnuje endpointu i samej funkcji
 * `isReviewSurfaceEnabled`. To za mało: bramka broni czegoś tylko tam, gdzie
 * jest WOŁANA, a nakładkę montują DWA niezależne root layouty. Oś marketingowa
 * dostała `isReviewSurfaceEnabled()` przy zdejmowaniu Basic Auth, oś tenancka
 * została przy surowym `process.env.REVIEW_MODE === "1"` — czyli akurat ta
 * powierzchnia, którą oglądają KLIENCI najemcy, miała słabszą bramkę niż nasza
 * własna strona. Ten plik przypina tę oś osobno, bo osobno się psuje.
 *
 * DOWÓD JEST NA RENDERZE, NIE NA NAPISIE. Asercje idą na wynik wywołania
 * `TenantLayout` przepuszczony przez `renderToStaticMarkup` — grep po
 * „isReviewSurfaceEnabled" w źródle przeszedłby także wtedy, gdyby wywołanie
 * trafiło w martwe miejsce (lekcja o ślepej plamie regexu plikowego).
 *
 * NAKŁADKA JEST PODSTAWIONA CELOWO. Prawdziwy `ReviewOverlayGate` na serwerze
 * zawsze zwraca `null` (czeka na `?review=1` w `useEffect`), więc po renderze
 * do statycznego HTML-a nie dałoby się odróżnić „layout NIE zamontował bramki"
 * od „bramka zamontowana, ale jeszcze nic nie narysowała". Podstawiony
 * komponent zostawia znacznik i przywraca tę różnicę — a to ona jest przedmiotem
 * sporu: przy REVIEW_MODE wystawionym przez pomyłkę na produkcji bundle
 * nakładki nie ma prawa nawet trafić na stronę.
 *
 * Dowód mutacyjny (raport PR #239): przywrócenie w `(tenant)/layout.tsx`
 * surowego `process.env.REVIEW_MODE === "1"` zapala przypadek produkcyjny.
 */
import type { ReactNode } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Layout ciągnie za sobą zależności, które poza `next build` nie mają prawa
// się wykonać (`next/font/google`) albo wymagają żądania (`headers()`).
// Podstawiamy je, bo przedmiotem testu jest JEDEN warunek w ciele layoutu.
vi.mock("@/app/fonts", () => ({ fontVariables: "font-geist" }));
vi.mock("@/lib/seo/request-origin", () => ({ tenantOrigin: async () => null }));
vi.mock("@/lib/storefront/context", () => ({
  loadStorefrontContext: async () => ({ locale: "pl", supabaseUrl: "https://sklep.supabase.co" }),
}));
vi.mock("@avably/review/overlay", () => ({
  ReviewOverlayGate: ({ surface }: { surface: string }) => <div data-review-overlay={surface} />,
}));

async function renderTenantLayout(): Promise<string> {
  const { default: TenantLayout } = await import("../app/(tenant)/layout");
  const tree = (await TenantLayout({ children: <main id="tresc" /> })) as ReactNode;
  return renderToStaticMarkup(tree);
}

describe("nakładka przeglądu w layoucie osi tenanckiej", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("VERCEL_ENV=production przy REVIEW_MODE=1 → sklep najemcy BEZ nakładki", async () => {
    vi.stubEnv("REVIEW_MODE", "1");
    vi.stubEnv("VERCEL_ENV", "production");

    const markup = await renderTenantLayout();

    expect(
      markup,
      "produkcyjny sklep najemcy nie może dostać bramki nakładki — po ADR-128 nie ma już hasła site'u, które by ją przykryło",
    ).not.toContain("data-review-overlay");
    // Kontrola pozytywna: layout NAPRAWDĘ się wyrenderował, więc brak
    // nakładki jest decyzją bramki, a nie pustym wynikiem renderu.
    expect(markup).toContain('id="tresc"');
  });

  it.each(["preview", "development", ""])(
    "VERCEL_ENV=%j przy REVIEW_MODE=1 → nakładka zamontowana (podgląd i lokalne uruchomienia)",
    async (env) => {
      vi.stubEnv("REVIEW_MODE", "1");
      vi.stubEnv("VERCEL_ENV", env);

      expect(await renderTenantLayout()).toContain('data-review-overlay="storefront"');
    },
  );

  it("brak VERCEL_ENV (lokalnie/e2e) przy REVIEW_MODE=1 → nakładka zamontowana", async () => {
    vi.stubEnv("REVIEW_MODE", "1");
    vi.stubEnv("VERCEL_ENV", undefined);

    expect(await renderTenantLayout()).toContain('data-review-overlay="storefront"');
  });

  it.each([undefined, "", "0", "true", "1 "])(
    "REVIEW_MODE=%j poza produkcją i tak nie montuje nakładki (fail-closed na kształcie flagi)",
    async (flaga) => {
      vi.stubEnv("REVIEW_MODE", flaga);
      vi.stubEnv("VERCEL_ENV", "development");

      expect(await renderTenantLayout()).not.toContain("data-review-overlay");
    },
  );
});
