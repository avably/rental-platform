import { describe, expect, it } from "vitest";

import {
  renderRentalCancelled,
  renderRentalConfirmed,
  renderRentalPickedUp,
  renderRentalReadyForPickup,
  renderRentalReturned,
  type RentalLifecycleEmailProps,
} from "../src/index";

const plProps = {
  customerName: "Anna Kowalska",
  endDate: "23.07.2026",
  locale: "pl",
  orderNumber: "AV-2026-001",
  pickupLocationName: "Magazyn Główny",
  startDate: "20.07.2026",
  tenantName: "Wypożyczalnia Północ",
  totalRentalFormatted: "550,00 zł",
} satisfies RentalLifecycleEmailProps;

const enProps = {
  customerName: "Anna Kowalska",
  endDate: "23 July 2026",
  locale: "en",
  orderNumber: "AV-2026-001",
  startDate: "20 July 2026",
  tenantName: "North Rental",
  totalRentalFormatted: "PLN 550.00",
} satisfies RentalLifecycleEmailProps;

const templates = [
  ["RentalConfirmed", renderRentalConfirmed],
  ["RentalReadyForPickup", renderRentalReadyForPickup],
  ["RentalPickedUp", renderRentalPickedUp],
  ["RentalReturned", renderRentalReturned],
  ["RentalCancelled", renderRentalCancelled],
] as const;

describe.each(templates)("%s", (_name, renderTemplate) => {
  it("renderuje snapshot PL", async () => {
    const result = await renderTemplate(plProps);

    expect(result.html).toContain(plProps.tenantName);
    expect(result.html).not.toContain("Avably");
    expect(result.html).not.toContain("oklch");
    expect(result.text).toContain(plProps.pickupLocationName);
    expect(result).toMatchSnapshot();
  });

  it("renderuje snapshot EN", async () => {
    const result = await renderTemplate(enProps);

    expect(result.html).toContain(enProps.tenantName);
    expect(result.html).not.toContain("Avably");
    expect(result.html).not.toContain("oklch");
    expect(result.text).not.toContain("Pickup location");
    expect(result).toMatchSnapshot();
  });
});
