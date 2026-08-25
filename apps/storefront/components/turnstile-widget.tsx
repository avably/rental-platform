"use client";

/**
 * Cloudflare Turnstile — goły skrypt api.js z jawnym renderem, bez
 * zewnętrznych bibliotek (ADR-032).
 *
 * Skrypt jest wstrzykiwany przez createElement z klienckiego chunka: pod
 * 'strict-dynamic' (CSP storefrontu, packages/security) skrypty tworzone
 * przez zaufany kod są zaufane przechodnio, więc tag nie potrzebuje nonce'a.
 * Host challenges.cloudflare.com w script-src to fallback dla przeglądarek
 * CSP2 — dyrektywa wchodzi tylko przy skonfigurowanym site key.
 */
import { useEffect, useRef } from "react";

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      language: string;
      size?: "normal" | "compact";
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
  /**
   * Rozmiar widgetu dostawcy (F8): `normal` = 300×65 (stała szerokość ramki),
   * `compact` = 150×140 dla slotów WĘŻSZYCH niż 300 px (telefony — karta
   * podsumowania checkoutu przy kontenerze 300 px ma ~258 px treści).
   * Domyślnie `normal`, więc dotychczasowi użytkownicy (formularz kontaktowy)
   * nie zmieniają zachowania.
   */
  size?: "normal" | "compact";
}

export function TurnstileWidget({ siteKey, locale, onToken, size = "normal" }: TurnstileWidgetProps) {
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
        size,
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, locale, size]);

  return <div ref={containerRef} />;
}
