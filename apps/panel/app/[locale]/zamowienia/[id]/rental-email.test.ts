import { describe, expect, it, vi } from "vitest";

import {
  TEMPLATE_FOR_STATUS,
  buildRentalEmail,
  sendRentalEmailForTransition,
} from "./rental-email";

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
const nbsp = (value: string) => value.replace(/[\u00A0\u202F]/g, " ");

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
    expect(await buildRentalEmail({ ...base, status: "pending" })).toBeNull();
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

describe("sendRentalEmailForTransition", () => {
  const order = {
    order_number: "AV-2026-001",
    start_date: "2026-08-01",
    end_date: "2026-08-05",
    total_rental_grosze: 55_000,
    customers: { full_name: "Jan Kowalski", email: "klient@example.com" },
    pickup_locations: null,
  };

  const ctx = {
    order,
    tenantName: "Wypożyczalnia Demo",
    locale: "pl" as const,
    currency: "PLN" as const,
    settings: [{ key: "email_sender", value: { name: "Wypożyczalnia Demo" } }],
    availability: { available: true },
  };

  it("brak klucza Resend → czytelny powód, zero prób wysyłki", async () => {
    const send = vi.fn();
    const result = await sendRentalEmailForTransition({
      ...ctx,
      status: "reserved",
      availability: {
        available: false,
        reason: "Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY).",
      },
      transport: { send },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toContain("RESEND_API_KEY");
  });

  // TWARDY DoD PLANU FAZY: klucz JEST, nadawcy NIE MA → czytelny błąd
  // konfiguracji, nie cichy sukces.
  it("brak nadawcy tenanta → czytelny błąd konfiguracji", async () => {
    const send = vi.fn();
    const result = await sendRentalEmailForTransition({
      ...ctx,
      status: "reserved",
      settings: [],
      transport: { send },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toContain("nazwy nadawcy");
  });

  it("klient bez adresu → czytelny powód, zero prób", async () => {
    const send = vi.fn();
    const result = await sendRentalEmailForTransition({
      ...ctx,
      status: "reserved",
      order: { ...order, customers: null },
      transport: { send },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toContain("adresu e-mail");
  });

  // Tranzycja jest już utrwalona — awaria poczty nie może z niej zrobić
  // błędu ani uciec wyjątkiem (wzorzec uczciwej częściowej porażki ADR-027).
  it("odmowa dostawcy → powód zwrócony, wyjątek nie ucieka", async () => {
    const send = vi.fn().mockRejectedValue(new Error("HTTP 422 domain not verified"));
    const result = await sendRentalEmailForTransition({
      ...ctx,
      status: "reserved",
      transport: { send },
    });
    expect(result).toContain("Status zmieniony");
    expect(result).toContain("422");
  });

  it("sukces → brak powodu, wiadomość poszła do klienta", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendRentalEmailForTransition({
      ...ctx,
      status: "reserved",
      transport: { send },
    });
    expect(result).toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({ to: "klient@example.com" });
  });

  it("status bez szablonu → brak powodu i zero prób", async () => {
    const send = vi.fn();
    const result = await sendRentalEmailForTransition({
      ...ctx,
      status: "pending",
      transport: { send },
    });
    expect(send).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  // ADR-037: preferencja językowa KLIENTA wygrywa nad językiem TENANTA.
  // Kontrakt buildRentalEmail bez zmian — wzbogaca się źródło locale.
  it("locale klienta wygrywa nad locale tenanta (customers.locale ?? tenants.locale)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await sendRentalEmailForTransition({
      ...ctx,
      status: "reserved",
      locale: "pl", // język tenanta
      order: {
        ...order,
        customers: { full_name: "Jan Kowalski", email: "klient@example.com", locale: "en" },
      },
      transport: { send },
    });
    expect(send.mock.calls[0]![0].subject).toBe("Reservation confirmed");
  });

  it("brak preferencji klienta (locale null) → język tenanta", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await sendRentalEmailForTransition({
      ...ctx,
      status: "reserved",
      locale: "pl",
      order: {
        ...order,
        customers: { full_name: "Jan Kowalski", email: "klient@example.com", locale: null },
      },
      transport: { send },
    });
    expect(send.mock.calls[0]![0].subject).toBe("Rezerwacja potwierdzona");
  });

  it("klient bez nazwiska → adres zamiast pustego powitania", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await sendRentalEmailForTransition({
      ...ctx,
      status: "reserved",
      order: { ...order, customers: { full_name: null, email: "klient@example.com" } },
      transport: { send },
    });
    expect(send.mock.calls[0]![0].html).toContain("klient@example.com");
  });
});
