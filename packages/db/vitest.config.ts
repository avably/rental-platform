import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    // Wąski retry transportowy dla testów integracyjnych na współdzielonym
    // runnerze (czkawki Kong/PostgREST) — patrz test/helpers/transport-retry.ts.
    setupFiles: ["test/setup-transport-retry.ts"],
  },
});
