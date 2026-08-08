"use client";

import { Button } from "@avably/ui";
import { useState } from "react";

/**
 * Dwukrokowe potwierdzenie zamiaru dla operacji NIEODWRACALNYCH (L4, ADR-105):
 * usunięcia członka zespołu, odwołania zaproszenia, anulowania nadanej
 * przesyłki u dostawcy.
 *
 * Pierwsze kliknięcie nie wysyła formularza — podmienia przycisk na pytanie
 * i parę „potwierdź / cofnij". Dopiero drugi przycisk jest `type="submit"`.
 *
 * DLACZEGO NIE `window.confirm`: natywne okno nie przechodzi przez nasz układ
 * ani tłumaczenia, a w części przeglądarek bywa tłumione — operacja kosztowa
 * poszłaby wtedy bez pytania. DLACZEGO NIE MODAL: te przyciski siedzą
 * w wierszach tabel; modal na wiersz to cała warstwa focus-trapu dla jednego
 * zdania, a stan „czy na pewno" i tak musi żyć przy wierszu, bo dotyczy
 * konkretnego wiersza, nie ekranu.
 *
 * Krok potwierdzenia znika po wysłaniu (`pending`), żeby podwójne kliknięcie
 * nie wysłało dwóch żądań.
 */
export function ConfirmSubmit({
  label,
  question,
  confirmLabel,
  cancelLabel,
  marker,
  pending = false,
  disabled = false,
  className,
}: {
  /** Etykieta przycisku uruchamiającego pytanie. */
  label: string;
  /** Pytanie pokazywane przed potwierdzeniem — ma nazywać skutek, nie „na pewno?". */
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Uchwyt dla weryfikacji w przeglądarce (`data-confirm-action`). */
  marker?: string;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking || pending) {
    return (
      <Button
        type="button"
        variant="outline"
        className={className}
        disabled={disabled || pending}
        loading={pending}
        data-confirm-action={marker}
        onClick={() => setAsking(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-muted-foreground text-xs">{question}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          variant="destructive"
          disabled={disabled}
          data-confirm-submit={marker}
        >
          {confirmLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAsking(false)}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
