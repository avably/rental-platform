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

it("renderuje kartę z tokenem płaskiej powierzchni", () => {
  render(
    <Card>
      <CardTitle>Rezerwacja</CardTitle>
    </Card>,
  );

  expect(screen.getByText("Rezerwacja").parentElement).toHaveClass(
    "shadow-sm",
  );
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
