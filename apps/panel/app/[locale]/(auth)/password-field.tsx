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

/**
 * Odbicie polityki hasła z `passwordSchema` (lib/validation.ts, ADR-208) w
 * atrybucie `pattern`: min 8 znaków, ≥1 cyfra, ≥1 znak spoza [A-Za-z0-9].
 * To jest UX (przeglądarka odmawia wysyłki i mówi dlaczego), NIE bramka —
 * źródłem prawdy jest walidacja serwerowa w akcjach; ominięcie atrybutu
 * jednym curlem niczego nie otwiera.
 */
const PASSWORD_POLICY_PATTERN = "(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}";
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
        pattern={PASSWORD_POLICY_PATTERN}
        // Tekst, który przeglądarka dokleja do odmowy `pattern` — bez niego
        // komunikat brzmi „dopasuj żądany format" i nie mówi jaki.
        title={hint}
        autoComplete="new-password"
      />
    </AuthField>
  );
}
