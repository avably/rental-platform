/**
 * Preload procesu serwera Next (NODE_OPTIONS=--import …): przekierowuje
 * wywołania `https://api.stripe.com` na lokalny stub.
 *
 * Dlaczego preload, a nie konfiguracja: baza API dostawcy jest w kodzie
 * produktu STAŁĄ (`STRIPE_API_BASE`, packages/core/src/stripe/api.ts) —
 * celowo bez env, żeby produkcja nie miała przełącznika „udawaj dostawcę".
 * E2E nie dotyka kodu produktu; podmienia `globalThis.fetch` w procesie
 * testowego serwera, wyłącznie gdy E2E_STRIPE_STUB_PORT jest ustawione.
 * Wszystko poza hostem dostawcy przechodzi nietknięte.
 */
const stubPort = process.env.E2E_STRIPE_STUB_PORT;

if (stubPort) {
  const realFetch = globalThis.fetch.bind(globalThis);
  const STRIPE_BASE = "https://api.stripe.com";
  const STUB_BASE = `http://127.0.0.1:${stubPort}`;

  globalThis.fetch = function e2eStripeRedirectFetch(input, init) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : typeof input?.url === "string"
            ? input.url
            : null;

    if (url && url.startsWith(STRIPE_BASE)) {
      const target = `${STUB_BASE}${url.slice(STRIPE_BASE.length)}`;
      if (typeof input === "object" && !(input instanceof URL) && typeof input?.url === "string") {
        return realFetch(new Request(target, input), init);
      }
      return realFetch(target, init);
    }
    return realFetch(input, init);
  };
}
