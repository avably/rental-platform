/**
 * Status zaproszenia liczony z faktów (L4, ADR-105) — `lib/invitations.ts`.
 *
 * Do L4 ekran liczył status jako `accepted_at ? accepted : pending`, więc
 * zaproszenie WYGASŁE pokazywał jako „Oczekuje": operator widział sprawę
 * otwartą przy linku, który nikogo już nie wpuści, a zaproszony czekał na
 * dostęp, którego nie dostanie. Te testy pilnują czterech stanów i — co
 * ważniejsze — PIERWSZEŃSTWA między nimi, bo znaczniki mogą wystąpić razem.
 */
import { describe, expect, it } from "vitest";

import { invitationIsOpen, invitationStatus } from "@/lib/invitations";

const NOW = new Date("2026-08-08T12:00:00Z");
const FUTURE = "2026-08-15T12:00:00Z";
const PAST = "2026-08-01T12:00:00Z";

describe("invitationStatus", () => {
  it("świeże, niewykorzystane zaproszenie oczekuje", () => {
    expect(
      invitationStatus({ accepted_at: null, revoked_at: null, expires_at: FUTURE }, NOW),
    ).toBe("pending");
  });

  it("zaproszenie po dacie ważności jest WYGASŁE, nie oczekujące", () => {
    expect(invitationStatus({ accepted_at: null, revoked_at: null, expires_at: PAST }, NOW)).toBe(
      "expired",
    );
  });

  it("odwołane zaproszenie jest odwołane", () => {
    expect(
      invitationStatus(
        { accepted_at: null, revoked_at: "2026-08-05T10:00:00Z", expires_at: FUTURE },
        NOW,
      ),
    ).toBe("revoked");
  });

  it("wykorzystane bije odwołanie i wygaśnięcie — członkostwo już powstało", () => {
    expect(
      invitationStatus(
        {
          accepted_at: "2026-08-02T10:00:00Z",
          revoked_at: "2026-08-05T10:00:00Z",
          expires_at: PAST,
        },
        NOW,
      ),
    ).toBe("accepted");
  });

  it("odwołanie bije wygaśnięcie — powodem odmowy jest decyzja, nie zegar", () => {
    expect(
      invitationStatus(
        { accepted_at: null, revoked_at: "2026-08-05T10:00:00Z", expires_at: PAST },
        NOW,
      ),
    ).toBe("revoked");
  });

  it("moment wygaśnięcia liczy się jako wygasłe (granica domknięta)", () => {
    expect(
      invitationStatus(
        { accepted_at: null, revoked_at: null, expires_at: NOW.toISOString() },
        NOW,
      ),
    ).toBe("expired");
  });
});

describe("invitationIsOpen", () => {
  it("odwołać i ponowić da się zaproszenie oczekujące oraz wygasłe", () => {
    expect(invitationIsOpen("pending")).toBe(true);
    expect(invitationIsOpen("expired")).toBe(true);
  });

  it("wykorzystanego i odwołanego już się nie wygasza", () => {
    expect(invitationIsOpen("accepted")).toBe(false);
    expect(invitationIsOpen("revoked")).toBe(false);
  });
});
