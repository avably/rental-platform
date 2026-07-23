"use client";

/**
 * Bramka montażu nakładki przeglądu (ADR-071).
 *
 * Serwer renderuje ten komponent WYŁĄCZNIE przy REVIEW_MODE=1 (layouty obu
 * powierzchni sprawdzają env po swojej stronie) — bramka domyka drugi
 * warunek: `?review=1` w URL. Bez niego nie powstaje ŻADEN DOM ani nie
 * ładuje się bundle nakładki (import dynamiczny rusza dopiero po spełnieniu
 * warunku), więc zwykłe wejście na stronę niczego nie dokleja.
 */
import { lazy, Suspense, useEffect, useState } from "react";

import type { ReviewSurface } from "../schema";

const LazyOverlay = lazy(() =>
  import("./review-overlay").then((module) => ({ default: module.ReviewOverlay })),
);

export function ReviewOverlayGate({
  surface,
  apiBase = "/api/review",
}: {
  surface: ReviewSurface;
  apiBase?: string;
}) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("review") === "1") {
      setEnabled(true);
    }
  }, []);

  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <LazyOverlay surface={surface} apiBase={apiBase} />
    </Suspense>
  );
}
