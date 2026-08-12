/**
 * Plik setup vitest (vitest.config.ts → test.setupFiles): instaluje wąski
 * retry transportowy na globalThis.fetch ZANIM załaduje się jakikolwiek plik
 * testowy — supabase-js rozwiązuje fetch leniwie z globalThis, więc to
 * pokrywa wszystkie klienty testowe bez dotykania ich call site'ów.
 * Bez SUPABASE_LOCAL_API_URL to świadomy no-op (przebieg jednostkowy).
 * Całość mechanizmu i granic: test/helpers/transport-retry.ts.
 */
import { installTransportRetry } from "./helpers/transport-retry";

// Znacznik ZAŁADOWANIA pliku (nie instalacji retry). Bez lokalnego Supabase
// instalacja jest świadomym no-opem i nie zostawia po sobie śladu — asercja
// na znaczniku instalacji nie broni wtedy NICZEGO. Ten znacznik powstaje
// zawsze, więc test przypinający wpis `test.setupFiles` działa w KAŻDYM
// trybie przebiegu. Plik obecny w pakiecie, ale niewpięty w konfigurację, to
// dokładnie ta cicha awaria, którą chcemy łapać.
(globalThis as unknown as Record<symbol, boolean>)[
  Symbol.for("avably.testTransportRetrySetupLoaded")
] = true;

installTransportRetry();
