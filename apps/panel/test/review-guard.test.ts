/**
 * Bramka endpointów przeglądu w panelu (ADR-071): REVIEW_MODE wyłączony →
 * 404 ZANIM bramka dotknie sesji/cookies (kill-switch działa także tam,
 * gdzie nie ma kontekstu żądania). Ścieżka superadmina jest kryta
 * integracyjnie w RLS (packages/db/test/review-comments.test.ts) i w
 * weryfikacji przeglądarkowej — tu przybijamy sam wyłącznik.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reviewGuard } from "../lib/review-guard";

describe("reviewGuard — kill-switch REVIEW_MODE", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["", "0", "off"])("REVIEW_MODE=%s → 404 bez dotykania sesji", async (value) => {
    vi.stubEnv("REVIEW_MODE", value);
    const result = await reviewGuard();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  });

  it("REVIEW_MODE=1 bez kontekstu żądania — fail-closed (404 albo wyjątek, nigdy kontekst)", async () => {
    vi.stubEnv("REVIEW_MODE", "1");
    try {
      const result = await reviewGuard();
      // Poza żądaniem Next brak sesji → AuthError → 404. Kontekst superadmina
      // nie ma prawa tu powstać.
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(404);
    } catch {
      // Wyjątek środowiskowy (`cookies()` poza żądaniem) też jest fail-closed.
    }
  });
});
