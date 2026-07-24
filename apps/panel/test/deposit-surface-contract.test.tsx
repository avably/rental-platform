/**
 * Kontrakt POWIERZCHNI kaucji po uproszczeniu (uwagi właściciela D7/N5/N6).
 *
 * Uproszczenie UX jest tu regułą, nie wyglądem, i dlatego ma test: „jeden
 * przycisk, szczegóły w modalu, rejestr schowany" rozjeżdża się przy pierwszym
 * dołożonym formularzu, a rozjazd widać dopiero na ekranie, gdy właściciel
 * po niego sięgnie.
 *
 * DWIE Z TYCH REGUŁ NIE SĄ ESTETYCZNE:
 *   1. w obiegu dostawcy NIE MA formularza pobrania — ręczny wiersz `manual`
 *      obok automatycznego podwoiłby saldo i pozwolił zlecić zwrot kwoty,
 *      której dostawca nigdy nie pobrał,
 *   2. „zwrot w toku" zostaje NA WIERZCHU, poza rozwijanymi szczegółami —
 *      schowany, dawałby obraz nieodróżnialny od „nikt jeszcze nic nie
 *      zrobił", czyli zaproszenie do drugiej wypłaty tej samej kaucji.
 *
 * Szczegół zamówienia jest asynchronicznym server componentem z odczytami
 * z Supabase, więc — jak reszta suity panelu — bronimy WYDZIELONYCH kawałków
 * renderem i układu strony skanem źródła.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import messages from "../messages/pl.json";

import { DepositForms } from "@/app/[locale]/(panel)/zamowienia/[id]/deposit-forms";
import { OrderNotes } from "@/app/[locale]/(panel)/zamowienia/[id]/order-notes";
import type { FormState } from "@/lib/form-state";

const noop = async (): Promise<FormState> => ({});

function renderDeposit(overrides: { online: boolean; refundInFlight?: boolean } ): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <DepositForms
        orderId="11111111-2222-4333-8444-555555555555"
        balanceGrosze={50_000}
        collectedGrosze={50_000}
        suggestedCollectGrosze={0}
        currency="PLN"
        locale="pl"
        online={overrides.online}
        refundInFlight={overrides.refundInFlight ?? false}
        actions={{ collect: noop, settle: noop }}
      />
    </NextIntlClientProvider>,
  );
}

const pageSource = readFileSync(
  resolve(__dirname, "../app/[locale]/(panel)/zamowienia/[id]/page.tsx"),
  "utf8",
);
const modalSource = readFileSync(
  resolve(__dirname, "../app/[locale]/(panel)/zamowienia/[id]/deposit-refund-modal.tsx"),
  "utf8",
);

describe("powierzchnia kaucji — jeden przycisk, szczegóły w modalu (D7/N5)", () => {
  it("obieg dostawcy: jeden przycisk zwrotu i ANI JEDNEGO pola kwoty na wierzchu", () => {
    const html = renderDeposit({ online: true });

    expect(html).toContain(messages.orders.deposit.refundCta);
    expect(html).toContain(messages.orders.deposit.trackOnline);
    // Pola kwot mieszkają w modalu; przed jego otwarciem nie ma ich w DOM-ie.
    expect(html).not.toContain('name="amount"');
    expect(html).not.toContain('name="refundAmount"');
    expect(html).not.toContain('name="deductAmount"');
    // Formularz pobrania to bramka, nie ozdoba — patrz nagłówek pliku.
    expect(html).not.toContain(messages.orders.deposit.collectCta);
  });

  it("obieg ręczny: pobranie rejestruje człowiek i JEST oznaczone jako ręczne", () => {
    const html = renderDeposit({ online: false });

    expect(html).toContain(messages.orders.deposit.collectCta);
    expect(html).toContain(messages.orders.deposit.trackManual);
    expect(html).not.toContain(messages.orders.deposit.trackOnline);
    // Zwrot idzie tym samym jednym przyciskiem co online — różni się skutek,
    // nie liczba rzeczy do kliknięcia.
    expect(html).toContain(messages.orders.deposit.refundCta);
  });

  it("zwrot w toku wygasza przycisk i mówi dlaczego", () => {
    const html = renderDeposit({ online: true, refundInFlight: true });

    expect(html).toContain(messages.orders.deposit.refundInFlightBlocked);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Zwróć kaucję/);
  });

  it("modal pyta o potrącenie i zwrot w JEDNYM formularzu", () => {
    // Rozdział na dwa żądania zostawiał stany, w których potrącenie jest
    // zaksięgowane, a zwrot nie — czyli rejestr mówiący „zabraliśmy kaucję".
    const forms = modalSource.match(/<form\b/g) ?? [];
    expect(forms).toHaveLength(1);
    for (const field of ["refundAmount", "deductAmount", "deductReasonCode", "deductReason"]) {
      expect(modalSource).toContain(`name="${field}"`);
    }
  });

  it("rejestr zdarzeń zjechał do rozwijanych szczegółów, a ostrzeżenia NIE", () => {
    const details = pageSource.indexOf("<details");
    const ledger = pageSource.indexOf('tDeposit("colBalance")');
    const inFlight = pageSource.indexOf('tDeposit(`refundStatus.');
    const surface = pageSource.indexOf("<DepositForms");

    expect(details).toBeGreaterThan(-1);
    // Chronologia z saldami jest DOWODEM w sporze — czyta się ją, gdy spór jest.
    expect(ledger).toBeGreaterThan(details);
    // „Zwrot w toku" jest OSTRZEŻENIEM — stoi nad rozwijanymi szczegółami.
    expect(inFlight).toBeLessThan(details);
    // Działanie przed dowodem: saldo i przycisk otwierają sekcję.
    expect(surface).toBeLessThan(inFlight);
  });
});

describe("notatki zamówienia (N6)", () => {
  it("pole edycji istnieje i niesie dotychczasową treść", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
        <OrderNotes
          orderId="11111111-2222-4333-8444-555555555555"
          notes="Kabel porysowany."
          action={noop}
        />
      </NextIntlClientProvider>,
    );

    expect(html).toContain('name="notes"');
    expect(html).toContain("Kabel porysowany.");
    expect(html).toContain(messages.orders.notes.saveCta);
  });

  it("szczegół zamówienia renderuje edytor, a nie sam odczyt notatki", () => {
    expect(pageSource).toContain("<OrderNotes");
    expect(pageSource).toContain("updateOrderNotesAction");
  });
});
