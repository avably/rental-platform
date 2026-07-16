"use client";

import { useState } from "react";

interface ThemeToggleProps {
  darkLabel: string;
  lightLabel: string;
}

export function ThemeToggle({ darkLabel, lightLabel }: ThemeToggleProps) {
  const [dark, setDark] = useState(false);

  function toggleTheme() {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    window.localStorage.setItem("avably-theme", nextDark ? "dark" : "light");
  }

  return (
    <button
      aria-label={dark ? lightLabel : darkLabel}
      aria-pressed={dark}
      className="landing-ghost-pill min-h-10 px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
      onClick={toggleTheme}
      type="button"
    >
      {dark ? lightLabel : darkLabel}
    </button>
  );
}
