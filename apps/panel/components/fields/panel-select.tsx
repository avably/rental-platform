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
 * Radix nie dopuszcza pustej wartości SelectItem. Gdy formularz ma opcję
 * „wszystkie”, sentinel żyje wyłącznie w widżecie, a FormData dostaje pusty
 * string przez jawne pole ukryte. Dla zwykłych wartości transportem pozostaje
 * wbudowany bridge Radix uruchamiany propem `name`.
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

  function change(nextValue: string) {
    const decoded = nextValue === EMPTY_VALUE ? "" : nextValue;
    if (value === undefined) setInternalValue(decoded);
    onValueChange?.(decoded);
  }

  return (
    <>
      {hasEmptyOption && name ? (
        <input type="hidden" name={name} value={selectedValue} />
      ) : null}
      <Select
        name={hasEmptyOption ? undefined : name}
        value={radixValue}
        onValueChange={change}
        disabled={disabled}
      >
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
    </>
  );
}
