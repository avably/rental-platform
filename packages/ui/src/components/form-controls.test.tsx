import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Label } from "./label";
import { Separator } from "./separator";
import { Textarea } from "./textarea";

describe("kontrolki formularzy", () => {
  it("renderuje wariant destructive przycisku", () => {
    render(<Button variant="destructive">Usuń</Button>);

    expect(screen.getByRole("button", { name: "Usuń" })).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground",
    );
  });

  it("łączy etykietę z polem", () => {
    render(
      <>
        <Label htmlFor="nazwa">Nazwa</Label>
        <Input id="nazwa" />
      </>,
    );

    expect(screen.getByLabelText("Nazwa")).toBeInstanceOf(HTMLInputElement);
  });

  it("przełącza checkbox z klawiatury", async () => {
    const user = userEvent.setup();
    render(<Checkbox aria-label="Aktywna rezerwacja" />);
    const checkbox = screen.getByRole("checkbox", {
      name: "Aktywna rezerwacja",
    });

    checkbox.focus();
    await user.keyboard(" ");

    expect(checkbox).toBeChecked();
  });

  it("oznacza błędny textarea przez aria-invalid", () => {
    render(<Textarea aria-label="Uwagi" aria-invalid />);

    expect(screen.getByRole("textbox", { name: "Uwagi" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("renderuje wariant obrysu badge", () => {
    render(<Badge variant="outline">Szkic</Badge>);

    expect(screen.getByText("Szkic")).toHaveClass("text-foreground");
  });

  it("ma semantyczny separator", () => {
    render(<Separator />);

    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
  });
});
