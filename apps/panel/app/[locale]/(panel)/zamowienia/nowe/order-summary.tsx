"use client";

/**
 * PODSUMOWANIE KWOTY NOWEGO ZAMÓWIENIA (U7, audyt 2.6 §1).
 *
 * ============ CO SIĘ ZMIENIŁO I DLACZEGO ============
 *
 * Podgląd wyceny istniał od R3, ale POJAWIAŁ SIĘ dopiero z kompletem
 * „pozycje + termin". Do tego momentu w prawej kolumnie nie było niczego:
 * ani kwoty, ani zdania, czego brakuje, żeby kwota się policzyła. Operator
 * przy telefonie widział pustkę i nie miał jak odróżnić „system jeszcze nie
 * policzył" od „ten ekran kwot nie pokazuje" — a to jest dokładnie ta
 * różnica, którą audyt zapisał jako „nigdzie nie widać kwoty".
 *
 * Teraz karta stoi ZAWSZE i ma stałe cztery wiersze — najem, kaucja, dostawa,
 * razem. Wiersz bez odpowiedzi pokazuje myślnik i JEDNO zdanie, czego brakuje;
 * nigdy „0,00 zł", bo zero jest kwotą, a nie brakiem odpowiedzi (ta sama
 * dyscyplina co przy cenach metod dostawy, ADR-030).
 *
 * ============ SKĄD BIORĄ SIĘ KWOTY ============
 *
 * Ten komponent NICZEGO NIE LICZY. Dostaje gotowy wynik silnika
 * (`priceOrderItems` → `calculatePrice`) i gotowy koszt dostawy
 * (`resolveDeliveryCost`) — te same funkcje, którymi akcja serwerowa wycenia
 * zamówienie przy zapisie na świeżo odczytanym cenniku. Drugi kalkulator
 * w komponencie ogłaszałby kwotę, której system potem nie policzy; tożsamość
 * podglądu z zapisem przypina test `order-preview-save-parity.test.tsx`,
 * porównując liczby z EKRANU z ładunkiem `app.create_order`.
 *
 * Kaucja stoi w rozbiciu, ale POZA sumą „razem": jest zwrotna, a doliczona do
 * kwoty najmu zawyżałaby to, co operator mówi klientowi przez telefon.
 */
import { formatMoney, type CurrencyCode, type DeliveryPriceSource } from "@avably/core";
import { useTranslations } from "next-intl";

import type { OrderPricing } from "../pricing";
import type { OrderBlocker } from "./readiness";

/** Wiersz bez odpowiedzi — myślnik, nigdy zero. */
const DASH = "—";

/** Powód → klucz słownika. Jeden zestaw zdań dla listy i dla przycisku. */
const BLOCKER_MESSAGE: Record<OrderBlocker, string> = {
  customer: "readinessCustomer",
  items: "readinessItems",
  term: "readinessTerm",
  pickupLocation: "readinessPickupLocation",
  deliveryPoint: "readinessDeliveryPoint",
  deliveryAddress: "readinessDeliveryAddress",
  deliveryPrice: "readinessDeliveryPrice",
  deliveryPricing: "deliveryPricingMissing",
  availability: "readinessAvailability",
};

/** Identyfikator listy braków — przycisk zapisu wskazuje ją `aria-describedby`. */
export const READINESS_LIST_ID = "order-readiness";

export interface DeliveryPreview {
  grosze: number | null;
  source: DeliveryPriceSource | null;
  problem: boolean;
}

export interface Shortage {
  productId: string;
  needed: number;
  free: number;
}

function Row({
  name,
  label,
  value,
  strong,
}: {
  name: string;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      data-summary-row={name}
      className={`flex justify-between gap-4 text-sm ${strong ? "border-border border-t pt-2 font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className="tabular-nums tracking-[0.01em]" data-summary-amount>
        {value}
      </span>
    </div>
  );
}

export function OrderSummary({
  pricing,
  delivery,
  blockers,
  shortages,
  productName,
  currency,
  locale,
}: {
  /** Wynik silnika dla koszyka i terminu; `null` = nie ma jeszcze czego liczyć. */
  pricing: OrderPricing | null;
  /** Rozstrzygnięty koszt dostawy albo `problem` (metoda płatna bez cennika). */
  delivery: DeliveryPreview | null;
  blockers: readonly OrderBlocker[];
  shortages: readonly Shortage[];
  productName: (productId: string) => string;
  currency: CurrencyCode;
  locale: string;
}) {
  const t = useTranslations("orders.form");
  const money = (grosze: number) => formatMoney(grosze, currency, locale);

  const deliveryGrosze = delivery && !delivery.problem ? delivery.grosze : null;
  const totalGrosze =
    pricing !== null && deliveryGrosze !== null ? pricing.totalRentalGrosze + deliveryGrosze : null;

  return (
    <section
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
      role="status"
      data-order-preview
      data-summary-state={pricing ? "priced" : "pending"}
    >
      <h2 className="text-base font-semibold">
        {pricing ? t("previewTitle", { days: pricing.days }) : t("summaryTitle")}
      </h2>

      {pricing ? (
        <ul className="flex flex-col gap-1 text-sm" data-summary-items>
          {pricing.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-4">
              <span>{productName(item.productId)}</span>
              <span className="tabular-nums tracking-[0.01em]">{money(item.rentalGrosze)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        <Row
          name="rental"
          label={t("totalRental")}
          value={pricing ? money(pricing.totalRentalGrosze) : DASH}
        />
        <Row
          name="deposit"
          label={t("totalDeposit")}
          value={pricing ? money(pricing.totalDepositGrosze) : DASH}
        />
        <Row
          name="delivery"
          label={
            delivery?.source === "manual"
              ? `${t("deliveryCost")} · ${t("deliveryPriceManualTag")}`
              : t("deliveryCost")
          }
          value={deliveryGrosze === null ? DASH : money(deliveryGrosze)}
        />
        <Row
          name="total"
          label={t("totalWithDelivery")}
          value={totalGrosze === null ? DASH : money(totalGrosze)}
          strong
        />
      </div>

      <p className="text-muted-foreground text-xs">
        {pricing ? t("summaryDepositNote") : t("summaryPending")}
      </p>

      {blockers.length === 0 ? (
        <p className="text-sm" data-order-ready>
          {t("readinessReady")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5" id={READINESS_LIST_ID} data-order-readiness>
          <p className="text-sm font-semibold">{t("readinessTitle")}</p>
          <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
            {blockers.map((blocker) => (
              <li key={blocker} data-blocker={blocker}>
                {t(BLOCKER_MESSAGE[blocker])}
                {blocker === "availability" ? (
                  <ul className="text-muted-foreground flex flex-col gap-0.5 pt-1 text-xs">
                    {shortages.map((shortage) => (
                      <li key={shortage.productId} data-shortage={shortage.productId}>
                        {t("shortage", {
                          product: productName(shortage.productId),
                          needed: shortage.needed,
                          free: shortage.free,
                        })}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
