import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Calendar } from "./calendar";

it("renderuje polski kalendarz z dostępną nawigacją", () => {
  render(<Calendar month={new Date(2026, 6, 1)} />);

  expect(screen.getByText(/lipiec 2026/i)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Poprzedni miesiąc" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Następny miesiąc" }),
  ).toBeVisible();
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
