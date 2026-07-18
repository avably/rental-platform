import { describe, expect, it } from "vitest";

import {
  renderPickupReturnReminder,
  renderReturnLabel,
  type PickupReturnReminderEmailProps,
  type ReturnLabelEmailProps,
} from "../src/index";

const labelPl = {
  customerName: "Anna Kowalska",
  endDate: "23.07.2026",
  locale: "pl",
  orderNumber: "AV-2026-001",
  shipmentNumber: "GK240610123456",
  tenantName: "Wypożyczalnia Północ",
} satisfies ReturnLabelEmailProps;

const labelEn = {
  carrierName: "Przewoźnik X",
  customerName: "Anna Kowalska",
  endDate: "23 July 2026",
  locale: "en",
  orderNumber: "AV-2026-001",
  shipmentNumber: "GK240610123456",
  tenantName: "North Rental",
} satisfies ReturnLabelEmailProps;

const reminderPl = {
  customerName: "Anna Kowalska",
  endDate: "23.07.2026",
  locale: "pl",
  locationAddress: "ul. Składowa 5, 00-001 Warszawa",
  locationName: "Magazyn Główny",
  orderNumber: "AV-2026-001",
  tenantName: "Wypożyczalnia Północ",
} satisfies PickupReturnReminderEmailProps;

const reminderEn = {
  customerName: "Anna Kowalska",
  endDate: "23 July 2026",
  locale: "en",
  locationAddress: "12 Depot Street, London",
  locationName: "Main Depot",
  openingHours: "Mon–Fri 8:00–16:00",
  orderNumber: "AV-2026-001",
  phone: "+44 20 1234 5678",
  tenantName: "North Rental",
} satisfies PickupReturnReminderEmailProps;

describe("ReturnLabelEmail", () => {
  it("renderuje snapshot PL", async () => {
    const result = await renderReturnLabel(labelPl);

    expect(result.html).toContain(labelPl.tenantName);
    expect(result.html).not.toContain("Avably");
    expect(result.html).not.toContain("oklch");
    expect(result.text).toContain(labelPl.endDate);
    expect(result.text).toContain(labelPl.shipmentNumber);
    // Bez nazwy przewoźnika nie ma jej rubryki — pusta byłaby gorsza niż brak.
    expect(result.text).not.toContain("Przewoźnik");
    expect(result).toMatchSnapshot();
  });

  it("renderuje snapshot EN (z nazwą przewoźnika)", async () => {
    const result = await renderReturnLabel(labelEn);

    expect(result.html).toContain(labelEn.tenantName);
    expect(result.html).not.toContain("Avably");
    expect(result.text).toContain("Carrier");
    expect(result.text).toContain(labelEn.carrierName);
    expect(result).toMatchSnapshot();
  });
});

describe("PickupReturnReminderEmail", () => {
  it("renderuje snapshot PL (bez telefonu i godzin — dzisiejsza kartoteka punktu)", async () => {
    const result = await renderPickupReturnReminder(reminderPl);

    expect(result.html).toContain(reminderPl.tenantName);
    expect(result.html).not.toContain("Avably");
    expect(result.html).not.toContain("oklch");
    expect(result.text).toContain(reminderPl.locationName);
    expect(result.text).toContain(reminderPl.locationAddress);
    expect(result.text).not.toContain("Telefon");
    expect(result.text).not.toContain("Godziny otwarcia");
    expect(result).toMatchSnapshot();
  });

  it("renderuje snapshot EN (z telefonem i godzinami)", async () => {
    const result = await renderPickupReturnReminder(reminderEn);

    expect(result.html).toContain(reminderEn.tenantName);
    expect(result.html).not.toContain("Avably");
    expect(result.text).toContain(reminderEn.phone);
    expect(result.text).toContain(reminderEn.openingHours);
    expect(result).toMatchSnapshot();
  });
});
