import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { FilterChip } from "./filter-chip";
import { Input } from "./input";
import { Select, SelectTrigger, SelectValue } from "./select";
import { Skeleton } from "./skeleton";
import { Table, TableBody, TableCell, TableRow } from "./table";
import { Textarea } from "./textarea";

// Stany komponentów wg sekcji 07 artefaktu Fazy 2 (ADR-055): hover =
// podkreślenie, focus = obrys 3px na limonce z nośnikiem, active = translacja
// 1px, disabled = WYCISZONY KONTRAST (opacity) + cursor not-allowed, loading =
// wielokropek + cursor progress. Wartości malowane weryfikuje przeglądarka i
// kontrakt no-shadow; tu pilnujemy API i klas stanów.
//
// Konwencja disabled (weto właściciela 2026-07-28): obrys kreskowany czytał się
// jak FOKUS, nie jak nieaktywność. Nieaktywna kontrolka ma wyglądać na
// nieaktywną — wygaszamy ją opacity, a outline akcentowy zostaje WYŁĄCZNIE dla
// focus-visible. Stała DISABLED_CONVENTION to JEDNA prawda dla całego zestawu;
// blok „wspólna konwencja disabled" niżej mierzy KAŻDĄ kontrolkę tą samą stałą,
// więc rozjazd którejkolwiek od reszty pali suitę (kontrakt dwukierunkowy z
// artefaktem, sekcja 07). Dowód mutacyjny: przywróć disabled:border-dashed w
// jednym komponencie → czerwone.
const DISABLED_CONVENTION = [
  "disabled:cursor-not-allowed",
  "disabled:opacity-50",
];
const DISABLED_FORBIDDEN = ["disabled:border-dashed", "disabled:border-current"];

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

  it("disabled wygasza kontrast i trzyma cursor not-allowed, bez obrysu kreskowanego", () => {
    render(<Button disabled>Usuń trwale</Button>);

    const button = screen.getByRole("button", { name: "Usuń trwale" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass(...DISABLED_CONVENTION);
    for (const forbidden of DISABLED_FORBIDDEN) {
      expect(button.className).not.toContain(forbidden);
    }
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

  it("disabled wygasza pigułkę jak resztę kontrolek (bez obrysu kreskowanego)", () => {
    render(
      <FilterChip pressed={false} disabled>
        Zwroty
      </FilterChip>,
    );

    const chip = screen.getByRole("button", { name: "Zwroty" });
    expect(chip).toHaveClass(...DISABLED_CONVENTION);
    for (const forbidden of DISABLED_FORBIDDEN) {
      expect(chip.className).not.toContain(forbidden);
    }
  });
});

// Kontrakt spójności: KAŻDA kontrolka zestawu niosąca stan disabled mierzona
// jest TĄ SAMĄ stałą DISABLED_CONVENTION. Gdy jeden komponent odejdzie od
// wspólnej konwencji (np. wróci do obrysu kreskowanego albo zgubi wygaszenie),
// jego wiersz tu pada — rozjazd między komponentami pali test, nie tylko
// rozjazd z literałem.
describe("wspólna konwencja disabled całego zestawu kontrolek", () => {
  const controls: {
    name: string;
    element: ReactElement;
    slot: string;
  }[] = [
    {
      name: "Button",
      element: <Button disabled>Usuń trwale</Button>,
      slot: "button",
    },
    {
      name: "FilterChip",
      element: (
        <FilterChip pressed={false} disabled>
          Zwroty
        </FilterChip>
      ),
      slot: "filter-chip",
    },
    {
      name: "Input",
      element: <Input disabled aria-label="Nazwa sprzętu" />,
      slot: "input",
    },
    {
      name: "Textarea",
      element: <Textarea disabled aria-label="Notatki" />,
      slot: "textarea",
    },
    {
      name: "Checkbox",
      element: <Checkbox disabled aria-label="Aktywna rezerwacja" />,
      slot: "checkbox",
    },
    {
      name: "SelectTrigger",
      element: (
        <Select>
          <SelectTrigger disabled aria-label="Status">
            <SelectValue placeholder="—" />
          </SelectTrigger>
        </Select>
      ),
      slot: "select-trigger",
    },
  ];

  // Każdą kontrolkę czytamy z JEJ własnego kontenera po data-slot: pakiet nie
  // rejestruje auto-cleanup, a Radix (checkbox/select) dokłada ukryte natywne
  // bliźniaki tej samej roli — zapytanie po roli łapałoby dubel albo pozostałość
  // z poprzedniego renderu. data-slot celuje dokładnie w kontrolkę niosącą klasy.
  const mount = (control: (typeof controls)[number]): HTMLElement => {
    const { container } = render(control.element);
    const element = container.querySelector<HTMLElement>(
      `[data-slot="${control.slot}"]`,
    );
    if (!element) {
      throw new Error(`Brak elementu data-slot="${control.slot}" w DOM`);
    }
    return element;
  };

  it.each(controls)(
    "$name niesie wspólną konwencję disabled (wygaszenie + not-allowed)",
    (control) => {
      expect(mount(control)).toHaveClass(...DISABLED_CONVENTION);
    },
  );

  it.each(controls)(
    "$name nie niesie żadnego znacznika obrysu kreskowanego",
    (control) => {
      const className = mount(control).className;
      for (const forbidden of DISABLED_FORBIDDEN) {
        expect(className).not.toContain(forbidden);
      }
    },
  );
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

// Kontrakt dwukierunkowy jako BRAMKA, nie deklaracja (recenzja PM PR #135):
// same asercje na klasach komponentów nie łapią rozjazdu artefaktu — cofnięcie
// uniwersalnej reguły disabled w artefakcie do obrysu kreskowanego zostawiało
// suitę zieloną. Ten blok czyta artefakt Fazy 2 Z DYSKU i wymusza, by reguła
// `:disabled, [aria-disabled="true"]` wygaszała kontrast (opacity) i NIE
// kreskowała — inaczej kod i artefakt milcząco się rozjeżdżają.
describe("kontrakt disabled z artefaktem Fazy 2 (odczyt z dysku)", () => {
  // process.cwd() to packages/ui przy uruchomieniu vitest — artefakt leży w
  // korzeniu repo (wzorzec ścieżki jak w gallery-contract.test.ts).
  const artifact = readFileSync(
    resolve(
      process.cwd(),
      "../../docs/branding/2026-07-20-avably-faza-2-system.html",
    ),
    "utf8",
  );

  // Ciało uniwersalnej reguły `:disabled, [aria-disabled="true"] { … }`.
  // `[^}]*` nie przechodzi przez `}`, więc łapie DOKŁADNIE tę regułę, a nie
  // sąsiednie (np. dashed w [data-screen="dashboard-placeholder"]).
  const ruleBody = artifact.match(
    /:disabled,\s*\[aria-disabled="true"\]\s*\{([^}]*)\}/,
  )?.[1];

  it("artefakt w ogóle deklaruje uniwersalną regułę disabled (kontrola pozytywna)", () => {
    expect(ruleBody, "brak reguły :disabled w artefakcie Fazy 2").toBeTypeOf(
      "string",
    );
  });

  it("reguła disabled wygasza kontrast (opacity) i cursor not-allowed", () => {
    expect(ruleBody).toContain("opacity");
    expect(ruleBody).toContain("not-allowed");
  });

  it("reguła disabled NIE kreskuje obrysu (dashed usunięte z artefaktu)", () => {
    expect(ruleBody ?? "").not.toContain("dashed");
  });
});
