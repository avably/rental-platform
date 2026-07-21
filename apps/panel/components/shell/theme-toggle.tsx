"use client";

import { MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";

import { THEME_COOKIE, THEME_MAX_AGE_SECONDS, type Theme } from "@/lib/theme";

import { NAV_ICON_STROKE_WIDTH } from "./nav-icons";

/**
 * Przełącznik motywu w belce (ADR-059).
 *
 * Motyw mieszka na `<html>` (klasa `dark` + `data-theme`), a nie w stanie
 * Reacta: ustawia go skrypt startowy PRZED hydracją, żeby ciemny nie mrugnął
 * bielą. Dlatego przycisk CZYTA stan zewnętrzny przez `useSyncExternalStore`,
 * zamiast trzymać własną kopię — dwie kopie tej samej prawdy rozjechałyby się
 * i przycisk mówiłby co innego, niż widać na ekranie.
 *
 * Zdarzenie `avably:theme` jest kanałem subskrypcji: dzięki niemu wszystkie
 * przełączniki na stronie (belka panelu, belka superadmina) odświeżają się
 * razem, bez wspólnego providera.
 */

const THEME_EVENT = "avably:theme";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  return () => window.removeEventListener(THEME_EVENT, onChange);
}

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * Podczas renderu serwerowego nie ma `document`. Zwracamy motyw jasny — i to
 * jedyna chwila, w której etykieta może się nie zgadzać z ekranem: skrypt
 * startowy zdąży już nałożyć klasę, ale React pozna ją dopiero przy hydracji.
 */
function readThemeOnServer(): Theme {
  return "light";
}

export function ThemeToggle() {
  const t = useTranslations("nav");
  const theme = useSyncExternalStore(subscribe, readTheme, readThemeOnServer);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.dataset.theme = next;
    root.classList.toggle("dark", next === "dark");
    // `SameSite=Lax` wystarcza: to preferencja wyglądu, nie poświadczenie.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_MAX_AGE_SECONDS}; SameSite=Lax`;
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  const dark = theme === "dark";
  const Icon = dark ? SunIcon : MoonIcon;

  return (
    <button
      type="button"
      onClick={toggle}
      data-theme-toggle
      // Przycisk ikoniczny — etykieta MUSI iść w aria-label (ADR-056 D3).
      // `aria-pressed` mówi, czy tryb ciemny jest WŁĄCZONY; sama zmiana ikony
      // nie jest stanem, który czytnik potrafi ogłosić.
      aria-label={dark ? t("themeToggleToLight") : t("themeToggleToDark")}
      aria-pressed={dark}
      className="border-border text-foreground flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md border outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={NAV_ICON_STROKE_WIDTH} />
    </button>
  );
}
