import { describe, expect, it } from "vitest";

import { TEMPLATE_FOR_STATUS, buildRentalEmail } from "./rental-email";

const base = {
  locale: "pl" as const,
  currency: "PLN" as const,
  sender: { name: "Wypożyczalnia Demo", replyTo: "kontakt@example.com" },
  tenantName: "Wypożyczalnia Demo",
  customerEmail: "klient@example.com",
  customerName: "Jan Kowalski",
  orderNumber: "AV-2026-001",
  startDate: "2026-08-01",
  endDate: "2026-08-05",
  totalRentalGrosze: 55_000,
  fromEmail: "Avably <noreply@avably.io>",
};

/** Intl wstawia NBSP — porównania robimy na znormalizowanej spacji. */
const nbsp = (value: string) => value.replace(/ /g, " ");

describe("TEMPLATE_FOR_STATUS", () => {
  it("mapuje pięć statusów cyklu najmu", () => {
    expect(TEMPLATE_FOR_STATUS).toEqual({
      reserved: "confirmed",
      ready_for_pickup: "readyForPickup",
      picked_up: "pickedUp",
      returned: "returned",
      cancelled: "cancelled",
    });
  });
});

describe("buildRentalEmail", () => {
  it("status bez szablonu → null (stan legalny, nie błąd)", async () => {
    expect(await buildRentalEmail({ ...base, status: "draft" })).toBeNull();
  });

  it("formatuje kwotę wg locale i waluty tenanta", async () => {
    const email = await buildRentalEmail({ ...base, status: "reserved" });
    expect(nbsp(email!.html)).toContain("550,00 zł");
  });

  it("locale EN zmienia zapis kwoty i treść", async () => {
    const email = await buildRentalEmail({ ...base, status: "reserved", locale: "en" });
    expect(nbsp(email!.html)).toContain("PLN 550.00");
  });

  it("temat pochodzi z nagłówka szablonu w locale tenanta", async () => {
    const pl = await buildRentalEmail({ ...base, status: "reserved" });
    expect(pl!.subject).toBe("Rezerwacja potwierdzona");
    const en = await buildRentalEmail({ ...base, status: "reserved", locale: "en" });
    expect(en!.subject).toBe("Reservation confirmed");
  });

  it("każdy zmapowany status daje inny temat", async () => {
    const subjects = await Promise.all(
      (["reserved", "ready_for_pickup", "picked_up", "returned", "cancelled"] as const).map(
        async (status) => (await buildRentalEmail({ ...base, status }))!.subject,
      ),
    );
    expect(new Set(subjects).size).toBe(5);
  });

  it("From niesie nazwę tenanta, reply-to z ustawień, to z klienta", async () => {
    const email = await buildRentalEmail({ ...base, status: "returned" });
    expect(email!.from).toBe("Wypożyczalnia Demo <noreply@avably.io>");
    expect(email!.replyTo).toBe("kontakt@example.com");
    expect(email!.to).toBe("klient@example.com");
  });

  it("nadawca bez reply_to nie ustawia replyTo", async () => {
    const email = await buildRentalEmail({
      ...base,
      status: "returned",
      sender: { name: "Demo" },
    });
    expect(email!.replyTo).toBeUndefined();
  });

  it("daty są sformatowane wg locale, nie surowe ISO", async () => {
    const email = await buildRentalEmail({ ...base, status: "reserved" });
    expect(email!.html).not.toContain("2026-08-01");
    expect(email!.html).toContain("sierpnia");
  });

  it("miejsce odbioru trafia do treści, gdy podane", async () => {
    const email = await buildRentalEmail({
      ...base,
      status: "ready_for_pickup",
      pickupLocationName: "Magazyn Poznań",
    });
    expect(email!.html).toContain("Magazyn Poznań");
  });

  it("wariant tekstowy nie jest pusty (klienci bez HTML)", async () => {
    const email = await buildRentalEmail({ ...base, status: "reserved" });
    expect(email!.text.length).toBeGreaterThan(0);
    expect(email!.text).toContain("AV-2026-001");
  });
});
