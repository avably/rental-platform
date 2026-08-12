"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from "@avably/ui";
import * as React from "react";

export type PanelSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

const EMPTY_VALUE = "__panel_empty__";

/**
 * Adapter systemowego Selecta dla formularzy panelu.
 *
 * WIDOCZNA kontrolka to wyłącznie prymitywy `@avably/ui` (ADR-060). Natywny
 * `<select>` niżej nie jest kontrolką — to MOST do `FormData`, schowany przed
 * wzrokiem (`sr-only`), przed czytnikiem (`aria-hidden`) i przed tabulatorem
 * (`tabIndex={-1}`).
 *
 * DLACZEGO WŁASNY MOST, A NIE WBUDOWANY BRIDGE RADIKSA (ADR-148). Radix
 * zbiera `<option>` dopiero w efekcie układu `SelectItemText`, a treść opcji
 * czyta z `textContent` zamontowanego węzła; `SelectContent` żyje przy tym
 * w portalu. W SSR nie zdarza się ani jedno, ani drugie, więc most Radiksa
 * wychodzi z serwera PUSTY: `<select name="…"></select>`, zero `<option>`,
 * zero wartości. Formularz wysłany przed hydracją niósł wtedy nic, walidacja
 * odbijała go komunikatem o nieprawidłowej wartości, a operator nie miał jak
 * się domyślić dlaczego. Nasz most zna opcje z propsa, więc niesie wybraną
 * wartość już w pierwszym renderze na serwerze.
 *
 * Most niesie WYŁĄCZNIE wartość obecną na liście opcji. Wartość spoza listy
 * schodzi do pustej — przez most nie da się podać serwerowi danych, których
 * operator nie miał do wyboru. Radix ma ten warunek z konstrukcji (`<option>`
 * to jedyne, co `<select>` umie wysłać); u nas jest jawny, bo to my budujemy
 * listę opcji mostu.
 *
 * Sentinel pustej wartości (`__panel_empty__`) żyje wyłącznie w widżecie —
 * Radix nie dopuszcza pustego `SelectItem`. Most zna tylko wartości prawdziwe,
 * więc opcja „wszystkie” jedzie do formularza jako pusty string.
 */
export function PanelSelect({
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  disabled,
  busy,
  invalid,
  describedBy,
  className,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly PanelSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /* Zajętość jak w `Button.loading`: sygnał maszynowy `aria-busy` na triggerze,
     gdy wybór odpala akcję w tranzycji (np. zmiana statusu zamówienia). */
  busy?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const hasEmptyOption = options.some((option) => option.value === "");
  const [internalValue, setInternalValue] = React.useState(defaultValue ?? "");
  const selectedValue = value ?? internalValue;
  const radixValue = hasEmptyOption && selectedValue === "" ? EMPTY_VALUE : selectedValue;

  /* Most oddaje serwerowi tylko to, co operator mógł wybrać. */
  const carriedValue = options.some((option) => option.value === selectedValue)
    ? selectedValue
    : "";

  function change(nextValue: string) {
    const decoded = nextValue === EMPTY_VALUE ? "" : nextValue;
    if (value === undefined) setInternalValue(decoded);
    onValueChange?.(decoded);
  }

  return (
    <>
      <Select value={radixValue} onValueChange={change} disabled={disabled}>
        <SelectTrigger
          id={id}
          aria-invalid={invalid || undefined}
          aria-busy={busy || undefined}
          aria-describedby={describedBy}
          className={cn("w-full", className)}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent position="popper" align="start">
          {options.map((option) => (
            <SelectItem
              key={option.value || EMPTY_VALUE}
              value={option.value || EMPTY_VALUE}
              disabled={option.disabled}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {name ? (
        <select
          aria-hidden="true"
          tabIndex={-1}
          name={name}
          className="sr-only"
          disabled={disabled}
          value={carriedValue}
          onChange={(event) => change(event.target.value)}
        >
          {/* Nic nie wybrano, a listy pustej opcji nie ma: bez tej kotwicy
              przeglądarka zaznaczyłaby PIERWSZĄ opcję i wysłała wartość,
              której operator nie wskazał. */}
          {carriedValue === "" && !hasEmptyOption ? <option value="" /> : null}
          {/* Opcje mostu są BEZ etykiet. Etykiety maluje widżet; tutaj nikt ich
              nie przeczyta (element jest schowany i poza drzewem dostępności),
              a zdublowany tekst na ekranie łamie zapytania `getByText` w
              testach ekranów — mierzyłyby wtedy most zamiast kontrolki. */}
          {options.map((option) => (
            <option
              key={option.value || EMPTY_VALUE}
              value={option.value}
              disabled={option.disabled}
            />
          ))}
        </select>
      ) : null}
    </>
  );
}
