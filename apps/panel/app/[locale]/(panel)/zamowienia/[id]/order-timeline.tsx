"use client";

import {
  formatMoney,
  type CurrencyCode,
  type OrderStatus,
  type PaymentStatus,
  type ShipmentStatus,
} from "@avably/core";
import { cn } from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

/**
 * Oś czasu zamówienia (uwaga przeglądu D5, układ poziomy z R3) — poziomy
 * stepper, który zastępuje rząd chipów statusu (`OrderStatusAxes`). Pięć
 * kroków domenowych: złożenie zamówienia → płatność → wysyłka/wydanie →
 * zwrot → kaucja.
 *
 * Oś jest POZIOMA na każdej szerokości (uwaga właściciela R3). Na desktopie
 * pięć kroków dzieli szerokość równo (`flex-1`); na wąskim ekranie stają się
 * KARUZELĄ przewijaną w poziomie (`overflow-x-auto` + scroll-snap) zamiast
 * kolumny na pół ekranu wysokości. Przy wejściu karuzela ustawia się na kroku
 * BIEŻĄCYM (efekt niżej w `OrderTimeline`), żeby „tu jesteś" był widoczny od
 * razu, bez ręcznego przewijania. Technika jest neutralna silnikowo: przewijamy
 * WYŁĄCZNIE kontener osi (`scrollTo` z `behavior: "instant"`), więc strona nie
 * drga w pionie — bez `scrollIntoView` na kroku i bez sztuczek zależnych od
 * Chromium (właściciel testuje w Safari).
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

  // ZAMÓWIENIE ANULOWANE NIE OBIECUJE PRZYSZŁOŚCI (U3, audyt W4): krok,
  // który już się nie wydarzy, przestaje mówić „Oczekuje" / „do 20.08" /
  // „Do pobrania" — dostaje stan `cancelled` i podpis „Nie dotyczy".
  // Wyjątki są faktami, nie obietnicami:
  //   - krok DONE zostaje (zdarzył się, zanim zamówienie umarło),
  //   - płatność zachowuje swój podpis (status osi płatności to stan, nie
  //     zapowiedź — „Nieopłacone" na anulowanym jest prawdą),
  //   - kaucja z realnie trzymanym saldem (pobrana, nierozliczona) ZOSTAJE
  //     otwartym krokiem z kwotą: cudze pieniądze trzeba zwrócić także na
  //     anulowanym najmie.
  if (orderCancelled) {
    for (const step of steps) {
      if (step.key === "order" || step.done || step.cancelled) continue;
      if (step.key === "deposit" && depositHeld) continue;
      step.cancelled = true;
      if (step.key !== "payment") step.caption = { kind: "text", id: "notApplicable" };
    }
  }

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

  /**
   * Ustawienie karuzeli na kroku BIEŻĄCYM przy wejściu (uwaga właściciela R3):
   * krok „w toku" ma być pierwszy w polu widzenia, a nie schowany za prawą
   * krawędzią. Przewijamy WYŁĄCZNIE kontener osi (`scrollTo` na `<ol>`), więc
   * strona nie może drgnąć w pionie — `scrollIntoView` na kroku szarpnąłby
   * całą stronę do kroku, a to jest dokładnie ta klasa błędu Safari, której
   * unikamy. `behavior: "instant"` NADPISUJE `scroll-smooth` z klasy (który
   * ma wygładzać ruch UŻYTKOWNIKA), żeby pozycja startowa pojawiła się bez
   * animacji. Wartość liczymy z pozycji kroku względem kontenera — neutralnie
   * silnikowo, bez założeń o `offsetParent`. Na desktopie kontener się nie
   * przewija (kroki mieszczą się w rzędzie), więc `scrollTo` jest tam bezczynne.
   */
  const scrollRef = useRef<HTMLOListElement>(null);
  const currentStepRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const container = scrollRef.current;
    const current = currentStepRef.current;
    if (!container || !current) return;

    const align = () => {
      const left =
        container.scrollLeft +
        (current.getBoundingClientRect().left - container.getBoundingClientRect().left);
      container.scrollTo({ left, behavior: "instant" });
    };

    // Szczegół wchodzi granicą Suspense — w chwili montażu oś bywa jeszcze
    // NIEODSŁONIĘTA (zerowa geometria), więc pomiar w useEffect dałby zero
    // i karuzela zostałaby na pierwszym kroku. ResizeObserver odpala się przy
    // każdej zmianie rozmiaru kontenera (odsłonięcie, dołożenie layoutu,
    // dogranie fontu). Czekamy, aż oś REALNIE ma co przewijać
    // (`scrollWidth > clientWidth`) — to jest jedyny pewny sygnał, że poziomy
    // rozkład jest gotowy; strzał wcześniej (rozmiar pośredni, kroki jeszcze
    // spłaszczone) policzyłby przesunięcie zero. Dopiero wtedy wyrównujemy
    // i odłączamy obserwatora — pojedynczo, żeby nie przewijać osi z powrotem
    // na bieżący przy późniejszej zmianie szerokości (np. obrót ekranu), gdy
    // operator już sam gdzieś przewinął. Na desktopie oś się nie przewija
    // (`scrollWidth == clientWidth`), więc obserwator jest bezczynny do odmontowania.
    const observer = new ResizeObserver(() => {
      if (container.scrollWidth <= container.clientWidth) return;
      align();
      observer.disconnect();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
    // Kontener jest przewijalny w poziomie na wąskim ekranie i FOKUSOWALNY
    // (`tabIndex={0}`), więc karuzelę da się przewinąć samą klawiaturą
    // (strzałki na natywnym scrollu) — spójnie z zakazem pułapek dostępności.
    // `scroll-smooth` wygładza ruch użytkownika; ustawienie inicjalne biegnie
    // efektem, który domyślnie jest natychmiastowy. `snap-x` trzyma kroki na
    // krawędzi po puszczeniu palca.
    <ol
      ref={scrollRef}
      data-order-timeline
      aria-label={t("ariaLabel")}
      tabIndex={0}
      // Pasek przewijania SCHOWANY (uwaga właściciela) — karuzela zostaje
      // przewijalna palcem/klawiaturą, znika tylko sam wskaźnik. Trzy notacje,
      // bo silniki różnią się API: `scrollbar-width` (Firefox), `-ms-overflow-style`
      // (stary Edge), `::-webkit-scrollbar` (Safari/Chrome — silnik właściciela).
      className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth rounded-md [-ms-overflow-style:none] [scrollbar-width:none] md:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      {steps.map((step, index) => (
        <li
          key={step.key}
          ref={step.state === "current" ? currentStepRef : null}
          data-timeline-step={step.key}
          data-step-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
          className="relative flex min-w-32 shrink-0 snap-start flex-col items-center gap-2 pb-1 text-center md:min-w-0 md:flex-1 md:shrink md:pb-0"
        >
          {index > 0 ? (
            <span
              aria-hidden="true"
              className="bg-border absolute right-1/2 top-[13.5px] h-px w-full"
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

          <div className="flex min-w-0 flex-col items-center gap-0.5">
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
