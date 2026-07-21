"use client";

import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState } from "react";

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
  if (state.success && successText) {
    return <p className="text-status-positive-fg text-sm">{successText}</p>;
  }
  return null;
}

/**
 * Formularz nadania przesyłki (wysyłka/zwrot lustrzany). To jest UI —
 * autorytatywnie odmawia silnik (konfiguracja tenanta, czytelna lista braków)
 * i dostawca (walidacja adresów). Wymiary prefillowane z domyślnej paczki
 * tenanta (courier_parcel); numer domu klienta wpisuje operator, bo kartoteka
 * klienta trzyma ulicę jednym polem, a fabrykowanie wartości do API
 * kurierskiego to anty-wzorzec (ADR-031).
 */
export function CreateShipmentForm({
  orderId,
  defaults,
  action,
}: {
  orderId: string;
  defaults: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number } | null;
  action: DeliveryAction;
}) {
  const t = useTranslations("orders.delivery.section");
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2 rounded border p-3 text-sm">
      <p className="font-medium">{t("createTitle")}</p>
      <input type="hidden" name="orderId" value={orderId} />

      <Label htmlFor="shipment-type">{t("typeLabel")}</Label>
      <select
        id="shipment-type"
        name="shipmentType"
        defaultValue="outbound"
        disabled={pending}
        className="rounded border px-3 py-2"
      >
        <option value="outbound">{t("types.outbound")}</option>
        <option value="return">{t("types.return")}</option>
      </select>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="shipment-house-number">{t("houseNumberLabel")}</Label>
          <Input id="shipment-house-number" name="houseNumber" disabled={pending} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="shipment-apartment-number">{t("apartmentNumberLabel")}</Label>
          <Input id="shipment-apartment-number" name="apartmentNumber" disabled={pending} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["lengthCm", "lengthLabel", defaults?.lengthCm],
            ["widthCm", "widthLabel", defaults?.widthCm],
            ["heightCm", "heightLabel", defaults?.heightCm],
            ["weightKg", "weightLabel", defaults?.weightKg],
          ] as const
        ).map(([name, label, defaultValue]) => (
          <div key={name} className="flex flex-col gap-1">
            <Label htmlFor={`shipment-${name}`}>{t(label)}</Label>
            <Input
              id={`shipment-${name}`}
              name={name}
              type="number"
              step="0.1"
              min="0"
              defaultValue={defaultValue ?? ""}
              disabled={pending}
            />
          </div>
        ))}
      </div>

      <Label htmlFor="shipment-content">{t("contentLabel")}</Label>
      <Input
        id="shipment-content"
        name="content"
        defaultValue={t("contentDefault")}
        disabled={pending}
      />

      <Button type="submit" disabled={pending}>
        {t("createCta")}
      </Button>
      <FormMessages state={state} successText={t("createdOk")} />
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
