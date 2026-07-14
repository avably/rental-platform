import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "./popover";
import { Select, SelectTrigger, SelectValue } from "./select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

describe("nakładki", () => {
  it("otwiera i zamyka dialog klawiaturą", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger>Otwórz</DialogTrigger>
        <DialogContent>
          <DialogTitle>Szczegóły</DialogTitle>
          <DialogDescription>Dane rezerwacji</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole("button", { name: "Otwórz" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(screen.getByRole("button", { name: "Zamknij" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renderuje select jako dostępny combobox", () => {
    render(
      <Select>
        <SelectTrigger aria-label="Status">
          <SelectValue placeholder="Wybierz status" />
        </SelectTrigger>
      </Select>,
    );

    expect(screen.getByRole("combobox", { name: "Status" })).toBeVisible();
  });

  it("zachowuje destructive wariant elementu menu", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Akcje</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem variant="destructive">Usuń</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expect(screen.getByRole("menuitem", { name: "Usuń" })).toHaveAttribute(
      "data-variant",
      "destructive",
    );
  });

  it("renderuje tytuł popovera jako nagłówek", () => {
    render(
      <Popover open>
        <PopoverTrigger>Informacje</PopoverTrigger>
        <PopoverContent>
          <PopoverTitle>Dostępność</PopoverTitle>
        </PopoverContent>
      </Popover>,
    );

    expect(
      screen.getByRole("heading", { name: "Dostępność", level: 2 }),
    ).toBeVisible();
  });

  it("łączy tooltip z wyzwalaczem", () => {
    render(
      <TooltipProvider>
        <Tooltip defaultOpen>
          <TooltipTrigger>Pomoc</TooltipTrigger>
          <TooltipContent>Wyjaśnienie pola</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    expect(screen.getByRole("tooltip")).toHaveTextContent("Wyjaśnienie pola");
  });
});
