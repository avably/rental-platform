"use client";

/**
 * Cloudflare Turnstile — goły skrypt api.js z jawnym renderem, bez
 * zewnętrznych bibliotek (ADR-032; podpięcie w panelu: L2/ADR-106).
 *
 * LUSTRO apps/storefront/components/turnstile-widget.tsx — komponent
 * kliencki nie może żyć w @avably/security (pakiet bez Reacta), a wspólnego
 * pakietu UI między apkami nie ma; zmiany wprowadzać w OBU kopiach.
 *
 * Skrypt jest wstrzykiwany przez createElement z klienckiego chunka: pod
 * 'strict-dynamic' (CSP panelu, packages/security) skrypty tworzone przez
 * zaufany kod są zaufane przechodnio, więc tag nie potrzebuje nonce'a.
 * Host challenges.cloudflare.com w script-src to fallback dla przeglądarek
 * CSP2 — dyrektywa wchodzi tylko przy skonfigurowanym site key (proxy.ts).
 */
import { useEffect, useRef } from "react";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      language: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    avablyTurnstileOnload?: () => void;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=avablyTurnstileOnload";

// Loader-singleton: wiele instancji widgetu (albo remount po odmowie) dzieli
// jedno pobranie skryptu — drugi tag <script> byłby błędem api.js.
let loader: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loader ??= new Promise((resolve) => {
    window.avablyTurnstileOnload = resolve;
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  });
  return loader;
}

export interface TurnstileWidgetProps {
  siteKey: string;
  locale: "en" | "pl";
  /** Token po rozwiązaniu; null gdy wygasł albo błąd — formularz czyści stan. */
  onToken: (token: string | null) => void;
}

export function TurnstileWidget({ siteKey, locale, onToken }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref zamiast zależności efektu renderującego: zmiana handlera nie ma prawa
  // przeładować widgetu (remount = nowe wyzwanie dla użytkownika).
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;

    void loadTurnstile().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        language: locale,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, locale]);

  return <div ref={containerRef} />;
}
