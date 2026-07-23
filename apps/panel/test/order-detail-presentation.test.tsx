import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  type OrderStatus,
  type PaymentStatus,
  type ShipmentStatus,
} from "@avably/core";
import { statusSemantics } from "@avably/ui";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import messages from "../messages/pl.json";

import {
  deriveOrderTimeline,
  OrderTimeline,
  type OrderTimelineInput,
  type TimelineStepKey,
  type TimelineStepState,
} from "@/app/[locale]/(panel)/zamowienia/[id]/order-timeline";
import { CustomerCard, type CustomerCardData } from "@/app/[locale]/(panel)/zamowienia/[id]/customer-card";
import { StatusChip } from "@/lib/orders/status-chip";

/**
 * Kontrakt renderu prezentacyjnych elementów szczegółu zamówienia (uwagi
 * przeglądu D1/D4/D5/D9). Szczegół jest asynchronicznym server componentem z
 * odczytami z Supabase, więc jak reszta suity panelu bronimy WYDZIELONYCH,
 * czysto prezentacyjnych kawałków: oś czasu i kartę klienta na fixture
 * wszystkich stanów, plus skan źródła strony na brak zdublowanego bloku.
 */

const STEP_ORDER: readonly TimelineStepKey[] = [
  "order",
  "payment",
  "shipment",
  "return",
  "deposit",
];

const NO_DEPOSIT: OrderTimelineInput["deposit"] = {
  required: false,
  collectedGrosze: 0,
  balanceGrosze: 0,
  settled: false,
};

function input(partial: Partial<OrderTimelineInput> = {}): OrderTimelineInput {
  return {
    orderStatus: "pending",
    paymentStatus: "unpaid",
    shipmentStatus: null,
    createdAt: "2026-07-20T10:00:00Z",
    endDate: "2026-07-25",
    shipmentDispatchedAt: null,
    deposit: NO_DEPOSIT,
    ...partial,
  };
}

function statesOf(inp: OrderTimelineInput): Record<TimelineStepKey, TimelineStepState> {
  const derived = deriveOrderTimeline(inp);
  return Object.fromEntries(derived.map((step) => [step.key, step.state])) as Record<
    TimelineStepKey,
    TimelineStepState
  >;
}

const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  "created",
  "in_progress",
  "in_transit",
  "delivered",
  "cancelled",
  "returned_to_sender",
];

describe("oś czasu zamówienia (D5) — wyliczanie stanów", () => {
  it("zawsze pięć kroków w stałej kolejności domenowej", () => {
    // Podłoga po pustym zbiorze: bez pinu na kolejność pętle niżej mogłyby
    // sprawdzać nie te kroki i wciąż być zielone.
    const keys = deriveOrderTimeline(input()).map((step) => step.key);
    expect(keys).toEqual(STEP_ORDER);
  });

  it("nowe, nieopłacone zamówienie: płatność jest krokiem bieżącym", () => {
    expect(statesOf(input())).toEqual({
      order: "done",
      payment: "current",
      shipment: "upcoming",
      return: "upcoming",
      deposit: "done", // brak kaucji = nic do rozliczenia
    });
  });

  it("płatność w toku (pending) daje obwódkę na kroku płatności", () => {
    expect(statesOf(input({ orderStatus: "reserved", paymentStatus: "pending" })).payment).toBe(
      "current",
    );
  });

  it("opłacone + gotowe do wydania: bieżąca jest wysyłka, kaucja do pobrania", () => {
    expect(
      statesOf(
        input({
          orderStatus: "ready_for_pickup",
          paymentStatus: "paid",
          deposit: { required: true, collectedGrosze: 0, balanceGrosze: 0, settled: false },
        }),
      ),
    ).toEqual({
      order: "done",
      payment: "done",
      shipment: "current",
      return: "upcoming",
      deposit: "upcoming",
    });
  });

  it("wydane w kurierze + kaucja pobrana: bieżący jest zwrot", () => {
    expect(
      statesOf(
        input({
          orderStatus: "picked_up",
          paymentStatus: "paid",
          shipmentStatus: "in_transit",
          shipmentDispatchedAt: "2026-07-21T08:00:00Z",
          deposit: { required: true, collectedGrosze: 50000, balanceGrosze: 50000, settled: false },
        }),
      ),
    ).toEqual({
      order: "done",
      payment: "done",
      shipment: "done",
      return: "current",
      deposit: "upcoming",
    });
  });

  it("zwrócone + kaucja rozliczona: wszystkie kroki ukończone, brak bieżącego", () => {
    const states = statesOf(
      input({
        orderStatus: "returned",
        paymentStatus: "completed",
        shipmentStatus: "delivered",
        shipmentDispatchedAt: "2026-07-21T08:00:00Z",
        deposit: { required: true, collectedGrosze: 50000, balanceGrosze: 0, settled: true },
      }),
    );
    expect(Object.values(states).every((state) => state === "done")).toBe(true);
    expect(Object.values(states)).not.toContain("current");
  });

  it("zamówienie anulowane: krok zamówienia i płatności anulowane, żaden bieżący", () => {
    const states = statesOf(input({ orderStatus: "cancelled", paymentStatus: "cancelled" }));
    expect(states.order).toBe("cancelled");
    expect(states.payment).toBe("cancelled");
    expect(Object.values(states)).not.toContain("current");
  });

  it("cały iloczyn stanów: stałe klucze, dozwolone stany, co najwyżej jeden bieżący", () => {
    const shipmentValues: (ShipmentStatus | null)[] = [null, ...SHIPMENT_STATUSES];
    const depositVariants: OrderTimelineInput["deposit"][] = [
      NO_DEPOSIT,
      { required: true, collectedGrosze: 0, balanceGrosze: 0, settled: false },
      { required: true, collectedGrosze: 50000, balanceGrosze: 50000, settled: false },
      { required: true, collectedGrosze: 50000, balanceGrosze: 0, settled: true },
    ];
    const allowed: TimelineStepState[] = ["done", "current", "upcoming", "cancelled"];

    let combos = 0;
    for (const orderStatus of ORDER_STATUSES as readonly OrderStatus[]) {
      for (const paymentStatus of PAYMENT_STATUSES as readonly PaymentStatus[]) {
        for (const shipmentStatus of shipmentValues) {
          for (const deposit of depositVariants) {
            combos += 1;
            const derived = deriveOrderTimeline(
              input({ orderStatus, paymentStatus, shipmentStatus, deposit }),
            );
            expect(derived.map((step) => step.key)).toEqual(STEP_ORDER);
            for (const step of derived) expect(allowed).toContain(step.state);
            const currents = derived.filter((step) => step.state === "current");
            expect(currents.length, `>1 bieżący dla ${orderStatus}/${paymentStatus}`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    // Kontrola po pustym zbiorze — pętla naprawdę coś przeszła.
    expect(combos).toBe(
      ORDER_STATUSES.length * PAYMENT_STATUSES.length * shipmentValues.length * depositVariants.length,
    );
  });
});

function renderTimeline(inp: OrderTimelineInput): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <OrderTimeline currency="PLN" {...inp} />
    </NextIntlClientProvider>,
  );
}

describe("oś czasu zamówienia (D5) — render", () => {
  const scenario = input({
    orderStatus: "picked_up",
    paymentStatus: "paid",
    shipmentStatus: "in_transit",
    shipmentDispatchedAt: "2026-07-21T08:00:00Z",
    deposit: { required: true, collectedGrosze: 50000, balanceGrosze: 50000, settled: false },
  });

  it("każdy krok renderuje się z data-step-state zgodnym z wyliczeniem", () => {
    const html = renderTimeline(scenario);
    const expected = statesOf(scenario);
    for (const key of STEP_ORDER) {
      const tag = html.match(
        new RegExp(`<li[^>]*data-timeline-step="${key}"[^>]*data-step-state="[^"]+"[^>]*>`),
      )?.[0];
      expect(tag, `brak kroku ${key}`).toBeDefined();
      expect(tag, `stan kroku ${key}`).toContain(`data-step-state="${expected[key]}"`);
    }
  });

  it("każdy krok niesie etykietę tekstową i stan dla czytnika ekranu", () => {
    const html = renderTimeline(scenario);
    for (const key of STEP_ORDER) {
      expect(html, `etykieta ${key}`).toContain(messages.orders.timeline.steps[key]);
    }
    // Stan zakodowany nie tylko kolorem — sr-only niesie słowny stan (zakaz
    // color-only-status).
    expect(html).toContain(messages.orders.timeline.states.done);
    expect(html).toContain(messages.orders.timeline.states.current);
  });
});

function renderCustomerCard(data: CustomerCardData): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <CustomerCard data={data} />
    </NextIntlClientProvider>,
  );
}

const FULL_CUSTOMER: CustomerCardData = {
  fullName: "Jan Kowalski",
  email: "jan@example.pl",
  phone: "+48 600 700 800",
  addressStreet: "Prosta 1",
  addressZip: "00-001",
  addressCity: "Warszawa",
  companyName: "Kowalski sp. z o.o.",
  nip: "1234567890",
};

describe("karta klienta (D1)", () => {
  it("pokazuje inicjały, nazwę i wszystkie pola z kopiowaniem", () => {
    const html = renderCustomerCard(FULL_CUSTOMER);
    expect(html).toContain("data-customer-card");
    expect(html).toContain("Jan Kowalski");
    expect(html).toContain(">JK<"); // inicjały z imienia i nazwiska
    expect(html).toContain("jan@example.pl");
    expect(html).toContain("+48 600 700 800");
    expect(html).toContain("Prosta 1, 00-001 Warszawa");
    expect(html).toContain("NIP 1234567890");
    // Cztery wiersze z wartością (e-mail, telefon, adres, firma) → cztery kopie.
    expect([...html.matchAll(/data-copy-button/g)]).toHaveLength(4);
    // Przycisk kopiowania jest dostępny — ma aria-label z etykietą pola.
    expect(html).toContain(`aria-label="Kopiuj: ${messages.orders.customer.email}"`);
  });

  it("brak telefonu i adresu: odnotowuje brak i nie daje kopii bez wartości", () => {
    const html = renderCustomerCard({
      fullName: null,
      email: "nowy@example.pl",
      phone: null,
      addressStreet: null,
      addressZip: null,
      addressCity: null,
      companyName: null,
      nip: null,
    });
    expect(html).toContain(">N<"); // inicjał z e-maila, gdy brak nazwy
    // Brak wartości jest ODNOTOWANY, nie ukryty.
    expect(html).toContain(messages.orders.customer.notProvided);
    // Tylko e-mail ma wartość → dokładnie jedna kopia (bez pustych przycisków).
    expect([...html.matchAll(/data-copy-button/g)]).toHaveLength(1);
  });
});

function renderShipmentChip(status: ShipmentStatus): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <StatusChip axis="shipment" value={status} />
    </NextIntlClientProvider>,
  );
}

describe("strażnik osi wysyłki (przeniesiony po zdjęciu OrderStatusAxes)", () => {
  it("fixture pokrywa wszystkie wartości osi wysyłki", () => {
    // Oś wysyłki nadal żyje na ekranie (chipy w sekcji logistyki). Bez tego
    // pinu oś dopisana w statusSemantics zostałaby bez strażnika wyniku.
    expect(SHIPMENT_STATUSES).toHaveLength(6);
    expect([...SHIPMENT_STATUSES].sort()).toEqual(Object.keys(statusSemantics.shipment).sort());
  });

  it("każdy chip osi wysyłki niesie ton ze statusSemantics oraz tekst etykiety", () => {
    for (const status of SHIPMENT_STATUSES) {
      const html = renderShipmentChip(status);
      const tag = html.match(
        new RegExp(`<span[^>]*data-status-axis="shipment"[^>]*data-status-value="${status}"[^>]*>`),
      )?.[0];
      expect(tag, `brak chipa shipment/${status}`).toBeDefined();
      expect(tag, `shipment/${status}`).toContain(`data-tone="${statusSemantics.shipment[status]}"`);
      expect(html, `etykieta shipment/${status}`).toContain(
        `>${messages.orders.statusLabels.shipment[status]}</span>`,
      );
    }
  });
});

describe("odchudzony nagłówek (D4) — skan źródła strony", () => {
  const source = readFileSync(
    resolve(process.cwd(), "app/[locale]/(panel)/zamowienia/[id]/page.tsx"),
    "utf8",
  );

  it("oś czasu i karta klienta zastąpiły stare kropki i rozproszone dane", () => {
    expect(source).toContain("<OrderTimeline");
    expect(source).toContain("<CustomerCard");
    // Stary rząd chipów i lista-kropki zdarzeń zniknęły (zastąpione osią czasu).
    expect(source).not.toContain("OrderStatusAxes");
    expect(source).not.toContain("list-disc");
  });

  it("górny blok nie dubluje pól sekcji pozycji/finansów", () => {
    // Sprzęt/ilość/wartość są w sekcji pozycji i jej podsumowaniu — górny blok
    // ich nie powtarza. Dopisanie ich z powrotem do nagłówka pali tutaj.
    expect(source).not.toContain('t("equipment")');
    expect(source).not.toContain('t("quantity")');
    expect(source).not.toContain('t("value")');
  });
});
