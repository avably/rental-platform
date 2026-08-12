import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    // Wąski retry transportowy dla testów integracyjnych na współdzielonym
    // runnerze (czkawki Kong/PostgREST). Mechanizm jest JEDEN dla wszystkich
    // suit i mieszka w packages/db/test/helpers/transport-retry.ts; plik niżej
    // tylko go tutaj wpina.
    setupFiles: ["test/setup-transport-retry.ts"],
    // CO JEST MIERZONE — w panelu DWIE różne przyczyny, nie jedna:
    //
    // (1) ZASIEW PRZEZ GoTrue. Suita zasiewa użytkowników
    //     (`auth.admin.createUser` w 20 plikach) na tej samej żywej bazie, co
    //     suita @avably/db — job `rls` uruchamia OBIE. Pojedynczy przypadek to
    //     kilka rund do bazy plus bcrypty po stronie GoTrue, a od tej zmiany
    //     także warstwa retry bramki uwierzytelniania: do 3 odczekań
    //     (250/750/1500 ms) plus czas czterech żądań.
    //
    // (2) GŁODZENIE PROCESORA — przyczyna NIEZALEŻNA od sieci. Panel ma
    //     ~2300 testów, w tym renderujące w jsdom; na współdzielonym runnerze
    //     (CI, WordPressy dev i suity innych sesji naraz) samo przełączanie
    //     kontekstu wypycha przypadek ponad 5 s bez ANI JEDNEGO żądania.
    //     Dowód: `test/customer-ban-toggle.test.tsx` — czysty test komponentu
    //     w jsdom, bez sieci i bez GoTrue — padał w CI na
    //     „Test timed out in 5000ms". Retry takiego przypadku nie dotyka i
    //     nie ma prawa dotknąć; jego jedynym lekarstwem jest budżet czasu.
    //
    // DLACZEGO TO NIE JEST PRZYKRYCIE OBJAWU: przyczynę (1) naprawia retry
    // (packages/db/test/helpers/transport-retry.ts), nie ten budżet — budżet
    // ma tylko nie ucinać ponowienia w połowie. Przyczyna (2) to realny koszt
    // zasobowy współdzielonego runnera, a nie usterka w kodzie: domyślne 5 s
    // mierzyło dostępność procesora, nie zachowanie panelu. Czasy vitest
    // nadal raportuje, więc spowolnienie zostaje widoczne, a nie schowane.
    // Wartości trzymane RÓWNO z packages/db/vitest.config.ts.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    server: {
      deps: {
        // next-intl importuje `next/server` bez rozszerzenia, a `next` nie ma
        // mapy `exports` — natywne ESM Node'a takiego importu nie rozwiąże
        // i test middleware'u wywala się przy imporcie. Inline oddaje
        // rozwiązywanie resolverowi Vite, który ten zapis obsługuje.
        // (Ten sam zabieg co w apps/storefront/vitest.config.ts.)
        inline: ["next-intl"],
      },
    },
  },
  resolve: {
    alias: {
      // `server-only` rzuca przy imporcie poza serwerem Reacta; moduły serwerowe
      // kreatora (klient wyszukiwarki zdjęć) testujemy wprost w Node.
      "server-only": path.resolve(__dirname, "test/helpers/server-only-stub.ts"),
      // PRZED aliasem korzenia: dopasowanie jest prefiksowe i w kolejności
      // wpisów, więc "@avably/security" złapałby też subpath i przepisał go
      // na `index.ts/rate-limit`.
      "@avably/security/rate-limit": path.resolve(
        __dirname,
        "../../packages/security/src/rate-limit.ts",
      ),
      "@avably/security/turnstile": path.resolve(
        __dirname,
        "../../packages/security/src/turnstile.ts",
      ),
      "@avably/security/client-ip": path.resolve(
        __dirname,
        "../../packages/security/src/client-ip.ts",
      ),
      "@avably/security": path.resolve(__dirname, "../../packages/security/src/index.ts"),
      "@avably/core/site": path.resolve(__dirname, "../../packages/core/src/site/index.ts"),
      "@avably/core/supabase-env": path.resolve(
        __dirname,
        "../../packages/core/src/supabase-env.ts",
      ),
      "@avably/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      // Odwzorowanie `paths` z tsconfig.json — vitest nie czyta go sam.
      "@": path.resolve(__dirname, "."),
    },
  },
});
