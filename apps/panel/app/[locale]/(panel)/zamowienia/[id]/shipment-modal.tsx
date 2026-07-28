"use client";

/**
 * Modal „Potwierdź etykietę wysyłkową" — bogaty formularz nadania przesyłki
 * (Zadanie 7 / uwaga przeglądu D8). Zawiera:
 *   • rozmiar paczki jako presety mapowane na wymiary (domyślny = paczka
 *     tenanta) + własne wymiary,
 *   • nadawcę i odbiorcę PREFILLOWANYCH (konfiguracja kuriera / kartoteka
 *     klienta), EDYTOWALNYCH jako override na tę jedną przesyłkę,
 *   • WYSZUKIWARKĘ przewoźników z cenami (searchProducts na serwerze) —
 *     najtańszy zaznaczony domyślnie, „Odśwież"; wybór przypina productId,
 *   • opcje dodatkowe obsługiwane przez API i kluczowane KATEGORIĄ (nie
 *     liczbowym id): ubezpieczenie (addons.INSURANCE z wartością) oraz dostawa
 *     w sobotę (addons.WEEKEND_DELIVERY — pusty obiekt, dodatek bez wartości).
 *     Checkbox soboty jest uniwersalny: dosyła dodatek na obecnym torze PICKUP,
 *     bez bramkowania per-przewoźnik.
 *
 * Utworzenie idzie do createShipmentAction; searchProducts NIE tworzy zlecenia
 * i nie niesie kosztu (bezpieczne przy weryfikacji na koncie testowym kuriera).
 */
import { formatMoney, type CarrierOffer } from "@avably/core";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from "@avably/ui";
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useState, useTransition } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import type { FormState } from "@/lib/form-state";

import type { PartyDefaults } from "./delivery";

type CarrierSearchState = FormState & { offers?: CarrierOffer[] };
type CreateAction = (prev: FormState, formData: FormData) => Promise<FormState>;
type SearchAction = (
  prev: CarrierSearchState,
  formData: FormData,
) => Promise<CarrierSearchState>;

type ParcelDefaults = {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
} | null;

type Dims = { lengthCm: string; widthCm: string; heightCm: string; weightKg: string };

/** Wymiary presetu → napis „L×W×H cm · do N kg" składany z i18n. */
function presetMeta(
  t: ReturnType<typeof useTranslations>,
  d: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number },
) {
  return t("presetMeta", {
    l: d.lengthCm,
    w: d.widthCm,
    h: d.heightCm,
    weight: d.weightKg,
  });
}

/**
 * Grupa pól jednej strony przesyłki. Nazwy pól = prefiks + rola (senderName,
 * recipientStreet, …) — spójnie z shipmentCreateSchema.
 */
function PartyFields({
  prefix,
  values,
  onChange,
  disabled,
}: {
  prefix: "sender" | "recipient";
  values: PartyDefaults;
  onChange: (patch: Partial<PartyDefaults>) => void;
  disabled: boolean;
}) {
  const t = useTranslations("orders.delivery.section");
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const field = (role: keyof PartyDefaults) => `${prefix}${cap(role)}`;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={field("name")}>{t("fieldName")}</Label>
        <Input
          id={field("name")}
          name={field("name")}
          value={values.name}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field("street")}>{t("fieldStreet")}</Label>
        <Input
          id={field("street")}
          name={field("street")}
          value={values.street}
          onChange={(e) => onChange({ street: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={field("houseNumber")}>{t("fieldHouse")}</Label>
          <Input
            id={field("houseNumber")}
            name={field("houseNumber")}
            value={values.houseNumber}
            onChange={(e) => onChange({ houseNumber: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={field("apartmentNumber")}>{t("fieldApartment")}</Label>
          <Input
            id={field("apartmentNumber")}
            name={field("apartmentNumber")}
            value={values.apartmentNumber}
            onChange={(e) => onChange({ apartmentNumber: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field("postCode")}>{t("fieldPostCode")}</Label>
        <Input
          id={field("postCode")}
          name={field("postCode")}
          value={values.postCode}
          onChange={(e) => onChange({ postCode: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field("city")}>{t("fieldCity")}</Label>
        <Input
          id={field("city")}
          name={field("city")}
          value={values.city}
          onChange={(e) => onChange({ city: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field("phone")}>{t("fieldPhone")}</Label>
        <Input
          id={field("phone")}
          name={field("phone")}
          value={values.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={field("email")}>{t("fieldEmail")}</Label>
        <Input
          id={field("email")}
          name={field("email")}
          type="email"
          value={values.email}
          onChange={(e) => onChange({ email: e.target.value })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function ModalBody({
  orderId,
  senderDefaults,
  recipientDefaults,
  parcelDefaults,
  createAction,
  searchAction,
  onSuccess,
  onCancel,
}: {
  orderId: string;
  senderDefaults: PartyDefaults;
  recipientDefaults: PartyDefaults;
  parcelDefaults: ParcelDefaults;
  createAction: CreateAction;
  searchAction: SearchAction;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("orders.delivery.section");
  const locale = useLocale();

  const [shipmentType, setShipmentType] = useState<"outbound" | "return">("outbound");
  const [sender, setSender] = useState<PartyDefaults>(senderDefaults);
  const [recipient, setRecipient] = useState<PartyDefaults>(recipientDefaults);
  const [content, setContent] = useState(t("contentDefault"));

  const tenantDims: Dims | null = parcelDefaults
    ? {
        lengthCm: String(parcelDefaults.lengthCm),
        widthCm: String(parcelDefaults.widthCm),
        heightCm: String(parcelDefaults.heightCm),
        weightKg: String(parcelDefaults.weightKg),
      }
    : null;

  // Presety gabarytów: „domyślna" = paczka tenanta (gdy skonfigurowana);
  // reszta to typowe rozmiary. Klik presetu wypełnia pola wymiarów.
  const PRESETS = [
    ...(parcelDefaults
      ? [{ key: "default", ...parcelDefaults }]
      : []),
    { key: "small", lengthCm: 20, widthCm: 15, heightCm: 10, weightKg: 2 },
    { key: "medium", lengthCm: 40, widthCm: 30, heightCm: 20, weightKg: 10 },
    { key: "large", lengthCm: 60, widthCm: 40, heightCm: 40, weightKg: 25 },
  ] as const;

  const [presetKey, setPresetKey] = useState<string>(
    parcelDefaults ? "default" : "custom",
  );
  const [dims, setDims] = useState<Dims>(
    tenantDims ?? { lengthCm: "40", widthCm: "30", heightCm: "20", weightKg: "10" },
  );

  const [insurance, setInsurance] = useState(false);
  const [insuranceValue, setInsuranceValue] = useState("");
  const [saturdayDelivery, setSaturdayDelivery] = useState(false);

  const [offers, setOffers] = useState<CarrierOffer[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [isSearching, startSearch] = useTransition();

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, formData) => {
      const result = await createAction(prev, formData);
      if (result.success) onSuccess();
      return result;
    },
    {},
  );

  function applyPreset(key: string, d?: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number }) {
    setPresetKey(key);
    if (d) {
      setDims({
        lengthCm: String(d.lengthCm),
        widthCm: String(d.widthCm),
        heightCm: String(d.heightCm),
        weightKg: String(d.weightKg),
      });
    }
    // Wymiary zmieniły paczkę → poprzednie oferty są nieaktualne.
    setOffers(null);
    setSelectedProductId(null);
  }

  function runSearch() {
    setSearchError(null);
    const fd = new FormData();
    fd.set("orderId", orderId);
    // Kierunek rozstrzyga, który kod jest nadaniem, a który doręczeniem:
    // przy zwrocie nadawcą jest klient (odbiorca), a doręczeniem — tenant.
    const [senderPostCode, receiverPostCode] =
      shipmentType === "outbound"
        ? [sender.postCode, recipient.postCode]
        : [recipient.postCode, sender.postCode];
    fd.set("senderPostCode", senderPostCode);
    fd.set("receiverPostCode", receiverPostCode);
    fd.set("lengthCm", dims.lengthCm);
    fd.set("widthCm", dims.widthCm);
    fd.set("heightCm", dims.heightCm);
    fd.set("weightKg", dims.weightKg);
    startSearch(async () => {
      const res = await searchAction({}, fd);
      if (res.offers && res.offers.length > 0) {
        setOffers(res.offers);
        setSelectedProductId(res.offers[0].productId);
        setSearchError(null);
      } else {
        setOffers(null);
        setSelectedProductId(null);
        setSearchError(res.formError ?? Object.values(res.fieldErrors ?? {})[0] ?? t("searchFailed"));
      }
    });
  }

  const errorText = state.formError ?? Object.values(state.fieldErrors ?? {})[0];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="productId" value={selectedProductId ?? ""} />
      <input type="hidden" name="insurance" value={insurance ? "on" : ""} />
      <input type="hidden" name="saturdayDelivery" value={saturdayDelivery ? "on" : ""} />

      {/* Typ przesyłki */}
      <div className="flex flex-col gap-1">
        <Label htmlFor="shipment-type">{t("typeLabel")}</Label>
        <PanelSelect
          id="shipment-type"
          name="shipmentType"
          value={shipmentType}
          onValueChange={(v) => setShipmentType(v as "outbound" | "return")}
          disabled={pending}
          options={[
            { value: "outbound", label: t("types.outbound") },
            { value: "return", label: t("types.return") },
          ]}
        />
      </div>

      {/* Rozmiar paczki */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("sizeSection")}</legend>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset.key, preset)}
              disabled={pending}
              aria-pressed={presetKey === preset.key}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                presetKey === preset.key
                  ? "border-primary bg-primary/10"
                  : "border-input hover:bg-accent"
              }`}
            >
              <span className="block font-medium">{t(`preset.${preset.key}`)}</span>
              <span className="text-muted-foreground block">{presetMeta(t, preset)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPresetKey("custom")}
            disabled={pending}
            aria-pressed={presetKey === "custom"}
            className={`rounded-md border px-3 py-2 text-xs transition-colors ${
              presetKey === "custom"
                ? "border-primary bg-primary/10"
                : "border-input hover:bg-accent"
            }`}
          >
            <span className="block font-medium">{t("preset.custom")}</span>
            <span className="text-muted-foreground block">{t("presetCustomHint")}</span>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(
            [
              ["lengthCm", "lengthLabel"],
              ["widthCm", "widthLabel"],
              ["heightCm", "heightLabel"],
              ["weightKg", "weightLabel"],
            ] as const
          ).map(([name, label]) => (
            <div key={name} className="flex flex-col gap-1">
              <Label htmlFor={`shipment-${name}`}>{t(label)}</Label>
              <Input
                id={`shipment-${name}`}
                name={name}
                type="number"
                step="0.1"
                min="0"
                value={dims[name]}
                onChange={(e) => {
                  setPresetKey("custom");
                  setDims((prev) => ({ ...prev, [name]: e.target.value }));
                  setOffers(null);
                  setSelectedProductId(null);
                }}
                disabled={pending}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {/* Nadawca / odbiorca */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("senderSection")}</legend>
        <PartyFields
          prefix="sender"
          values={sender}
          onChange={(patch) => setSender((p) => ({ ...p, ...patch }))}
          disabled={pending}
        />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("recipientSection")}</legend>
        <PartyFields
          prefix="recipient"
          values={recipient}
          onChange={(patch) => setRecipient((p) => ({ ...p, ...patch }))}
          disabled={pending}
        />
      </fieldset>

      {/* Zawartość */}
      <div className="flex flex-col gap-1">
        <Label htmlFor="shipment-content">{t("contentLabel")}</Label>
        <Input
          id="shipment-content"
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={pending}
        />
      </div>

      {/* Wybór przewoźnika */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("carrierSection")}</legend>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={runSearch}
            loading={isSearching}
            disabled={pending || isSearching}
          >
            {isSearching
              ? t("searchingCarriers")
              : offers
                ? t("refreshCarriersCta")
                : t("searchCarriersCta")}
          </Button>
          {offers ? (
            <span className="text-muted-foreground text-xs">{t("carriersHint")}</span>
          ) : null}
        </div>

        {searchError ? (
          <p role="alert" className="text-destructive text-sm">
            {searchError}
          </p>
        ) : null}

        {offers ? (
          <ul className="flex flex-col gap-2" role="radiogroup" aria-label={t("carrierSection")}>
            {offers.map((offer, index) => {
              const selected = selectedProductId === offer.productId;
              return (
                <li key={offer.productId}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSelectedProductId(offer.productId)}
                    disabled={pending}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                      selected ? "border-primary bg-primary/10" : "border-input hover:bg-accent"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      {offer.carrierLogo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={offer.carrierLogo}
                          alt=""
                          className="h-6 w-auto shrink-0 object-contain"
                        />
                      ) : null}
                      <span className="flex flex-col">
                        <span className="text-sm font-medium">
                          {offer.carrierName}
                          {index === 0 ? (
                            <span className="bg-status-positive-bg text-status-positive-fg ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase">
                              {t("carrierCheapest")}
                            </span>
                          ) : null}
                        </span>
                        {offer.deliveryDays !== undefined || offer.serviceCode ? (
                          <span className="text-muted-foreground text-xs">
                            {offer.deliveryDays !== undefined
                              ? t("carrierDeliveryDays", { days: offer.deliveryDays })
                              : null}
                            {offer.deliveryDays !== undefined && offer.serviceCode ? " · " : ""}
                            {offer.serviceCode ?? ""}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="text-sm font-semibold whitespace-nowrap">
                      {formatMoney(offer.priceGrosze, offer.currency, locale)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">{t("noCarrierYet")}</p>
        )}
      </fieldset>

      {/* Opcje dodatkowe */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">{t("optionsSection")}</legend>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={insurance}
            onCheckedChange={(v) => setInsurance(v === true)}
            disabled={pending}
          />
          {t("insuranceLabel")}
        </label>
        {insurance ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="insurance-value">{t("insuranceValueLabel")}</Label>
            <Input
              id="insurance-value"
              name="insuranceValuePln"
              type="number"
              step="0.01"
              min="0"
              value={insuranceValue}
              onChange={(e) => setInsuranceValue(e.target.value)}
              disabled={pending}
            />
            <span className="text-muted-foreground text-xs">{t("insuranceHint")}</span>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={saturdayDelivery}
            onCheckedChange={(v) => setSaturdayDelivery(v === true)}
            disabled={pending}
          />
          {t("saturdayLabel")}
        </label>
        <span className="text-muted-foreground text-xs">{t("saturdayHint")}</span>
      </fieldset>

      {errorText ? (
        <p role="alert" className="text-destructive text-sm">
          {errorText}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t("cancelCta")}
        </Button>
        <Button type="submit" loading={pending} disabled={pending}>
          {pending ? t("creatingShipment") : t("confirmCreateCta")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Wyzwalacz modalu nadania przesyłki. Radix odmontowuje treść po zamknięciu,
 * więc każdy `<ModalBody>` startuje ze świeżym stanem (żaden sukces z poprzedniej
 * przesyłki nie „zamyka" nowego otwarcia).
 */
export function ShipmentModalLauncher({
  orderId,
  senderDefaults,
  recipientDefaults,
  parcelDefaults,
  createAction,
  searchAction,
}: {
  orderId: string;
  senderDefaults: PartyDefaults;
  recipientDefaults: PartyDefaults;
  parcelDefaults: ParcelDefaults;
  createAction: CreateAction;
  searchAction: SearchAction;
}) {
  const t = useTranslations("orders.delivery.section");
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button">{t("createCta")}</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("modalTitle")}</DialogTitle>
          <DialogDescription>{t("modalDescription")}</DialogDescription>
        </DialogHeader>
        <ModalBody
          orderId={orderId}
          senderDefaults={senderDefaults}
          recipientDefaults={recipientDefaults}
          parcelDefaults={parcelDefaults}
          createAction={createAction}
          searchAction={searchAction}
          onSuccess={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
