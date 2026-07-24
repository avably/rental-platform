import { describe, expect, it, vi } from "vitest";

import {
  bulkStatusOutcome,
  rejectReasonFromCode,
  runBulkStatusChange,
  type BulkStatusAttempt,
  type BulkStatusTarget,
} from "@/lib/orders/bulk-status";
import { bulkStatusChangeFromFormData, bulkStatusChangeSchema } from "@/lib/order-validation";

/**
 * Uczciwość raportu masowej zmiany statusu (U4).
 *
 * Operacja masowa nad maszyną stanów JEST z natury częściowo nieudana —
 * trigger 0010 odrzuca per wiersz. Ten test pilnuje jedynej rzeczy, która się
 * tu naprawdę liczy: odrzucone zamówienia NIE mogą wylądować po stronie
 * zmienionych ani zniknąć z raportu, a podsumowanie musi nazywać częściową
 * porażkę częściową porażką. Mechanizm dostępu do bazy jest wstrzykiwany, więc
 * całość chodzi bez Supabase.
 */

const target = (orderId: string, from: BulkStatusTarget["from"]): BulkStatusTarget => ({
  orderId,
  orderNumber: `ZAM/${orderId}`,
  from,
});

describe("masowa zmiana statusu: raport per zamówienie", () => {
  it("rozdziela zmienione od odrzuconych i nie gubi żadnego zamówienia", async () => {
    const targets = [
      target("1", "pending"),
      target("2", "picked_up"), // → reserved jest nielegalne (odmowa bazy)
      target("3", "pending"),
    ];
    const attempt = vi.fn(
      async (t: BulkStatusTarget): Promise<BulkStatusAttempt> =>
        t.orderId === "2"
          ? { ok: false, reason: "illegal-transition", detail: "Niedozwolone przejście" }
          : { ok: true },
    );

    const report = await runBulkStatusChange(targets, "reserved", attempt);

    expect(report.changed.map((entry) => entry.orderId)).toEqual(["1", "3"]);
    expect(report.rejected.map((entry) => entry.orderId)).toEqual(["2"]);
    expect(report.rejected[0]!.reason).toBe("illegal-transition");
    expect(report.rejected[0]!.from).toBe("picked_up");
    // Nic nie wyparowało: suma raportu = liczba zaznaczonych.
    expect(report.changed.length + report.rejected.length).toBe(targets.length);
  });

  it("odrzucone NIGDY nie trafiają do zmienionych — nawet gdy to większość", async () => {
    const targets = ["a", "b", "c", "d"].map((id) => target(id, "picked_up"));
    const report = await runBulkStatusChange(targets, "cancelled", async () => ({
      ok: false,
      reason: "illegal-transition",
    }));

    expect(report.changed).toEqual([]);
    expect(report.rejected).toHaveLength(4);
    expect(bulkStatusOutcome(report)).toBe("none");
  });

  it("cel równy stanowi bieżącemu jest pominięciem, a nie zmianą", async () => {
    // Trigger 0010 bramkuje wyłącznie ZMIANĘ statusu, więc taki UPDATE
    // przeszedłby po cichu i raport ogłosiłby zmianę, której nie było.
    const attempt = vi.fn(async (): Promise<BulkStatusAttempt> => ({ ok: true }));
    const report = await runBulkStatusChange([target("1", "reserved")], "reserved", attempt);

    expect(attempt).not.toHaveBeenCalled();
    expect(report.changed).toEqual([]);
    expect(report.rejected[0]).toMatchObject({ orderId: "1", reason: "already-in-target" });
  });

  it("zamówienie spoza zbioru tenanta jest w raporcie, a nie znika po cichu", async () => {
    const attempt = vi.fn(async (): Promise<BulkStatusAttempt> => ({ ok: true }));
    const report = await runBulkStatusChange([target("obce", null)], "reserved", attempt);

    expect(attempt).not.toHaveBeenCalled();
    expect(report.rejected[0]).toMatchObject({ orderId: "obce", reason: "not-found" });
  });

  it("zero dosięgniętych wierszy to odmowa (ktoś zdążył zmienić status)", async () => {
    const report = await runBulkStatusChange([target("1", "pending")], "reserved", async () => ({
      ok: false,
      reason: "changed-meanwhile",
    }));

    expect(report.changed).toEqual([]);
    expect(report.rejected[0]!.reason).toBe("changed-meanwhile");
  });

  it("kolejność raportu jest kolejnością zaznaczenia", async () => {
    const targets = ["1", "2", "3", "4"].map((id) => target(id, "pending"));
    const seen: string[] = [];
    await runBulkStatusChange(targets, "reserved", async (t) => {
      seen.push(t.orderId);
      return { ok: true };
    });

    expect(seen).toEqual(["1", "2", "3", "4"]);
  });
});

describe("masowa zmiana statusu: podsumowanie nie zaokrągla w górę", () => {
  it("część zmieniona + część odrzucona to „partial”, nigdy „all”", () => {
    const report = {
      to: "reserved" as const,
      changed: [{ orderId: "1", orderNumber: "ZAM/1", from: "pending" as const }],
      rejected: [
        {
          orderId: "2",
          orderNumber: "ZAM/2",
          from: "picked_up" as const,
          reason: "illegal-transition" as const,
        },
      ],
    };
    expect(bulkStatusOutcome(report)).toBe("partial");
  });

  it("„all” wymaga ZERA odrzuceń, „none” — zera zmian", () => {
    const entry = { orderId: "1", orderNumber: "ZAM/1", from: "pending" as const };
    expect(bulkStatusOutcome({ to: "reserved", changed: [entry], rejected: [] })).toBe("all");
    expect(bulkStatusOutcome({ to: "reserved", changed: [], rejected: [entry] })).toBe("none");
    // Pusty raport nie jest sukcesem.
    expect(bulkStatusOutcome({ to: "reserved", changed: [], rejected: [] })).toBe("none");
  });
});

describe("masowa zmiana statusu: mapowanie odmów bazy", () => {
  it("kody z migracji 0010 mają nazwy, reszta ląduje jako „unknown”", () => {
    expect(rejectReasonFromCode("23514")).toBe("illegal-transition");
    expect(rejectReasonFromCode("23001")).toBe("cancel-blocked");
    expect(rejectReasonFromCode("23P01")).toBe("unit-conflict");
    expect(rejectReasonFromCode("42501")).toBe("unknown");
    expect(rejectReasonFromCode(undefined)).toBe("unknown");
  });
});

describe("masowa zmiana statusu: walidacja wejścia", () => {
  const formData = (ids: string[], to: string) => {
    const data = new FormData();
    for (const id of ids) data.append("orderId", id);
    data.set("to", to);
    return data;
  };

  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  it("przyjmuje zaznaczenie i cel z formularza", () => {
    const parsed = bulkStatusChangeSchema.safeParse(
      bulkStatusChangeFromFormData(formData([id(1), id(2)], "reserved")),
    );
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.orderIds).toEqual([id(1), id(2)]);
  });

  it("odrzuca puste zaznaczenie i nieznany status", () => {
    expect(bulkStatusChangeSchema.safeParse(bulkStatusChangeFromFormData(formData([], "reserved"))).success).toBe(
      false,
    );
    expect(
      bulkStatusChangeSchema.safeParse(bulkStatusChangeFromFormData(formData([id(1)], "wysłane"))).success,
    ).toBe(false);
  });

  it("odróżnia powtórzone identyfikatory (druga odmowa byłaby myląca)", () => {
    const parsed = bulkStatusChangeSchema.parse(
      bulkStatusChangeFromFormData(formData([id(1), id(1), id(2)], "reserved")),
    );
    expect(parsed.orderIds).toEqual([id(1), id(2)]);
  });
});
