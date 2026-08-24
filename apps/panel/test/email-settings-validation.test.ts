import { describe, expect, it } from "vitest";

import {
  emailSenderInputFromFormData,
  emailSenderSchema,
} from "@/app/[locale]/(panel)/ustawienia-emaili/email-settings-validation";

describe("emailSenderSchema (lustro CHECK 0014 + bloker reply_to ADR-241)", () => {
  it("przycina oba pola i produkuje snake_case { name, reply_to }", () => {
    const r = emailSenderSchema.safeParse({ name: "  Demo  ", replyTo: " biuro@demo.pl " });
    expect(r.success && r.data).toEqual({ name: "Demo", reply_to: "biuro@demo.pl" });
  });

  it("BLOKER (ADR-241): pusty reply_to odrzucony — panel wymaga adresu odpowiedzi", () => {
    // W bazie reply_to jest opcjonalne (CHECK 0014, ADR-036 D2/ADR-042), ale
    // panel jest świadomie surowszy: bez adresu odpowiedzi maile klientów giną.
    expect(emailSenderSchema.safeParse({ name: "Demo", replyTo: "" }).success).toBe(false);
  });

  it("BLOKER: same spacje w reply_to (po trim puste) odrzucone", () => {
    expect(emailSenderSchema.safeParse({ name: "Demo", replyTo: "   " }).success).toBe(false);
  });

  it("pusta nazwa (same spacje) odrzucona", () => {
    expect(emailSenderSchema.safeParse({ name: "   ", replyTo: "biuro@demo.pl" }).success).toBe(
      false,
    );
  });

  it("nazwa > 120 po btrim odrzucona", () => {
    expect(
      emailSenderSchema.safeParse({ name: "x".repeat(121), replyTo: "biuro@demo.pl" }).success,
    ).toBe(false);
  });

  it("nazwa == 120 przyjęta", () => {
    expect(
      emailSenderSchema.safeParse({ name: "x".repeat(120), replyTo: "biuro@demo.pl" }).success,
    ).toBe(true);
  });

  it("reply_to krótsze niż 3 odrzucone", () => {
    expect(emailSenderSchema.safeParse({ name: "Demo", replyTo: "ab" }).success).toBe(false);
  });

  it("reply_to == 3 przyjęte (dolna granica długości)", () => {
    expect(emailSenderSchema.safeParse({ name: "Demo", replyTo: "a@b" }).success).toBe(true);
  });

  it("reply_to > 320 odrzucone", () => {
    expect(emailSenderSchema.safeParse({ name: "Demo", replyTo: "a".repeat(321) }).success).toBe(
      false,
    );
  });
});

describe("emailSenderInputFromFormData", () => {
  it("czyta OBA pola (lekcja 8b: pole w schemacie ≠ pole odczytane z FormData)", () => {
    const fd = new FormData();
    fd.set("name", "Demo");
    fd.set("replyTo", "biuro@demo.pl");
    expect(emailSenderInputFromFormData(fd)).toEqual({ name: "Demo", replyTo: "biuro@demo.pl" });
  });

  it("brakujące pola dają puste stringi (nie undefined)", () => {
    expect(emailSenderInputFromFormData(new FormData())).toEqual({ name: "", replyTo: "" });
  });
});
