"use client";

import { Button } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

type DeliveryAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

function FormMessages({ state, successText }: { state: FormState; successText?: string }) {
  if (state.formError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.formError}
      </p>
    );
  }
  if (state.fieldErrors) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {Object.values(state.fieldErrors)[0]}
      </p>
    );
  }
  // Neutralny komunikat (ani sukces, ani porażka) — np. zbiorcze odświeżenie,
  // które udało się tylko dla części przesyłek (ADR-069, wzorzec `notice`).
  if (state.notice) {
    return <p className="text-muted-foreground text-sm">{state.notice}</p>;
  }
  if (state.success && successText) {
    return <p className="text-status-positive-fg text-sm">{successText}</p>;
  }
  return null;
}

/**
 * Kopiowanie numeru śledzenia do schowka. Numer bywa długi i przepisywany do
 * innych narzędzi — przycisk „Kopiuj" oszczędza zaznaczania; potwierdzenie
 * „Skopiowano" gaśnie po chwili. Fail-cichy: gdy przeglądarka odmówi dostępu
 * do schowka, nie wywracamy widoku (numer jest też linkiem do skopiowania).
 */
export function TrackingCopyButton({ value }: { value: string }) {
  const t = useTranslations("orders.delivery.section");
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      className="h-7 px-2 text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Schowek niedostępny (np. brak uprawnień) — bez akcji, numer widać.
        }
      }}
    >
      {copied ? t("copiedOk") : t("copyCta")}
    </Button>
  );
}

/** Zbiorcze odświeżenie statusów wszystkich przesyłek zamówienia (ADR-031). */
export function RefreshAllShipmentsButton({
  orderId,
  action,
}: {
  orderId: string;
  action: DeliveryAction;
}) {
  const t = useTranslations("orders.delivery.section");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {t("refreshAllCta")}
      </Button>
      <FormMessages state={state} successText={t("refreshedAllOk")} />
    </form>
  );
}

/** Przycisk odświeżenia statusu pojedynczej przesyłki (sync na żądanie — ADR-031). */
export function RefreshStatusButton({
  shipmentId,
  action,
}: {
  shipmentId: string;
  action: DeliveryAction;
}) {
  const t = useTranslations("orders.delivery.section");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {t("refreshCta")}
      </Button>
      <FormMessages state={state} successText={t("refreshedOk")} />
    </form>
  );
}

/** Stan dostępności wysyłki e-maili — przekazywany z serwera (ADR-033). */
type EmailAvailabilityProp = { available: boolean; reason?: string };

/**
 * „Wyślij klientowi etykietę zwrotną e-mailem" — dla istniejącej przesyłki
 * zwrotnej. Przy braku konfiguracji poczty przycisk jest zablokowany, a powód
 * pokazany Z GÓRY (wzorzec 8b: powód przy kontrolce), zamiast pozwalać kliknąć
 * i zwrócić błąd.
 */
export function SendReturnLabelButton({
  orderId,
  shipmentId,
  emailAvailability,
  action,
}: {
  orderId: string;
  shipmentId: string;
  emailAvailability: EmailAvailabilityProp;
  action: DeliveryAction;
}) {
  const t = useTranslations("orders.delivery.section");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <Button type="submit" variant="outline" disabled={pending || !emailAvailability.available}>
        {t("sendReturnLabelCta")}
      </Button>
      {!emailAvailability.available ? (
        <p className="text-muted-foreground text-xs">
          {emailAvailability.reason ?? t("emailUnavailable")}
        </p>
      ) : null}
      <FormMessages state={state} successText={t("returnLabelSentOk")} />
    </form>
  );
}

/**
 * „Wyślij przypomnienie o zwrocie" — dla zamówienia z odbiorem osobistym.
 * Ta sama semantyka niedostępności co przycisk etykiety.
 */
export function SendPickupReminderButton({
  orderId,
  emailAvailability,
  action,
}: {
  orderId: string;
  emailAvailability: EmailAvailabilityProp;
  action: DeliveryAction;
}) {
  const t = useTranslations("orders.delivery.section");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <p className="font-medium">{t("pickupReminderTitle")}</p>
      <p className="text-muted-foreground">{t("pickupReminderHint")}</p>
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" disabled={pending || !emailAvailability.available}>
        {t("sendPickupReminderCta")}
      </Button>
      {!emailAvailability.available ? (
        <p className="text-muted-foreground text-xs">
          {emailAvailability.reason ?? t("emailUnavailable")}
        </p>
      ) : null}
      <FormMessages state={state} successText={t("pickupReminderSentOk")} />
    </form>
  );
}
