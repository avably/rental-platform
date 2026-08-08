import { describe, expect, it } from "vitest";

import {
  COURIER_PARCEL_KEY,
  COURIER_SENDER_KEY,
  GLOBKURIER_CREDENTIALS_KEY,
  courierConfigFromSettings,
  CourierConfigError,
} from "@avably/core";

import {
  courierConfigItems,
  courierConfigSummaryPl,
} from "../app/[locale]/(panel)/zamowienia/[id]/courier-config-copy";

/**
 * U1 (audyt UX W3): braki konfiguracji kuriera pokazujemy najemcy w JEGO
 * języku („dane nadawcy przesyłki”), nie w nazwach kluczy ustawień.
 * Wejściem klasyfikacji są PRAWDZIWE problemy z parsera core — nie fixtury
 * pisane z pamięci — żeby zmiana brzmienia problemu w core nie rozjechała
 * mapowania po cichu.
 */

/** Problemy dokładnie tak, jak rzuca je parser core przy pustych ustawieniach. */
function realProblems(): string[] {
  try {
    courierConfigFromSettings([], null);
  } catch (err) {
    if (err instanceof CourierConfigError) return err.problems;
    throw err;
  }
  throw new Error("parser nie rzucił przy pustej konfiguracji — fixture martwa");
}

describe("braki konfiguracji kuriera w języku najemcy (U1)", () => {
  it("problemy z parsera core mapują się na komplet trzech wiader", () => {
    expect(courierConfigItems(realProblems())).toEqual([
      "integrationAccount",
      "sender",
      "parcel",
    ]);
  });

  it("hasło i pola konta to jedno wiadro — bez duplikatów", () => {
    const problems = [
      `${GLOBKURIER_CREDENTIALS_KEY}: brak/nieprawidłowe pola: email`,
      `${GLOBKURIER_CREDENTIALS_KEY}: brak zapisanego hasła (ustaw je w ustawieniach dostaw)`,
    ];
    expect(courierConfigItems(problems)).toEqual(["integrationAccount"]);
  });

  it("kolejność wiader jest stała (jak ekran ustawień), nie wejściowa", () => {
    const problems = [
      `brak ustawienia ${COURIER_PARCEL_KEY}`,
      `brak ustawienia ${COURIER_SENDER_KEY}`,
    ];
    expect(courierConfigItems(problems)).toEqual(["sender", "parcel"]);
  });

  it("problem bez rozpoznanego klucza spada do wiadra „pozostałe”", () => {
    expect(courierConfigItems(["coś zupełnie innego"])).toEqual(["other"]);
  });

  it("zdanie PL dla akcji nie zawiera nazw kluczy ustawień", () => {
    const sentence = courierConfigSummaryPl(realProblems());
    expect(sentence).toContain("konto integracji kuriera");
    expect(sentence).toContain("dane nadawcy przesyłki");
    expect(sentence).toContain("wymiary i wagę paczki");
    for (const key of [GLOBKURIER_CREDENTIALS_KEY, COURIER_SENDER_KEY, COURIER_PARCEL_KEY]) {
      expect(sentence).not.toContain(key);
    }
  });
});
