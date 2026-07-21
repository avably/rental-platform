import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Card, CardTitle } from "./card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

it("renderuje kartę jako płaską powierzchnię z obrysem, bez klasy cienia", () => {
  render(
    <Card>
      <CardTitle>Rezerwacja</CardTitle>
    </Card>,
  );

  const card = screen.getByText("Rezerwacja").parentElement;
  expect(card).toHaveClass("border", "bg-card");
  expect(card?.className).not.toContain("shadow");
});

it("zachowuje semantykę i przewijanie tabeli", () => {
  render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Numer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>1</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );

  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Numer" })).toBeVisible();
  expect(screen.getByRole("table").parentElement).toHaveClass(
    "overflow-x-auto",
  );
});
