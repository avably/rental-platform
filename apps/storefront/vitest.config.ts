import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    server: {
      deps: {
        // next-intl importuje `next/server` bez rozszerzenia, a `next` nie ma
        // mapy `exports` — natywne ESM Node'a takiego importu nie rozwiąże
        // i test middleware'u wywala się przy imporcie. Inline oddaje
        // rozwiązywanie resolverowi Vite, który ten zapis obsługuje.
        inline: ["next-intl"],
      },
    },
  },
  resolve: {
    alias: {
      "@avably/security": path.resolve(__dirname, "../../packages/security/src/index.ts"),
      "@avably/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      // Odwzorowanie `paths` z tsconfig.json — vitest nie czyta go sam.
      "@": path.resolve(__dirname),
    },
  },
});
