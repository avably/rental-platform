/**
 * Sekcja „Plan i rozliczenia" na /organizacja (J2 faza 1, ADR-135) — trzy
 * kontrakty, każdy pilnuje innej obietnicy:
 *
 *   1. PARYTET CEN EKRAN ↔ STAŁA. Kwoty na ekranie pochodzą WYŁĄCZNIE
 *      z SAAS_PLAN_PRICING (@avably/core) — asercje wyliczają oczekiwany
 *      tekst ZE STAŁEJ (nie z literału), więc cyfra zaszyta w komponencie
 *      albo w messages rozjeżdża się z obietnicą LP i pali ten test.
 *      (Samą stałą do decyzji właściciela przypina packages/core —
 *      pricing.test.ts; LP pilnuje własnej bramki w storefroncie.)
 *   2. TRIAL JAKO STAN PIERWSZEJ KLASY: brak wiersza subscriptions = trial
 *      z datą i stanem „trwa do / minął", nigdy komunikat błędu.
 *   3. ZERO ŚCIEŻEK PŁATNOŚCI (twarda granica fazy 1): w markupie sekcji
 *      nie ma <button>, <a>, <form> ani odwołań do checkoutu — CTA płatności
 *      to faza 2 i wchodzi świadomą decyzją, nie „przy okazji".
 */
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SAAS_PLAN_PRICING, SAAS_YEARLY_MONTHS_CHARGED } from "@avably/core";

import { PlanBillingSection } from "@/app/[locale]/(panel)/organizacja/plan-billing-section";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

const NOW = new Date("2026-08-11T12:00:00Z");
const FUTURE = "2026-08-20T10:00:00Z";
const PAST = "2026-07-01T10:00:00Z";

function render(
  props: {
    subscription?: { planId: string | null; status: string | null } | null;
    trialEndsAt?: string | null;
  } = {},
  locale: "pl" | "en" = "pl",
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pl" ? plMessages : enMessages}
      timeZone="Europe/Warsaw"
    >
      <PlanBillingSection
        subscription={props.subscription ?? null}
        trialEndsAt={props.trialEndsAt === undefined ? FUTURE : props.trialEndsAt}
        now={NOW}
      />
    </NextIntlClientProvider>,
  );
}

/**
 * Dokładnie ten sam format kwoty, którego używa komponent — pełne złote,
 * grupowanie ZAWSZE (typografia LP: „1 990 zł", nie „1990 zł").
 */
const zl = (grosze: number, locale = "pl") =>
  new Intl.NumberFormat(locale, { useGrouping: "always" }).format(grosze / 100);

describe("parytet cen ekran ↔ stała SAAS_PLAN_PRICING", () => {
  it("każdy plan pokazuje cenę miesięczną i roczną wyliczoną ZE STAŁEJ (pl)", () => {
    const html = render();
    for (const plan of SAAS_PLAN_PRICING) {
      expect(html, `${plan.id}: cena miesięczna`).toContain(
        `${zl(plan.monthlyNetGrosze)} zł netto/mies.`,
      );
      expect(html, `${plan.id}: cena roczna`).toContain(`Rocznie ${zl(plan.yearlyNetGrosze)} zł netto`);
    }
    expect(html).toContain(`rok w cenie ${SAAS_YEARLY_MONTHS_CHARGED} miesięcy`);
  });

  it("EN niesie te same kwoty ze stałej", () => {
    const html = render({}, "en");
    for (const plan of SAAS_PLAN_PRICING) {
      expect(html, `${plan.id}: monthly`).toContain(`PLN ${zl(plan.monthlyNetGrosze, "en")} net a month`);
      expect(html, `${plan.id}: yearly`).toContain(`PLN ${zl(plan.yearlyNetGrosze, "en")} net for a year`);
    }
  });

  it("obietnice LP padają co do słowa: netto, bez umowy na rok, bez opłaty wdrożeniowej", () => {
    const html = render();
    expect(html).toMatch(/netto/);
    // Typografia kwot jak na LP: „1 990" (NBSP), nie „1990" — pl domyślnie
    // nie grupuje 4 cyfr, komponent wymusza useGrouping "always".
    expect(html).toContain("Rocznie 1 990 zł netto");
    expect(html).toContain("Bez umowy na rok i bez opłaty wdrożeniowej.");
    expect(html).toContain("23% VAT");
    // Premium jest pokazywane, ale nie sprzedawane (LP: „Wkrótce").
    expect(html).toContain("Wkrótce");
  });

  it("komunikat aktywacji płatności jest spójny z FAQ LP (przed startem komercyjnym, mailem)", () => {
    const html = render();
    expect(html).toContain(
      "Płatność abonamentu włączymy przed startem komercyjnym — odezwiemy się mailem, zanim cokolwiek zacznie kosztować.",
    );
  });
});

describe("trial jako stan pierwszej klasy (brak wiersza subscriptions)", () => {
  it("trial w toku: stan (trwa do) z datą w strefie Europe/Warsaw", () => {
    const html = render({ trialEndsAt: FUTURE });
    expect(html).toContain("Okres próbny — trwa do 20.08.2026.");
    expect(html).not.toContain("minął");
  });

  it("trial miniony: stan (minął) z datą — i obietnica, że nic się samo nie zdarza", () => {
    const html = render({ trialEndsAt: PAST });
    expect(html).toContain("Okres próbny — minął 01.07.2026.");
    expect(html).toContain("nic się samo nie zdarzy");
  });

  it("trial bez daty (wiersz spoza app.create_tenant): stan bez daty, nie błąd", () => {
    const html = render({ trialEndsAt: null });
    expect(html).toContain("Okres próbny.");
  });

  it("wiersz subscriptions wygrywa z trialem: plan + status ze słownika", () => {
    const html = render({
      subscription: { planId: "pro", status: "active" },
      trialEndsAt: PAST,
    });
    expect(html).toContain("Plan pro — Aktywny");
    expect(html).not.toContain("minął");
  });
});

describe("zero ścieżek płatności (twarda granica fazy 1)", () => {
  it.each([
    ["trial w toku", { trialEndsAt: FUTURE }],
    ["trial miniony", { trialEndsAt: PAST }],
    ["subskrypcja", { subscription: { planId: "pro", status: "active" }, trialEndsAt: PAST }],
  ] as const)("%s: żadnego <button>/<a>/<form> ani checkoutu w markupie", (_name, props) => {
    const html = render(props);
    expect(html).not.toMatch(/<button\b/i);
    expect(html).not.toMatch(/<a\b/i);
    expect(html).not.toMatch(/<form\b/i);
    expect(html.toLowerCase()).not.toContain("checkout");
    expect(html.toLowerCase()).not.toContain("stripe");
  });
});
