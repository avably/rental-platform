import { describe, expect, it } from "vitest";

import {
  getWaitlistMessageKey,
  isWaitlistResultVisible,
  mapWaitlistResult,
  submitWaitlistInput,
  validateWaitlistInput,
} from "@/lib/waitlist-form-ui";
import type { WaitlistInput, WaitlistResult } from "@/lib/waitlist/contract";

function validInput(overrides: Partial<WaitlistInput> = {}): WaitlistInput {
  return {
    email: "owner@example.com",
    rentalType: "event",
    inventoryRange: "r21_100",
    currentProcess: "calendar_spreadsheet",
    consent: true,
    locale: "en",
    ...overrides,
  };
}

describe("waitlist form controller", () => {
  it("does not call the action without consent", async () => {
    let calls = 0;

    const result = await submitWaitlistInput(validInput({ consent: false }), async () => {
      calls += 1;
      return { status: "success" };
    });

    expect(calls).toBe(0);
    expect(result).toEqual({ status: "validation_error", fields: { consent: "required" } });
  });

  it("requires every qualification field before calling the action", () => {
    expect(
      validateWaitlistInput({
        email: "",
        rentalType: "" as WaitlistInput["rentalType"],
        inventoryRange: "" as WaitlistInput["inventoryRange"],
        currentProcess: "" as WaitlistInput["currentProcess"],
        consent: false,
      }),
    ).toEqual({
      email: "required",
      rentalType: "required",
      inventoryRange: "required",
      currentProcess: "required",
      consent: "required",
    });
  });

  it("requires equipment details only for the other rental type", () => {
    expect(validateWaitlistInput(validInput({ rentalType: "other" }))).toEqual({
      otherEquipment: "required",
    });
    expect(
      validateWaitlistInput(validInput({ rentalType: "other", otherEquipment: "Lighting rigs" })),
    ).toEqual({});
  });

  it("rejects a phone unless pilot interest is selected", () => {
    expect(validateWaitlistInput(validInput({ phone: "+48 600 000 000" }))).toEqual({
      phone: "not_allowed",
    });
  });

  it.each<[WaitlistResult, ReturnType<typeof mapWaitlistResult>]>([
    [{ status: "success" }, { kind: "success" }],
    [{ status: "duplicate" }, { kind: "duplicate" }],
    [{ status: "disabled" }, { kind: "disabled" }],
    [{ status: "rate_limited" }, { kind: "server_error" }],
    [{ status: "server_error" }, { kind: "server_error" }],
    [
      { status: "validation_error", fields: { email: "invalid" } },
      { kind: "validation", fields: { email: "invalid" } },
    ],
  ])("maps %# to an explicit view state", (result, expected) => {
    expect(mapWaitlistResult(result)).toEqual(expected);
  });

  it.each([
    [{ status: "success" } as WaitlistResult, "success"],
    [{ status: "duplicate" } as WaitlistResult, "duplicate"],
    [{ status: "disabled" } as WaitlistResult, "disabled"],
    [{ status: "rate_limited" } as WaitlistResult, "server"],
    [{ status: "server_error" } as WaitlistResult, "server"],
    [
      { status: "validation_error", fields: { email: "invalid" } } as WaitlistResult,
      "validation",
    ],
  ] as const)("maps %# to the correct message family", (result, expected) => {
    expect(getWaitlistMessageKey(mapWaitlistResult(result))).toBe(expected);
  });

  it.each(["success", "duplicate", "validation", "disabled", "server_error"] as const)(
    "keeps the %s result visible",
    (kind) => {
      expect(isWaitlistResultVisible(kind)).toBe(true);
    },
  );

  it.each(["idle", "submitting"] as const)("hides the %s result", (kind) => {
    expect(isWaitlistResultVisible(kind)).toBe(false);
  });

  it("keeps a connection failure distinct from a server response", () => {
    expect(isWaitlistResultVisible("connection_error")).toBe(true);
    expect(getWaitlistMessageKey({ kind: "connection_error" })).toBe("connection");
  });
});
