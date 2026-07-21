import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { statusTones } from "../lib/status-semantics";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it.each(statusTones)("maluje rodzaj %s tokenami statusu", (tone) => {
    render(<StatusBadge tone={tone}>{`Etykieta ${tone}`}</StatusBadge>);

    const chip = screen.getByText(`Etykieta ${tone}`);
    expect(chip).toHaveAttribute("data-tone", tone);
    expect(chip).toHaveClass(
      `bg-status-${tone}-bg`,
      `text-status-${tone}-fg`,
      `border-status-${tone}-border`,
    );
  });

  it("ma geometrię chipa artefaktu (wysokość 28px, promień sm, obrys)", () => {
    render(<StatusBadge tone="neutral">Zarezerwowane</StatusBadge>);

    expect(screen.getByText("Zarezerwowane")).toHaveClass(
      "h-7",
      "rounded-sm",
      "border",
    );
  });

  it("wymusza tekst konkretnej wartości przez API, nie konwencją", () => {
    // Twardy zakaz artefaktu (color-only-status): status zawsze zawiera tekst.
    // Brak children i children nietekstowe mają być błędem TYPÓW — pilnują
    // tego dyrektywy poniżej (typecheck CI), nie asercja runtime.
    // @ts-expect-error — StatusBadge bez children nie przechodzi typów
    void (<StatusBadge tone="neutral" />);
    // @ts-expect-error — sama ikona (element) zamiast tekstu nie przechodzi typów
    void (<StatusBadge tone="neutral">{<svg />}</StatusBadge>);

    render(<StatusBadge tone="problem">Anulowane</StatusBadge>);
    expect(screen.getByText("Anulowane").textContent).toBe("Anulowane");
  });
});
