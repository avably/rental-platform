/**
 * Plik setup vitest (vitest.config.ts → test.setupFiles): instaluje wąski
 * retry transportowy na globalThis.fetch ZANIM załaduje się jakikolwiek plik
 * testowy — supabase-js rozwiązuje fetch leniwie z globalThis, więc to
 * pokrywa wszystkie klienty testowe bez dotykania ich call site'ów.
 * Bez SUPABASE_LOCAL_API_URL to świadomy no-op (przebieg jednostkowy).
 * Całość mechanizmu i granic: test/helpers/transport-retry.ts.
 */
import { installTransportRetry } from "./helpers/transport-retry";

installTransportRetry();
