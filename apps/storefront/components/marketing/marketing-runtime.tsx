"use client";

import { useEffect } from "react";

interface WebflowApi {
  destroy: () => void;
  ready: () => void;
  require: (module: string) => { init?: (data?: unknown) => void } | undefined;
}

interface MarketingRuntimeProps {
  /** Identyfikator strony z eksportu — IX2 filtruje po nim interakcje. */
  wfPage: string;
  wfSite: string;
}

/**
 * Spięcie biblioteki szablonu z cyklem życia Reacta (ADR-068).
 *
 * Same skrypty (jQuery → webflow.js) ładuje layout z `defer`, czyli przed
 * `DOMContentLoaded` — tak jak w eksporcie. Ten komponent domyka dwie rzeczy,
 * których statyczny tag nie załatwia:
 *
 *   1. `data-wf-page` na `<html>`. IX2 porównuje ten atrybut z identyfikatorem
 *      strony w definicji interakcji i przy niezgodności MILCZĄCO ich nie
 *      uruchamia — a elementy eksportu startują z inline `opacity:0`, więc
 *      efektem jest pusta strona. Atrybutu nie da się wstawić statycznie, bo
 *      `<html>` należy do wspólnego layoutu, a hydratacja i tak czyści to, co
 *      dopisał skrypt inline.
 *   2. Ponowna inicjalizacja IX2 po hydratacji i po każdej nawigacji klienckiej
 *      — zdarzenie „wczytanie strony” zdążyło już minąć.
 */
export function MarketingRuntime({ wfPage, wfSite }: MarketingRuntimeProps) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-wf-page", wfPage);
    root.setAttribute("data-wf-site", wfSite);
    root.classList.add("w-mod-js");

    // Nawigacja kliencka nie przeładowuje dokumentu, więc interakcje trzeba
    // uruchomić ponownie — ale TYLKO wtedy, bo przy pierwszym wejściu zrobił
    // to już webflow.js i powtórka zresetowałaby trwające animacje.
    const first = root.dataset.wfBooted === undefined;
    root.dataset.wfBooted = "1";
    if (first) return;

    const webflow = (window as unknown as { Webflow?: WebflowApi }).Webflow;
    if (!webflow?.require) return;
    webflow.destroy();
    webflow.ready();
    webflow.require("ix2")?.init?.();
  }, [wfPage, wfSite]);

  return null;
}
