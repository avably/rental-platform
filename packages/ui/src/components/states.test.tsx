import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { FilterChip } from "./filter-chip";
import { Skeleton } from "./skeleton";
import { Table, TableBody, TableCell, TableRow } from "./table";

// Stany komponentów wg sekcji 07 artefaktu Fazy 2 (ADR-055): hover =
// podkreślenie, focus = obrys 3px na limonce z nośnikiem, active = translacja
// 1px, disabled = obrys kreskowany + cursor not-allowed, loading = wielokropek
// + cursor progress. Wartości malowane weryfikuje przeglądarka i kontrakt
// no-shadow; tu pilnujemy API i klas stanów.

describe("Button — stany Fazy 2", () => {
  it("stan loading ustawia aria-busy, cursor progress i dokłada wielokropek", () => {
    render(<Button loading>Zapisz</Button>);

    const button = screen.getByRole("button", { name: /Zapisz/ });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveClass("aria-busy:cursor-progress");
    expect(button.textContent).toBe("Zapisz …");
  });

  it("bez loading nie ma aria-busy ani wielokropka", () => {
    render(<Button>Anuluj</Button>);

    const button = screen.getByRole("button", { name: "Anuluj" });
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button.textContent).toBe("Anuluj");
  });

  it("disabled dostaje obrys kreskowany i cursor not-allowed, bez zbijania opacity", () => {
    render(<Button disabled>Usuń trwale</Button>);

    const button = screen.getByRole("button", { name: "Usuń trwale" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass(
      "disabled:cursor-not-allowed",
      "disabled:border-dashed",
    );
    expect(button.className).not.toContain("disabled:opacity");
  });

  it("hover to podkreślenie, focus to obrys na limonce, active to translacja", () => {
    render(<Button>Zapisz zmiany</Button>);

    const button = screen.getByRole("button", { name: "Zapisz zmiany" });
    expect(button.className).toContain("hover:underline");
    expect(button.className).toContain("focus-visible:outline-");
    expect(button).toHaveClass("active:translate-y-px");
  });
});

describe("FilterChip — filtr-pigułka z sekcji 07", () => {
  it("domyślnie maluje się powierzchnią secondary z aria-pressed=false", () => {
    render(<FilterChip pressed={false}>Nagrzewnice</FilterChip>);

    const chip = screen.getByRole("button", { name: "Nagrzewnice" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveClass("bg-secondary");
  });

  it("wciśnięty przechodzi na limonkę z nośnikiem ink (tekst + obrys foreground)", () => {
    render(<FilterChip pressed>Aktywne</FilterChip>);

    const chip = screen.getByRole("button", { name: "Aktywne" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveClass(
      "aria-pressed:bg-accent",
      "aria-pressed:text-accent-foreground",
      "aria-pressed:border-foreground",
    );
  });

  it("disabled dostaje obrys kreskowany jak reszta kontrolek", () => {
    render(
      <FilterChip pressed={false} disabled>
        Zwroty
      </FilterChip>,
    );

    expect(screen.getByRole("button", { name: "Zwroty" })).toHaveClass(
      "disabled:border-dashed",
      "disabled:cursor-not-allowed",
    );
  });
});

describe("Skeleton — wzorzec loading z sekcji 07", () => {
  it("maluje się powierzchnią secondary, statycznie (twardy zakaz pętli), poza drzewem dostępności", () => {
    render(<Skeleton data-testid="skeleton" />);

    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton).toHaveClass("bg-secondary");
    expect(skeleton.className).not.toContain("animate-");
  });
});

describe("TableRow — stany wiersza z sekcji 07", () => {
  it("hover zagęszcza obrys wiersza zamiast podmieniać tło", () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>ZAM/2026/0714</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const row = screen.getByText("ZAM/2026/0714").closest("tr");
    expect(row?.className).toContain("hover:border-b-foreground");
    expect(row?.className).not.toContain("hover:bg-");
  });

  it("wiersz aktywny dostaje znacznik signal-strong przy lewej krawędzi", () => {
    render(
      <Table>
        <TableBody>
          <TableRow data-state="selected">
            <TableCell>ZAM/2026/0715</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    // Znacznik żyje na PIERWSZEJ KOMÓRCE, nie na <tr>: w modelu
    // border-collapse Chrome nie maluje lewych obrysów wiersza (zweryfikowane
    // w przeglądarce — klasa na tr dawała computed 0px i pusty piksel).
    const row = screen.getByText("ZAM/2026/0715").closest("tr");
    expect(row?.className).toContain(
      "data-[state=selected]:[&>td:first-child]:border-l-signal-strong",
    );
    expect(row?.className).toContain(
      "dark:data-[state=selected]:[&>td:first-child]:border-l-accent-foreground",
    );
  });
});
