import {
  formatMoney,
  type CurrencyCode,
  type OrderStatus,
  type PaymentStatus,
  type ShipmentStatus,
} from "@avably/core";
import { cn } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";

/**
 * Oś czasu zamówienia (uwaga przeglądu D5) — poziomy stepper, który zastępuje
 * rząd chipów statusu (`OrderStatusAxes`). Pięć kroków domenowych: złożenie
 * zamówienia → płatność → wysyłka/wydanie → zwrot → kaucja.
 *
 * Komponent jest CZYSTO PREZENTACYJNY, jak zastąpione `OrderStatusAxes`:
 * stany kroków WYLICZA `deriveOrderTimeline` z danych, które szczegół i tak
 * ma na wejściu (status zamówienia i płatności, status przesyłki, daty, stan
 * kaucji). Zero nowych odczytów, zero zdarzeń „dla kompletu". Dzięki temu
 * `order-detail-presentation.test.tsx` renderuje go na fixture WSZYSTKICH
 * stanów — szczegół jest asynchronicznym server componentem z odczytami z
 * Supabase, więc kontrakt renderu nie ma jak go wywołać, ale ten wydzielony
 * komponent maluje dokładnie ten sam stepper.
 */

export type TimelineStepKey = "order" | "payment" | "shipment" | "return" | "deposit";

/** Cztery stany kroku niosące ODRÓŻNIALNY kształt kropki, nie sam kolor. */
export type TimelineStepState = "done" | "current" | "upcoming" | "cancelled";

export interface OrderTimelineDeposit {
  /** total_deposit_grosze > 0 — kaucja jest wymagana przez zamówienie. */
  required: boolean;
  collectedGrosze: number;
  balanceGrosze: number;
  /** isDepositSettled — pobrano coś i saldo wróciło do zera. */
  settled: boolean;
}

export interface OrderTimelineInput {
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  /** null = zamówienie bez przesyłki (odbiór osobisty). */
  shipmentStatus: ShipmentStatus | null;
  createdAt: string;
  /** Planowany zwrot — górna granica terminu najmu (YYYY-MM-DD). */
  endDate: string;
  /** Data nadania ostatniej przesyłki albo null (brak przesyłki). */
  shipmentDispatchedAt: string | null;
  deposit: OrderTimelineDeposit;
}

/**
 * Podpis kroku jako OPIS SEMANTYCZNY, nie gotowy tekst — lokalizację i
 * formatowanie robi komponent, dzięki czemu `deriveOrderTimeline` zostaje
 * czystą funkcją bez i18n (testowalną na samych stanach).
 */
type TimelineCaption =
  | { kind: "date"; at: string }
  | { kind: "dueBy"; at: string }
  | { kind: "payment"; value: PaymentStatus }
  | { kind: "money"; grosze: number }
  | { kind: "text"; id: string };

export interface DerivedTimelineStep {
  key: TimelineStepKey;
  state: TimelineStepState;
  caption: TimelineCaption;
}

/** Statusy płatności, w których pieniądze KLIENTA już wpłynęły (krok „done”). */
const PAID_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "paid",
  "manual",
  "completed",
  "deposit_refunded",
  "refunded",
];

/** Statusy zamówienia, w których sprzęt jest już u klienta. */
const HANDED_OVER_ORDER_STATUSES: readonly OrderStatus[] = ["picked_up", "returned"];

/**
 * Wylicza pięć kroków osi WYŁĄCZNIE z danych wejściowych szczegółu. Każdy krok
 * ma własne kryterium „zrobiony”/„anulowany”; jedyny krok „bieżący” (obwódka)
 * to pierwszy nierozstrzygnięty krok w kolejności — tak stepper pokazuje „tu
 * jesteś”. Zamówienie anulowane nie ma kroku bieżącego: martwy obieg nie ma
 * „następnego ruchu”.
 */
export function deriveOrderTimeline(input: OrderTimelineInput): DerivedTimelineStep[] {
  const orderCancelled = input.orderStatus === "cancelled";

  const paymentDone = PAID_PAYMENT_STATUSES.includes(input.paymentStatus);
  const paymentCancelled = input.paymentStatus === "cancelled";

  const shipmentDone =
    input.shipmentStatus === "in_transit" ||
    input.shipmentStatus === "delivered" ||
    HANDED_OVER_ORDER_STATUSES.includes(input.orderStatus);
  const shipmentCancelled =
    input.shipmentStatus === "cancelled" || input.shipmentStatus === "returned_to_sender";

  const returnDone =
    input.orderStatus === "returned" || input.shipmentStatus === "returned_to_sender";

  const depositNotApplicable = !input.deposit.required && input.deposit.collectedGrosze === 0;
  const depositHeld = input.deposit.collectedGrosze > 0 && input.deposit.balanceGrosze > 0;
  const depositDone = input.deposit.settled || depositNotApplicable;

  const shipmentCaption: TimelineCaption = input.shipmentDispatchedAt
    ? { kind: "date", at: input.shipmentDispatchedAt }
    : shipmentDone
      ? { kind: "text", id: "handedOver" }
      : { kind: "text", id: "awaiting" };

  const depositCaption: TimelineCaption = depositNotApplicable
    ? { kind: "text", id: "noDeposit" }
    : input.deposit.settled
      ? { kind: "text", id: "depositSettled" }
      : depositHeld
        ? { kind: "money", grosze: input.deposit.balanceGrosze }
        : { kind: "text", id: "depositDue" };

  const steps: {
    key: TimelineStepKey;
    done: boolean;
    cancelled: boolean;
    caption: TimelineCaption;
  }[] = [
    {
      key: "order",
      done: !orderCancelled,
      cancelled: orderCancelled,
      caption: { kind: "date", at: input.createdAt },
    },
    {
      key: "payment",
      done: paymentDone,
      cancelled: paymentCancelled,
      caption: { kind: "payment", value: input.paymentStatus },
    },
    {
      key: "shipment",
      done: shipmentDone,
      cancelled: shipmentCancelled,
      caption: shipmentCaption,
    },
    {
      key: "return",
      done: returnDone,
      cancelled: false,
      caption: returnDone
        ? { kind: "text", id: "returned" }
        : { kind: "dueBy", at: input.endDate },
    },
    {
      key: "deposit",
      done: depositDone,
      cancelled: false,
      caption: depositCaption,
    },
  ];

  const frontier = orderCancelled
    ? -1
    : steps.findIndex((step) => !step.done && !step.cancelled);

  return steps.map((step, index) => ({
    key: step.key,
    caption: step.caption,
    state: step.cancelled
      ? "cancelled"
      : step.done
        ? "done"
        : index === frontier
          ? "current"
          : "upcoming",
  }));
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" aria-hidden="true">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const DOT_STATE_CLASS: Record<TimelineStepState, string> = {
  done: "border-transparent bg-primary text-primary-foreground",
  current: "border-2 border-primary bg-background text-primary",
  upcoming: "border-border bg-background text-muted-foreground",
  cancelled: "border-destructive/40 bg-background text-destructive",
};

export function OrderTimeline({
  currency,
  ...input
}: OrderTimelineInput & { currency: CurrencyCode }) {
  const t = useTranslations("orders.timeline");
  const tStatus = useTranslations("orders.statusLabels");
  const locale = useLocale();
  const steps = deriveOrderTimeline(input);

  const formatDate = (value: string, dayOnly: boolean) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: dayOnly ? "UTC" : "Europe/Warsaw",
    }).format(new Date(dayOnly ? `${value}T00:00:00Z` : value));

  const renderCaption = (caption: TimelineCaption) => {
    switch (caption.kind) {
      case "date":
        return formatDate(caption.at, false);
      case "dueBy":
        return t("captions.dueBy", { date: formatDate(caption.at, true) });
      case "payment":
        return tStatus(`payment.${caption.value}` as Parameters<typeof tStatus>[0]);
      case "money":
        return t("captions.depositHeld", {
          amount: formatMoney(caption.grosze, currency, locale),
        });
      case "text":
        return t(`captions.${caption.id}` as Parameters<typeof t>[0]);
    }
  };

  return (
    <ol
      data-order-timeline
      aria-label={t("ariaLabel")}
      className="flex flex-col md:flex-row"
    >
      {steps.map((step, index) => (
        <li
          key={step.key}
          data-timeline-step={step.key}
          data-step-state={step.state}
          className="relative flex flex-1 items-start gap-3 pb-6 last:pb-0 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center"
        >
          {index > 0 ? (
            <span
              aria-hidden="true"
              className="bg-border absolute left-[13.5px] top-0 h-6 w-px -translate-y-full md:left-auto md:right-1/2 md:top-[13.5px] md:h-px md:w-full md:translate-y-0"
            />
          ) : null}

          <span
            aria-hidden="true"
            className={cn(
              "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
              DOT_STATE_CLASS[step.state],
            )}
          >
            {step.state === "done" ? (
              <CheckGlyph />
            ) : step.state === "cancelled" ? (
              <CrossGlyph />
            ) : step.state === "current" ? (
              <span className="bg-primary h-2 w-2 rounded-full" />
            ) : null}
          </span>

          <div className="flex min-w-0 flex-col gap-0.5 pt-0.5 md:items-center md:pt-0">
            <span className="text-foreground text-[13px] leading-tight font-semibold">
              {t(`steps.${step.key}` as Parameters<typeof t>[0])}
              <span className="sr-only"> — {t(`states.${step.state}` as Parameters<typeof t>[0])}</span>
            </span>
            <span className="text-muted-foreground text-xs leading-tight tabular-nums">
              {renderCaption(step.caption)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
