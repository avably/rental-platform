/**
 * Warstwa domenowa konta Connect (Z2, ADR-065).
 *
 * Dwie rzeczy do udowodnienia:
 *   1. synchronizacja stanu NIE RZUCA i przy porażce NIE ZERUJE gotowości —
 *      awaria po naszej stronie nie ma prawa wyglądać jak „konto przestało
 *      działać",
 *   2. `payouts_enabled` nie zwija się z `charges_enabled` w jedno „gotowe".
 */
import { describe, expect, it } from "vitest";

import { canAcceptCharges, connectAccountStage, syncConnectAccountSafely } from "./account";
import { StripeApiError } from "./api";
import type { ConnectAccountState } from "./types";

const READY: ConnectAccountState = {
  providerAccountId: "acct_1",
  chargesEnabled: true,
  payoutsEnabled: true,
  detailsSubmitted: true,
  requirementsDue: [],
  disabledReason: null,
};

function clientReturning(state: ConnectAccountState) {
  return {
    createAccount: async () => state.providerAccountId,
    readAccount: async () => state,
    createOnboardingLink: async () => ({ url: "https://x.invalid", expiresAt: 0 }),
  };
}

function clientThrowing(error: unknown) {
  return {
    createAccount: async () => {
      throw error;
    },
    readAccount: async () => {
      throw error;
    },
    createOnboardingLink: async () => {
      throw error;
    },
  };
}

describe("syncConnectAccountSafely — uczciwa częściowa porażka", () => {
  it("sukces niesie stan i CZYŚCI zaległy powód", async () => {
    const result = await syncConnectAccountSafely("acct_1", { client: clientReturning(READY) });
    expect(result).toEqual({ ok: true, state: READY, error: null });
  });

  it("awaria dostawcy zwraca powód zamiast wyjątku", async () => {
    const result = await syncConnectAccountSafely("acct_1", {
      client: clientThrowing(new StripeApiError("API płatności odpowiedziało 503", 503)),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("503");
  });

  it("przy porażce state jest NULL — kolumny gotowości zostają nietknięte", async () => {
    // Gdyby wynik niósł tu wyzerowany stan, timeout po naszej stronie
    // pokazałby najemcy „konto przestało przyjmować płatności", a w Z3 ukryłby
    // płatność online. Awaria naszej sieci nie może zabierać najemcy pieniędzy.
    const result = await syncConnectAccountSafely("acct_1", {
      client: clientThrowing(new Error("ECONNRESET")),
    });

    expect(result.state).toBeNull();
  });

  it("łapie także błąd spoza portu (szeroki catch jest celowy)", async () => {
    const result = await syncConnectAccountSafely("acct_1", {
      client: clientThrowing("łańcuch zamiast błędu"),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("łańcuch");
  });

  it("skraca powód do długości znośnej dla kolumny i ekranu", async () => {
    const result = await syncConnectAccountSafely("acct_1", {
      client: clientThrowing(new Error("x".repeat(5_000))),
    });

    expect(result.error).toHaveLength(500);
  });
});

describe("dwie osi gotowości pozostają rozdzielne", () => {
  const restricted: ConnectAccountState = { ...READY, payoutsEnabled: false };
  const pending: ConnectAccountState = {
    ...READY,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirementsDue: ["individual.id_number"],
  };

  it("konto restricted PRZYJMUJE płatności", () => {
    expect(canAcceptCharges(restricted)).toBe(true);
  });

  it("ale nie jest gotowe — ma własny stan prezentacyjny", () => {
    expect(connectAccountStage(restricted)).toBe("payouts_blocked");
    expect(connectAccountStage(READY)).toBe("ready");
  });

  it("konto bez zdolności płatniczej jest w toku, niezależnie od wypłat", () => {
    expect(connectAccountStage(pending)).toBe("pending");
    expect(connectAccountStage({ ...pending, payoutsEnabled: true })).toBe("pending");
  });

  it("brak konta to osobny stan, nie w toku", () => {
    expect(connectAccountStage(null)).toBe("missing");
  });
});
