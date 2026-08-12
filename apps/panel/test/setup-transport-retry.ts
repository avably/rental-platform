/**
 * Plik setup vitest panelu (vitest.config.ts → test.setupFiles).
 *
 * Instalacja jest jedna i mieszka przy implementacji, w pakiecie będącym
 * właścicielem bramki lokalnego Supabase. Ten plik istnieje, bo `setupFiles`
 * wskazuje ścieżkę wewnątrz pakietu — a import ze skutkiem ubocznym stawia
 * znacznik załadowania i instaluje retry dokładnie tak samo jak w @avably/db.
 * Całość mechanizmu i granic: packages/db/test/helpers/transport-retry.ts.
 */
import "../../../packages/db/test/setup-transport-retry";
