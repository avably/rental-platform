import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Render @react-pdf + parsowanie unpdf są CPU-ciężkie, a CI biegnie na
    // współdzielonym self-hosted runnerze mac-pm (jeden Mac dzielony z inną
    // pracą) — pod kontencją domyślne 5000 ms per test okazało się za ciasne
    // (flake contract-template 2026-08-11; ta sama klasa co znany timeout
    // deposit-online przy pełnym równoległym turbo: kontencja, nie regres).
    // 20 s nie maskuje realnego zawieszenia, a zdejmuje czkawkę obciążeniową.
    testTimeout: 20_000,
  },
});
