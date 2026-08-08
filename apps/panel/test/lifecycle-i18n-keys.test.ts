/**
 * Klucze i18n powierzchni WYGASZANIA (L4, ADR-105) rozwiązują się w OBU locale.
 *
 * Luka, którą to zamyka: bramka `messages-parity` pilnuje, że PL i EN mają te
 * same klucze, ale ŻADEN test nie sprawdza, czy klucz, o który prosi komponent,
 * w ogóle w tych plikach istnieje. Literówka w `t("removeQuestion")` przechodzi
 * przez typecheck, lint i cały pakiet testów, a wychodzi dopiero na ekranie
 * operatora — i to jako wypisany klucz zamiast zdania.
 *
 * Skan jest CELOWO wąski (pliki L4): szerszy objąłby powierzchnie spoza tego
 * zadania i mieszałby jego wynik z cudzym długiem. Wzorzec jest gotowy do
 * rozszerzenia na cały panel osobną zmianą.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import en from "../messages/en.json";
import pl from "../messages/pl.json";

const FILES = [
  "app/[locale]/(panel)/zaproszenia/row-forms.tsx",
  "app/[locale]/(panel)/zaproszenia/page.tsx",
  "app/[locale]/(auth)/register/sprawdz-skrzynke/form.tsx",
  "app/[locale]/(auth)/register/sprawdz-skrzynke/page.tsx",
  // Także AKCJA: komunikaty ponowienia składa serwer (getTranslations), więc
  // literówka w kluczu wychodziłaby dopiero po kliknięciu przycisku.
  "app/[locale]/(auth)/register/sprawdz-skrzynke/actions.ts",
  "app/[locale]/(panel)/zamowienia/[id]/delivery-forms.tsx",
];

/**
 * Klucze `t("…")` skwalifikowane namespace'em, w którym faktycznie stoją.
 *
 * Plik bywa domem kilku komponentów z RÓŻNYMI namespace'ami (np. `row-forms.tsx`:
 * `invitations.team` i `invitations.lifecycle`), więc przypisanie jednego
 * namespace'u na plik sprawdzałoby nie te klucze co trzeba. Tniemy źródło na
 * odcinki od jednego `useTranslations`/`getTranslations` do następnego —
 * komponenty leżą w pliku po kolei, więc odcinek pokrywa się z zasięgiem `t`.
 */
function usedKeys(source: string): string[] {
  const anchors = [...source.matchAll(/(?:useTranslations|getTranslations)\("([^"]+)"\)/g)];
  return anchors.flatMap((anchor, index) => {
    const from = anchor.index! + anchor[0].length;
    const to = anchors[index + 1]?.index ?? source.length;
    return [...source.slice(from, to).matchAll(/\bt\("([^"]+)"/g)].map(
      (m) => `${anchor[1]!}.${m[1]!}`,
    );
  });
}

function resolveKey(messages: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[part]
          : undefined,
      messages,
    );
}

const panelRoot = resolve(__dirname, "..");
const keys = FILES.flatMap((file) => usedKeys(readFileSync(resolve(panelRoot, file), "utf8")));

describe("klucze i18n ścieżek wygaszania (L4)", () => {
  it("skan objął realny zbiór kluczy (kontrola pozytywna)", () => {
    // Bez tej podłogi zepsuty regex dawałby pustą listę i zielony test.
    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(keys).toContain("invitations.team.removeQuestion");
    expect(keys).toContain("checkInbox.resendDone");
    expect(keys).toContain("orders.delivery.section.cancelShipmentCta");
  });

  it("każdy używany klucz ma tekst w PL i w EN", () => {
    const missing = keys.flatMap((key) => {
      const inPl = resolveKey(pl, key);
      const inEn = resolveKey(en, key);
      const gaps: string[] = [];
      if (typeof inPl !== "string" || inPl.length === 0) gaps.push(`pl: ${key}`);
      if (typeof inEn !== "string" || inEn.length === 0) gaps.push(`en: ${key}`);
      return gaps;
    });

    expect(missing, `klucze bez tekstu:\n${missing.join("\n")}`).toEqual([]);
  });

  it("wykrywa brakujący klucz (kontrola negatywna)", () => {
    expect(resolveKey(pl, "invitations.team.nieMaTakiegoKlucza")).toBeUndefined();
  });
});
