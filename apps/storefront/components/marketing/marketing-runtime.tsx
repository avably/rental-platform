"use client";

import { useEffect } from "react";

interface MarketingRuntimeProps {
  /** Identyfikator strony z eksportu — IX2 filtruje po nim interakcje. */
  wfPage: string;
  wfSite: string;
}

const SCRIPTS = ["/forerunner/js/jquery.min.js", "/forerunner/js/webflow.js"] as const;

function loadScript(src: string): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-forerunner="${src}"]`);
  if (existing) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.forerunner = src;
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error(`Nie wczytano ${src}`)));
    document.body.appendChild(script);
  });
}

/**
 * Uruchomienie biblioteki szablonu (ADR-068).
 *
 * Skrypty wstawiamy z klienta, po kolei, zamiast deklarować je w dokumencie:
 *   1. KOLEJNOŚĆ — `webflow.js` wymaga `window.jQuery` w chwili wykonania,
 *      a `next/script` nie gwarantuje sekwencji między wpisami.
 *   2. CSP — polityka ma `'strict-dynamic'`, więc skrypt wstrzyknięty przez
 *      zaufany (nonce'owany) chunk Next.js jest zaufany przechodnio. Ten sam
 *      wzorzec, co ładowanie bibliotek Turnstile i dostawcy płatności.
 *   3. `data-wf-page` — IX2 porównuje atrybut `<html>` z identyfikatorem strony
 *      i MILCZĄCO pomija animacje przy niezgodności; `<html>` żyje we wspólnym
 *      layoucie, więc atrybut per trasa da się ustawić tylko stąd.
 *
 * `webflow.js` jest bundlem webpacka i NIE nadaje się na import modułowy —
 * Turbopack rozpoznaje w nim własne `__webpack_require__` i przerywa build.
 */
export function MarketingRuntime({ wfPage, wfSite }: MarketingRuntimeProps) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-wf-page", wfPage);
    root.setAttribute("data-wf-site", wfSite);
    // Klasy, które w eksporcie ustawia skrypt inline w <head>.
    root.classList.add("w-mod-js");
    if ("ontouchstart" in window) root.classList.add("w-mod-touch");

    let cancelled = false;
    void (async () => {
      for (const src of SCRIPTS) {
        if (cancelled) return;
        await loadScript(src);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wfPage, wfSite]);

  return null;
}
