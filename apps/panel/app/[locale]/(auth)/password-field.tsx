"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { AuthField, AuthInput } from "./auth-ui";

/**
 * Pole nowego hasła z przełącznikiem widoczności (ADR-156).
 *
 * Dotyczy WYŁĄCZNIE haseł USTAWIANYCH (rejestracja, ustawienie nowego hasła),
 * nie logowania: tam pole wypełnia menedżer haseł, a podgląd jest tylko
 * ryzykiem zerknięcia przez ramię. Przy wymyślaniu hasła jest odwrotnie —
 * literówki w polu, którego nie widać, są jedną z częstszych przyczyn
 * „hasło nie działa" nazajutrz.
 *
 * Przełącznik zmienia `type` inputa, więc wartość zostaje w tym samym polu
 * i ta sama nazwa jedzie do akcji serwerowej. `autoComplete="new-password"`
 * zostaje bez zmian — przeglądarka dalej proponuje wygenerowanie hasła.
 */
export function AuthPasswordField({
  id,
  label,
  hint,
  minLength,
}: {
  id: string;
  label: string;
  hint?: string;
  minLength?: number;
}) {
  const t = useTranslations("authShell");
  const [visible, setVisible] = useState(false);

  return (
    <AuthField
      id={id}
      label={label}
      hint={hint}
      aux={
        <button
          type="button"
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="text-foreground focus-visible:outline-accent dark:focus-visible:outline-ring cursor-pointer rounded-sm text-[0.8125rem] underline underline-offset-[3px] outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2"
        >
          {visible ? t("passwordHide") : t("passwordShow")}
        </button>
      }
    >
      <AuthInput
        id={id}
        type={visible ? "text" : "password"}
        name="password"
        required
        minLength={minLength}
        autoComplete="new-password"
      />
    </AuthField>
  );
}
