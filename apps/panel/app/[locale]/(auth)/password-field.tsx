"use client";

import { cn } from "@avably/ui";
import { Circle, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

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

/**
 * Checklist wymagań hasła (A20, ADR-226) — odbicie 1:1 `passwordSchema`
 * (lib/validation.ts, ADR-208): min 8 znaków, ≥1 cyfra, ≥1 znak spoza
 * [A-Za-z0-9]. Progi/wzorce trzymane TUTAJ lokalnie, bo lista żyje w
 * komponencie klienckim, a `passwordSchema` nie eksportuje ich jako stałych —
 * import całego schematu wciągnąłby zod do bundla klienta. To NIE jest bramka
 * (źródłem prawdy jest walidacja serwerowa w akcjach, ominięcie niczego nie
 * otwiera); rozjazd z `passwordSchema` jest błędem: zmieniasz tam — zmień tu.
 * Te same trzy warunki koduje `PASSWORD_POLICY_PATTERN` powyżej.
 */
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_DIGIT = /[0-9]/;
const PASSWORD_SPECIAL = /[^A-Za-z0-9]/;

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
  const [value, setValue] = useState("");
  const reqListId = useId();

  const requirements = [
    { key: "length", met: value.length >= PASSWORD_MIN_LENGTH },
    { key: "digit", met: PASSWORD_DIGIT.test(value) },
    { key: "special", met: PASSWORD_SPECIAL.test(value) },
  ] as const;

  return (
    <AuthField
      id={id}
      label={label}
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
        aria-describedby={reqListId}
        onChange={(event) => setValue(event.target.value)}
      />
      {/*
        Dynamiczny checklist zastępuje statyczny `hint` (dlatego `hint` NIE
        idzie już do <AuthField>): pokazuje te same trzy wymagania, ale
        odhacza je w trakcie pisania. Bez JS (brak hydracji) lista renderuje
        się z pustego pola — czyli wszystkie trzy jako „niespełnione" — więc
        wymagania są widoczne tak samo, a natywny `pattern`+`title` dalej
        pilnują wysyłki. `aria-live="polite"` + zmienny tekst stanu
        (sr-only met/unmet) sprawiają, że czytnik słyszy odhaczenie.
      */}
      <ul id={reqListId} aria-live="polite" className="mt-0.5 flex flex-col gap-1">
        {requirements.map((requirement) => (
          <li
            key={requirement.key}
            className={cn(
              "flex items-center gap-1.5 text-[0.8125rem] leading-[18px]",
              requirement.met ? "text-status-positive-fg" : "text-muted-foreground",
            )}
          >
            {requirement.met ? (
              <CircleCheck aria-hidden="true" className="size-3.5 shrink-0" />
            ) : (
              <Circle aria-hidden="true" className="size-3.5 shrink-0" />
            )}
            <span>{t(`passwordReq.${requirement.key}`)}</span>
            <span className="sr-only">
              {requirement.met ? t("passwordReq.met") : t("passwordReq.unmet")}
            </span>
          </li>
        ))}
      </ul>
    </AuthField>
  );
}
