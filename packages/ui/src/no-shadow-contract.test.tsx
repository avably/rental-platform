import { resolve } from "node:path";
import tailwindcssPostcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { Card } from "./components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "./components/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/tooltip";

// Twardy zakaz artefaktu Fazy 2 (effects): bez cieni unoszących karty —
// rozdział powierzchni robią obrysy. Ten kontrakt sprawdza COMPUTED STYLE
// wyrenderowanych nakładek, nie treść plików (lekcja PR #85: Preflight/
// fallback potrafi malować co innego, niż mówi źródło). Arkusz jest
// kompilowany tym samym silnikiem co build Next.js (@tailwindcss/postcss),
// więc klasa cienia dopisana komponentowi materializuje się tutaj jako
// niepusty box-shadow i wywraca suitę.

beforeAll(async () => {
  const entry = `@import "tailwindcss";\n@import "@avably/ui/styles.css";\n`;
  const result = await postcss([
    tailwindcssPostcss({ base: process.cwd(), optimize: false }),
  ]).process(entry, { from: resolve(process.cwd(), "virtual.css") });

  // jsdom nie egzekwuje poprawnie priorytetu CSS Cascade Layers — zdejmujemy
  // wyłącznie opakowania @layer, zachowując treść i kolejność (uzasadnienie
  // i weryfikacja empiryczna: gallery-contract.test.ts).
  const style = document.createElement("style");
  style.textContent = stripAtLayerWrappers(result.css);
  document.head.appendChild(style);
});

function expectFlatSurface(element: Element, label: string) {
  const { boxShadow } = getComputedStyle(element);
  expect(
    boxShadow === "" || boxShadow === "none",
    `${label}: computed box-shadow = "${boxShadow}" — nakładki rozdziela obrys, nie cień`,
  ).toBe(true);
}

describe("nakładki bez cieni — computed style wyrenderowanych komponentów", () => {
  it("kontrola pozytywna: rig w ogóle widzi cienie (probe z jawnym cieniem)", () => {
    // Bez tej kontroli zielony wynik mógłby oznaczać jedynie, że jsdom nie
    // policzył box-shadow z klas Tailwinda (dowód po pustym zbiorze).
    render(
      <div
        data-testid="shadow-probe"
        className="shadow-[0_8px_30px_rgba(0,0,0,0.12)]"
      />,
    );
    const probe = screen.getByTestId("shadow-probe");
    const { boxShadow } = getComputedStyle(probe);
    expect(boxShadow).not.toBe("");
    expect(boxShadow).not.toBe("none");
  });

  it("DialogContent maluje się bez cienia, z obrysem", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Szczegóły</DialogTitle>
          <DialogDescription>Dane rezerwacji</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    expectFlatSurface(screen.getByRole("dialog"), "DialogContent");
  });

  // ADR-056: szuflada nawigacji mobilnej jest nakładką jak każda inna, więc
  // podlega temu samemu zakazowi. Wpis jest tu JAWNY, bo lista nakładek w tym
  // kontrakcie jest enumerowana — nowy prymityw nie wchodzi pod bramkę sam.
  it.each(["left", "right"] as const)(
    "SheetContent (%s) maluje się bez cienia, z obrysem",
    (side) => {
      render(
        <Sheet open>
          <SheetContent side={side}>
            <SheetTitle>Nawigacja</SheetTitle>
            <SheetDescription>Sekcje panelu</SheetDescription>
          </SheetContent>
        </Sheet>,
      );
      expectFlatSurface(screen.getByRole("dialog"), `SheetContent[${side}]`);
    },
  );

  it("PopoverContent maluje się bez cienia, z obrysem", () => {
    render(
      <Popover open>
        <PopoverTrigger>Informacje</PopoverTrigger>
        <PopoverContent data-testid="popover-content">Treść</PopoverContent>
      </Popover>,
    );
    expectFlatSurface(screen.getByTestId("popover-content"), "PopoverContent");
  });

  it("DropdownMenuContent maluje się bez cienia, z obrysem", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Akcje</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Podgląd</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expectFlatSurface(screen.getByRole("menu"), "DropdownMenuContent");
  });

  it("TooltipContent maluje się bez cienia", () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger>Pomoc</TooltipTrigger>
          <TooltipContent>Wyjaśnienie pola</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expectFlatSurface(screen.getByRole("tooltip"), "TooltipContent");
  });

  it("Card maluje się bez cienia, z obrysem", () => {
    render(<Card data-testid="card">Rezerwacja</Card>);
    expectFlatSurface(screen.getByTestId("card"), "Card");
  });
});

function stripAtLayerWrappers(css: string): string {
  let out = css.replace(/@layer\s+[\w\s,-]+;/g, "");
  let result = "";
  const opener = /@layer\s+[\w-]+\s*\{/;
  for (;;) {
    const match = opener.exec(out);
    if (!match) {
      result += out;
      break;
    }
    result += out.slice(0, match.index);
    const openIndex = match.index + match[0].length - 1;
    let depth = 1;
    let cursor = openIndex + 1;
    while (depth > 0 && cursor < out.length) {
      if (out[cursor] === "{") depth++;
      else if (out[cursor] === "}") depth--;
      cursor++;
    }
    result += out.slice(openIndex + 1, cursor - 1);
    out = out.slice(cursor);
  }
  return result;
}
