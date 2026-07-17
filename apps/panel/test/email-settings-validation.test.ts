import { describe, expect, it } from "vitest";

import {
  emailSenderInputFromFormData,
  emailSenderSchema,
} from "@/app/[locale]/ustawienia-emaili/email-settings-validation";

describe("emailSenderSchema (lustro CHECK 0014)", () => {
  it("przycina nazwę i produkuje snake_case bez reply_to", () => {
    const r = emailSenderSchema.safeParse({ name: "  Demo  ", replyTo: "" });
    expect(r.success && r.data).toEqual({ name: "Demo" });
  });

  it("dokłada reply_to (przycięty) gdy podany", () => {
    const r = emailSenderSchema.safeParse({ name: "Demo", replyTo: " biuro@demo.pl " });
    expect(r.success && r.data).toEqual({ name: "Demo", reply_to: "biuro@demo.pl" });
  });

  it("pusta nazwa (same spacje) odrzucona", () => {
    expect(emailSenderSchema.safeParse({ name: "   ", replyTo: "" }).success).toBe(false);
  });

  it("nazwa > 120 po btrim odrzucona", () => {
    expect(emailSenderSchema.safeParse({ name: "x".repeat(121), replyTo: "" }).success).toBe(false);
  });

  it("nazwa == 120 przyjęta", () => {
    expect(emailSenderSchema.safeParse({ name: "x".repeat(120), replyTo: "" }).success).toBe(true);
  });

  it("reply_to krótsze niż 3 odrzucone", () => {
    expect(emailSenderSchema.safeParse({ name: "Demo", replyTo: "ab" }).success).toBe(false);
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
