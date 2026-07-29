/**
 * Walidacja schematów notatek zamówienia (lista wpisów, ADR-079) — bramka CI
 * bez Supabase. Dowodzi kształtu wejścia akcji add/edit/delete z notes-core.ts:
 * pusta treść odrzucana z komunikatem przy polu `body`, limit == CHECK-owi
 * bazy (0039), identyfikatory spoza UUID nie docierają do zapytania.
 */
import { describe, expect, it } from "vitest";

import {
  addOrderNoteSchema,
  deleteOrderNoteSchema,
  editOrderNoteSchema,
  NOTE_BODY_MAX,
} from "@/app/[locale]/(panel)/zamowienia/[id]/notes-core";

const ORDER_ID = "11111111-2222-4333-8444-555555555555";
const NOTE_ID = "99999999-8888-4777-8666-555555555555";

describe("addOrderNoteSchema", () => {
  it("przycina treść, ale nie okraja jej ze środka", () => {
    const parsed = addOrderNoteSchema.safeParse({
      orderId: ORDER_ID,
      body: "  Kabel porysowany.\nKaucja pomniejszona.  ",
    });
    expect(parsed.success && parsed.data.body).toBe("Kabel porysowany.\nKaucja pomniejszona.");
  });

  it("pusta treść (same spacje) jest odrzucana z komunikatem przy polu body", () => {
    const parsed = addOrderNoteSchema.safeParse({ orderId: ORDER_ID, body: "   " });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.path).toEqual(["body"]);
  });

  it("treść ponad limit jest odrzucana, nie ucinana", () => {
    const parsed = addOrderNoteSchema.safeParse({
      orderId: ORDER_ID,
      body: "x".repeat(NOTE_BODY_MAX + 1),
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]!.path).toEqual(["body"]);
  });

  it("treść dokładnie na granicy limitu przechodzi", () => {
    expect(
      addOrderNoteSchema.safeParse({ orderId: ORDER_ID, body: "x".repeat(NOTE_BODY_MAX) }).success,
    ).toBe(true);
  });

  it("identyfikator zamówienia spoza kształtu UUID nie dociera do bazy", () => {
    expect(addOrderNoteSchema.safeParse({ orderId: "nie-uuid", body: "x" }).success).toBe(false);
  });
});

describe("editOrderNoteSchema", () => {
  it("wymaga UUID wpisu i niepustej treści", () => {
    expect(editOrderNoteSchema.safeParse({ noteId: NOTE_ID, body: "Nowa treść" }).success).toBe(true);
    expect(editOrderNoteSchema.safeParse({ noteId: NOTE_ID, body: "  " }).success).toBe(false);
    expect(editOrderNoteSchema.safeParse({ noteId: "nie-uuid", body: "x" }).success).toBe(false);
  });
});

describe("deleteOrderNoteSchema", () => {
  it("wymaga wyłącznie UUID wpisu", () => {
    expect(deleteOrderNoteSchema.safeParse({ noteId: NOTE_ID }).success).toBe(true);
    expect(deleteOrderNoteSchema.safeParse({ noteId: "nie-uuid" }).success).toBe(false);
  });
});
