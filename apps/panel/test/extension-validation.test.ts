/**
 * Schemat akcji przedłużenia — lustro reguł, które autorytatywnie
 * egzekwuje silnik (data po obecnym końcu) i baza (bramka 0010).
 */
import { describe, expect, it } from "vitest";

import { orderExtensionSchema } from "@/lib/extension-validation";

const VALID = {
  orderId: "00000000-0000-4000-8000-000000000001",
  newEndDate: "2027-03-08",
  expectedEndDate: "2027-03-05",
};

describe("orderExtensionSchema", () => {
  it("poprawne wejście przechodzi", () => {
    expect(orderExtensionSchema.parse(VALID)).toEqual(VALID);
  });

  it.each([
    ["newEndDate równa expectedEndDate", { ...VALID, newEndDate: "2027-03-05" }],
    ["newEndDate przed expectedEndDate", { ...VALID, newEndDate: "2027-03-04" }],
    ["nieistniejąca data", { ...VALID, newEndDate: "2027-02-31" }],
    ["śmieciowa data", { ...VALID, newEndDate: "jutro" }],
    ["zepsuty uuid", { ...VALID, orderId: "nie-uuid" }],
  ])("odrzuca: %s", (_label, input) => {
    expect(orderExtensionSchema.safeParse(input).success).toBe(false);
  });
});
