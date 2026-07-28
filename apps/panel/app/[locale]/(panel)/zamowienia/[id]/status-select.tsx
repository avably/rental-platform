"use client";

import {
  BLOCKING_PAYMENT_STATUSES,
  ORDER_STATUSES,
  canTransition,
  type OrderStatus,
  type PaymentStatus,
} from "@avably/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import type { FormState } from "@/lib/form-state";

import type { TransitionEmailState } from "../actions";
import { TEMPLATE_FOR_STATUS } from "./rental-email";

/**
 * Zmiana statusu zamówienia: DROPDOWN przejść, jawna decyzja o wiadomości
 * i 10-sekundowe okno na cofnięcie wysyłki (uwaga właściciela N3, ADR-075).
 *
 * ============== TRZY KROKI, KTÓRE SIĘ NA SIEBIE NIE CZEKAJĄ ==============
 *
 * 1. WYBÓR STATUSU utrwala tranzycję OD RAZU. Nie czeka na odpowiedź o
 *    wiadomości i nie da się jej tą odpowiedzią cofnąć — „nie wysyłaj" to
 *    decyzja o poczcie, nie o zamówieniu.
 * 2. PYTANIE O WIADOMOŚĆ pojawia się dopiero PO utrwalonej zmianie i tylko
 *    wtedy, gdy jest o co pytać: przejście ma szablon (TEMPLATE_FOR_STATUS)
 *    i wysyłka jest w ogóle skonfigurowana. Odmowa bazy (trigger 0010)
 *    kończy rzecz wcześniej — wtedy nie ma czego zapowiadać klientowi.
 * 3. WYSYŁKA JEST ODROCZONA o 10 sekund. Przez ten czas NIC nie leci ani do
 *    dostawcy, ani do `email_logs`; „Anuluj" znaczy, że wiadomość nie
 *    powstała. To jest cała różnica między cofnięciem a jego udawaniem:
 *    interfejs z przyciskiem „Anuluj" nad wysłanym już mailem ogłaszałby
 *    stan, którego nie ma.
 *
 * ============== CO SIĘ DZIEJE, GDY OPERATOR ODEJDZIE OD EKRANU ==============
 *
 * Odroczenie żyje W TEJ KARCIE. Zamknięcie karty, przeładowanie albo
 * przejście na inny ekran w trakcie odliczania znaczy: WIADOMOŚĆ NIE
 * WYSZŁA. Tak jest napisane W BANERZE, zanim to się stanie, a wyjście ze
 * strony dodatkowo zatrzymuje `beforeunload` — bo jedyny wariant nie do
 * przyjęcia to taki, w którym operator myśli, że klient dostał wiadomość,
 * a nie dostał. Kolejka odroczonych wysyłek po stronie serwera przetrwałaby
 * zamknięcie karty, ale wymaga tabeli i procesu, który ją opróżnia — czyli
 * migracji i innej architektury (ADR-075, świadomie ODŁOŻONE).
 *
 * Uwaga na odwrotną pokusę: „wyślij od razu na wypadek, gdyby operator
 * wyszedł" (np. z funkcji sprzątającej efektu) zamienia każde nieoczekiwane
 * przemontowanie komponentu w cichą wysyłkę PRZED końcem odliczania — czyli
 * psuje dokładnie tę gwarancję, dla której to okno istnieje.
 */

/** Okno na cofnięcie. Sekundy są widoczne, więc liczba jest też treścią. */
const UNDO_SECONDS = 10;

type Outcome = { tone: "ok" | "warn"; text: string };

export function StatusSelect({
  changeStatus,
  sendEmail,
  orderId,
  currentStatus,
  paymentStatus,
  emailAvailability,
}: {
  changeStatus: (prevState: FormState, formData: FormData) => Promise<FormState>;
  sendEmail: (input: { orderId: string; status: OrderStatus }) => Promise<TransitionEmailState>;
  orderId: string;
  currentStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  emailAvailability: { available: boolean; reason?: string | undefined };
}) {
  const t = useTranslations("orders.detail");
  const tStatus = useTranslations("orders.statusLabels.order");

  const [pending, startTransition] = useTransition();
  const [transitionError, setTransitionError] = useState<string>();
  const [ask, setAsk] = useState<OrderStatus | null>(null);
  const [countdown, setCountdown] = useState<{ target: OrderStatus; secondsLeft: number } | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (tickRef.current !== null) clearInterval(tickRef.current);
    if (sendRef.current !== null) clearTimeout(sendRef.current);
    tickRef.current = null;
    sendRef.current = null;
  }

  // Sprzątanie zegarów przy odmontowaniu. ŚWIADOMIE bez wysyłki „na
  // pożegnanie" — patrz nagłówek pliku.
  useEffect(() => clearTimers, []);

  const counting = countdown !== null;
  useEffect(() => {
    if (!counting) return;
    // Tekst w tym oknie ustala przeglądarka; nasze jest samo zatrzymanie.
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [counting]);

  /**
   * Lista przejść: WYŁĄCZNIE dozwolone przez canTransition z bieżącego stanu
   * (jedno źródło prawdy z @avably/core). Dropdown zmienia FORMĘ, nie
   * bramki — anulowanie dalej gaśnie przy blokującym payment_status, a
   * autorytatywnie odmawia trigger 0010 (akcja niesie expectedFrom, więc
   * równoległa zmiana kończy się czytelnym błędem, nie ślepym nadpisem).
   */
  const cancelBlocked = BLOCKING_PAYMENT_STATUSES.includes(paymentStatus);
  const targets = ORDER_STATUSES.filter((status) => canTransition(currentStatus, status));
  const options = targets.map((status) => ({
    value: status,
    label: tStatus(status),
    disabled: status === "cancelled" && cancelBlocked,
  }));

  if (targets.length === 0) return null;

  function applyStatus(target: string) {
    if (target === "") return;
    const to = target as OrderStatus;

    // Nowa decyzja zaczyna od czystego ekranu — ale NIE zdejmuje trwającego
    // odliczania po cichu: gdyby jakieś trwało, jest ono anulowane jawnie,
    // bo wiadomość o poprzednim statusie przestała być prawdziwa.
    if (countdown !== null) {
      clearTimers();
      setCountdown(null);
    }
    setTransitionError(undefined);
    setOutcome(null);

    const formData = new FormData();
    formData.set("orderId", orderId);
    formData.set("to", to);
    formData.set("expectedFrom", currentStatus);

    startTransition(async () => {
      const result = await changeStatus({}, formData);
      if (result.formError) {
        setTransitionError(result.formError);
        return;
      }
      // Status JEST już w bazie. Pytamy o wiadomość tylko wtedy, gdy jest
      // co wysłać (nie każde przejście ma szablon) i czym wysłać.
      if (TEMPLATE_FOR_STATUS[to] !== undefined && emailAvailability.available) setAsk(to);
    });
  }

  function startCountdown(target: OrderStatus) {
    clearTimers();
    setAsk(null);
    setOutcome(null);
    setCountdown({ target, secondsLeft: UNDO_SECONDS });

    tickRef.current = setInterval(() => {
      setCountdown((prev) =>
        prev === null || prev.secondsLeft <= 0
          ? prev
          : { ...prev, secondsLeft: prev.secondsLeft - 1 },
      );
    }, 1000);

    // Dopiero TO wysyła. Wcześniej nie ma ani żądania do dostawcy, ani wpisu
    // w historii — anulowanie jest więc cofnięciem, a nie jego pozorem.
    sendRef.current = setTimeout(() => void fire(target), UNDO_SECONDS * 1000);
  }

  function cancelCountdown() {
    clearTimers();
    setCountdown(null);
    setOutcome({ tone: "warn", text: t("emailCancelled") });
  }

  async function fire(target: OrderStatus) {
    clearTimers();
    setCountdown(null);
    setSending(true);
    try {
      const result = await sendEmail({ orderId, status: target });
      setOutcome(
        result.problem
          ? { tone: "warn", text: result.problem }
          : { tone: "ok", text: t("emailSent") },
      );
    } catch {
      // Zerwane połączenie: nie wiemy, czy wiadomość poszła. Mówimy to
      // wprost i kierujemy do historii komunikacji, która wie na pewno.
      setOutcome({ tone: "warn", text: t("emailUnknown") });
    } finally {
      setSending(false);
    }
  }

  const askTarget = ask;

  return (
    <div className="flex flex-col gap-2">
      <PanelSelect
        id="status-change"
        // Sterowany PUSTĄ wartością: to nie jest pole pokazujące stan, tylko
        // wybór CZYNNOŚCI — po każdym wyborze wraca do etykiety zachęty,
        // a bieżący status widać w osi zdarzeń i w nagłówku zamówienia.
        value=""
        onValueChange={applyStatus}
        options={options}
        placeholder={pending ? t("statusChanging") : t("changeStatusPlaceholder")}
        busy={pending}
        disabled={pending}
        className="sm:w-72"
      />

      {cancelBlocked && targets.includes("cancelled") ? (
        <p className="text-muted-foreground text-xs">{t("cancelBlockedHint")}</p>
      ) : null}

      {!emailAvailability.available && targets.some((status) => TEMPLATE_FOR_STATUS[status]) ? (
        <p className="text-status-attention-fg text-xs">
          {emailAvailability.reason ?? t("sendEmailUnavailable")}
        </p>
      ) : null}

      {transitionError ? (
        <p role="alert" className="text-destructive text-sm">
          {transitionError}
        </p>
      ) : null}

      {countdown ? (
        <div
          data-email-countdown
          role="status"
          aria-live="polite"
          className="border-status-attention-border bg-status-attention-bg flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-status-attention-fg text-sm font-medium">
              {t("emailCountdown", { seconds: countdown.secondsLeft })}
            </p>
            {/* Ostrzeżenie stoi TU, a nie w regulaminie: to jedyny moment,
                w którym operator może na nie zareagować. */}
            <p className="text-muted-foreground text-xs">{t("emailCountdownLeaveWarning")}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={cancelCountdown}>
            {t("emailCountdownCancel")}
          </Button>
        </div>
      ) : null}

      {sending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("emailSending")}
        </p>
      ) : null}

      {outcome ? (
        <p
          data-email-outcome={outcome.tone}
          role="status"
          className={
            outcome.tone === "ok"
              ? "text-status-positive-fg text-sm"
              : "text-status-attention-fg text-sm"
          }
        >
          {outcome.text}
        </p>
      ) : null}

      <Dialog
        open={askTarget !== null}
        onOpenChange={(next) => {
          if (next) return;
          // Zamknięcie okna (Esc, tło, „Nie wysyłaj") NIE wysyła. Status
          // został już zmieniony, więc nie ma czego cofać — jest co
          // powiedzieć.
          setAsk(null);
          setOutcome({ tone: "warn", text: t("emailSkipped") });
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("emailPromptTitle")}</DialogTitle>
            <DialogDescription>
              {/* Czas przeszły jest tu istotny: zmiana JUŻ się zapisała. */}
              {t("emailPromptBody", {
                status: askTarget === null ? "" : tStatus(askTarget),
              })}
            </DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {t("emailPromptUndoNote", { seconds: UNDO_SECONDS })}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAsk(null);
                setOutcome({ tone: "warn", text: t("emailSkipped") });
              }}
            >
              {t("emailPromptSkip")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (askTarget !== null) startCountdown(askTarget);
              }}
            >
              {t("emailPromptSend")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
