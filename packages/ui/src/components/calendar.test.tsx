import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Calendar } from "./calendar";
import { dayPickerLocale } from "./calendar-locale";

afterEach(cleanup);

/**
 * Język kalendarza jest PROPEM, nie stałą (R3-1c, uwaga 5). Do R3-1c komponent
 * miał `locale = pl` jako wartość domyślną i polskie etykiety nawigacji
 * wpisane z palca — w interfejsie angielskim panel pokazywał więc polski
 * miesiąc. Test jest dwustronny: każdy język ma parę „mówi swoim" + „nie mówi
 * cudzym", bo sama asercja o jednym języku przechodziłaby też po zamianie
 * domyślnej wartości na ten drugi.
 */
it("renderuje kalendarz w języku PODANYM, po polsku", () => {
  render(<Calendar month={new Date(2026, 6, 1)} locale={dayPickerLocale("pl")} />);

  expect(screen.getByText(/lipiec 2026/i)).toBeVisible();
  expect(screen.queryByText(/July 2026/i)).toBeNull();
  expect(screen.getByRole("button", { name: /poprzedniego miesiąca/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /następnego miesiąca/i })).toBeVisible();
});

it("renderuje kalendarz w języku PODANYM, po angielsku", () => {
  render(<Calendar month={new Date(2026, 6, 1)} locale={dayPickerLocale("en")} />);

  expect(screen.getByText(/July 2026/i)).toBeVisible();
  expect(screen.queryByText(/lipiec 2026/i)).toBeNull();
  expect(screen.getByRole("button", { name: /previous month/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /next month/i })).toBeVisible();
});

it("nieznany kod języka spada na angielski, a nie na polski", () => {
  // Routing zna `pl` i `en` (ADR-013) — kalendarz nie jest miejscem na trzeci
  // wariant tej decyzji, więc wszystko spoza `pl` idzie angielskim.
  render(<Calendar month={new Date(2026, 6, 1)} locale={dayPickerLocale("de-DE")} />);

  expect(screen.getByText(/July 2026/i)).toBeVisible();
});

it("maluje początek wybranego zakresu klasą nośnika akcentu", () => {
  render(
    <Calendar
      mode="range"
      month={new Date(2026, 6, 1)}
      selected={{
        from: new Date(2026, 6, 9),
        to: new Date(2026, 6, 11),
      }}
    />,
  );

  const rangeStartButton = document.querySelector<HTMLElement>("button[data-range-start=true]");
  const rangeStartCell = rangeStartButton?.closest("td");
  expect(rangeStartButton).toBeInTheDocument();
  expect(rangeStartCell).toHaveClass("bg-accent");
});
