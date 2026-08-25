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
import { useEffect, useRef, useState } from "react";

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

/**
 * CZY WIDGET COKOLWIEK POKAZUJE (S-33, audyt UX 2026-08-25).
 *
 * Widget w trybie niewidzialnym / interaction-only wstawia ramkę, którą sam
 * chowa INLINE'OWYM stylem (`display:none` / `visibility:hidden`) albo zerowym
 * rozmiarem — a jej pudełko i tak rezerwowało ~72 px między polem wiadomości
 * a przyciskiem, więc formularz wyglądał na rozerwany. Czytamy WYŁĄCZNIE
 * inline'owe deklaracje dostawcy (styl i atrybuty ramki oraz jej owijek do
 * kontenera włącznie), bo te nie zależą od tego, że NASZ kontener jest akurat
 * schowany — `offsetHeight` mierzony pod `display:none` kłamałby zawsze zero
 * i kontener nie miałby jak się odsłonić.
 */
function turnstileShowsContent(container: HTMLElement): boolean {
  for (const frame of container.querySelectorAll("iframe")) {
    const width = frame.getAttribute("width");
    const height = frame.getAttribute("height");
    if (width !== null && Number(width) === 0) continue;
    if (height !== null && Number(height) === 0) continue;
    let hidden = false;
    for (let node: HTMLElement | null = frame; node && node !== container; node = node.parentElement) {
      if (node.style.display === "none" || node.style.visibility === "hidden") {
        hidden = true;
        break;
      }
    }
    if (!hidden) return true;
  }
  return false;
}

export function TurnstileWidget({ siteKey, locale, onToken, size = "normal" }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref zamiast zależności efektu renderującego: zmiana handlera nie ma prawa
  // przeładować widgetu (remount = nowe wyzwanie dla użytkownika).
  const onTokenRef = useRef(onToken);
  /*
   * KONTENER NIE REZERWUJE MIEJSCA, dopóki dostawca czegoś nie pokaże (S-33):
   * start w `hidden`, odsłona dopiero gdy w środku stoi ramka bez inline'owego
   * ukrycia. Obserwator mutacji łapie i wstawienie ramki, i późniejszą zmianę
   * jej stylu (interaction-only pokazuje wyzwanie dopiero, gdy musi) — więc
   * wyzwanie interaktywne dostaje swoje miejsce w chwili, w której realnie
   * powstaje, a tryb niewidzialny nie zostawia dziury. Powierzchnie, które
   * CHCĄ rezerwy pod widget widoczny (checkout), trzymają ją na SWOIM slocie
   * (`min-h` na `data-checkout-captcha`) — to decyzja miejsca, nie widgetu.
   */
  const [showsContent, setShowsContent] = useState(false);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setShowsContent(turnstileShowsContent(container));
    const observer = new MutationObserver(update);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "width", "height", "hidden"],
    });
    update();
    return () => observer.disconnect();
  }, []);

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

  return <div ref={containerRef} data-turnstile-container hidden={!showsContent} />;
}
