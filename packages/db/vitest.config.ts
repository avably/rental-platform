import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    // Wąski retry transportowy dla testów integracyjnych na współdzielonym
    // runnerze (czkawki Kong/PostgREST) — patrz test/helpers/transport-retry.ts.
    setupFiles: ["test/setup-transport-retry.ts"],
    // CO JEST MIERZONE: to nie są testy jednostkowe. Pojedynczy przypadek
    // zasiewa tenanta ścieżką produkcyjną — `auth.admin.createUser` (bcrypt
    // po stronie GoTrue), logowanie (drugi bcrypt), RPC `app.create_tenant`,
    // ponowne logowanie po claimie w JWT — czyli kilkanaście rund do bazy,
    // z czego trzy kosztowne CPU-owo. Na wolnym runnerze doszła do tego
    // warstwa retry bramki uwierzytelniania: do 3 odczekań (250/750/1500 ms)
    // plus czas czterech żądań.
    // DLACZEGO TO NIE JEST PRZYKRYCIE OBJAWU: przyczyną losowych czerwieni
    // było 500 od GoTrue przy wyczerpanej puli połączeń — naprawia je retry
    // w transport-retry.ts, nie ten budżet. Budżet ma tylko nie ucinać
    // ponowienia w połowie. Na bezczynnej maszynie te same przypadki chodzą
    // 0,3–1,0 s i vitest nadal raportuje ich czas, więc spowolnienie zostaje
    // widoczne, a nie schowane.
    testTimeout: 20_000,
    // Zasiewy w beforeAll robią to samo dla kilku tenantów naraz.
    hookTimeout: 30_000,
  },
});
