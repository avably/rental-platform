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
      // PRZED aliasem korzenia: dopasowanie jest prefiksowe i w kolejności
      // wpisów, więc "@avably/security" złapałby też subpath i przepisał go
      // na `index.ts/rate-limit`.
      // `server-only` rzuca przy imporcie poza serwerem Reacta; w testach
      // rdzeń renderujący strony marketingowe uruchamiamy wprost w Node.
      "server-only": path.resolve(__dirname, "test/helpers/server-only-stub.ts"),
      "@avably/security/rate-limit": path.resolve(
        __dirname,
        "../../packages/security/src/rate-limit.ts",
      ),
      "@avably/security/turnstile": path.resolve(
        __dirname,
        "../../packages/security/src/turnstile.ts",
      ),
      "@avably/security": path.resolve(__dirname, "../../packages/security/src/index.ts"),
      "@avably/core/site": path.resolve(__dirname, "../../packages/core/src/site/index.ts"),
      "@avably/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      // Odwzorowanie `paths` z tsconfig.json — vitest nie czyta go sam.
      "@": path.resolve(__dirname),
    },
  },
});
