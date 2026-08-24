"use client";

/**
 * Formularze ustawień dostaw (Zadanie 7, ADR-030/031; układ P8 wg artefaktu
 * Fazy 2, sekcja `secondary-delivery`).
 *
 * Dwadzieścia jeden pól w CZTERECH kartach, każda z własnym przyciskiem
 * i własną akcją serwerową — ten podział istniał od początku i mockup go
 * potwierdza. Jeden zbiorczy „Zapisz" na dole ekranu wymuszałby komplet
 * poprawnych credentiali po to, żeby poprawić literówkę w kodzie pocztowym.
 *
 * Zapis należy WYŁĄCZNIE do właściciela (RLS 0024). Ostateczną bramką zostaje
 * baza — tu wyłącznie nie udajemy, że członek zespołu ma co kliknąć.
 *
 * ================== U9: ZAPIS Z BŁĘDEM NIE GUBI PRACY ==================
 *
 * Pola są NIEKONTROLOWANE (`defaultValue`), więc pełny obieg dokumentu —
 * formularz wysłany bez hydracji, odświeżenie strony, powrót z historii —
 * renderuje je od nowa ZE STANU BAZY i kasuje to, co operator wpisał.
 * Dlatego każde pole czyta najpierw echo z `FormState.values` (U9), a dopiero
 * potem wartość z bazy. Echo przeżywa obieg dokumentu, bo jest częścią stanu
 * akcji, a nie stanu przeglądarki.
 *
 * HASŁO KURIERA JEST WYJĄTKIEM I POZOSTAJE NIM ŚWIADOMIE: pole jest tylko do
 * zapisu (ADR-052), a `formEcho` wycina je po stronie akcji. Formularz nie
 * czyta echa dla hasła nawet wtedy, gdyby stan je przyniósł — dwie niezależne
 * bariery, bo koszt pomyłki to sekret w źródle strony.
 */
import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { PanelSelect } from "@/components/fields/panel-select";
import { ScreenSection } from "@/components/screens/screen-header";
import type { FormState } from "@/lib/form-state";
import { groszeToInputValue } from "@/lib/money-input";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import type { DeliverySectionState } from "./delivery-settings-status";

const initialState: FormState = {};

type SettingsAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

/**
 * `useActionState` z jednym dodatkiem: po POTWIERDZONYM sukcesie akcji woła
 * `onSuccess` (hub dostaw zamyka nim modal, ADR-236). Kontrakt zapisu i echo
 * (U9) zostają nietknięte — owijka nie zmienia ani stanu, ani `formAction`,
 * tylko dokłada efekt uboczny na `result.success`. Bez `onSuccess` zachowuje
 * się dokładnie jak goły `useActionState`, więc karta renderowana wprost
 * (kontrakty `secondary-screens` / `delivery-settings-render-echo`) działa jak
 * dotąd.
 */
function useSettingsForm(action: SettingsAction, onSuccess?: () => void) {
  return useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.success && onSuccess) onSuccess();
    return result;
  }, initialState);
}

/** Wspólne dla czterech kart: stan gotowości + data ostatniego zapisu. */
export interface SectionStatus {
  state: DeliverySectionState;
  /** Sformatowana na serwerze data z `tenant_settings.updated_at`, albo null. */
  savedAt: string | null;
}

/**
 * Komunikat PRZY POLU (wzorzec z `punkty-odbioru/location-form.tsx`).
 *
 * Do U9 cała karta pokazywała PIERWSZY błąd jedną linijką w stopce, bez
 * powiązania z polem — przy ośmiu polach nadawcy operator nie wiedział, które
 * poprawić, a czytnik ekranu nie wiązał komunikatu z niczym.
 */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-[13px] leading-[18px] font-medium">
      {message}
    </p>
  );
}

/**
 * Okablowanie pojedynczego pola: wartość (echo → baza), znaczniki błędu
 * i powiązanie komunikatu przez `aria-describedby`.
 *
 * `idPrefix` bywa inny niż nazwa pola (`cred-email` dla `email`), więc
 * identyfikatory z ekranu zostają nietknięte — kontrakt renderu trzyma się ich.
 */
function fieldBinding(idPrefix: string, state: FormState) {
  return (name: string, valueFromDb: string) => {
    const message = state.fieldErrors?.[name];
    const errorId = `${idPrefix}-${name}-error`;
    return {
      input: {
        id: `${idPrefix}-${name}`,
        name,
        defaultValue: state.values?.[name] ?? valueFromDb,
        "aria-invalid": message ? true : undefined,
        "aria-describedby": message ? errorId : undefined,
      },
      errorId,
      message,
    };
  };
}

/** Etykieta z jawnym znacznikiem opcjonalności — wymagane pole go nie ma. */
function FieldLabel({
  htmlFor,
  children,
  optional,
}: {
  htmlFor: string;
  children: React.ReactNode;
  optional?: boolean;
}) {
  const t = useTranslations("orders.delivery.settings");
  return (
    <Label htmlFor={htmlFor}>
      {children}
      {optional ? (
        <span className="text-muted-foreground font-normal"> {t("optionalMark")}</span>
      ) : null}
    </Label>
  );
}

/**
 * Podpis karty: reguła wymagalności sekcji + kiedy ostatnio zapisano.
 *
 * Data jest ZDANIEM, nie chipem: chip niesie jedno słowo (oś
 * `delivery-section`), a „ostatnio zapisano 12.08.2026, 09:41" ma drugą
 * zmienną i w chipie by się nie zmieściło (ten sam wybór co ADR-129).
 */
function SectionMeta({ hint, savedAt }: { hint: string; savedAt: string | null }) {
  const t = useTranslations("orders.delivery.settings");
  return (
    <span data-section-meta>
      {hint}
      {" · "}
      <span data-section-saved-at={savedAt ?? "never"}>
        {savedAt ? t("savedAt", { when: savedAt }) : t("neverSaved")}
      </span>
    </span>
  );
}

function FormMessages({ state, successText }: { state: FormState; successText: string }) {
  const t = useTranslations("orders.delivery.settings");
  if (state.formError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.formError}
      </p>
    );
  }
  // Treść błędów stoi PRZY POLACH — stopka mówi tylko, że jest co poprawić
  // i że wpisane wartości nie przepadły. Powtórzenie pierwszego komunikatu
  // w dwóch miejscach kazałoby szukać, do którego pola należy.
  if (state.fieldErrors) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {t("fixFieldsHint")}
      </p>
    );
  }
  if (state.success) {
    return <span className="text-status-positive-fg text-sm">{successText}</span>;
  }
  return null;
}

/**
 * Stopka karty: zapis + komunikat, jeden rytm dla wszystkich czterech kart.
 *
 * Członek zespołu dostaje TU zdanie o rolach — dokładnie w miejscu, w którym
 * brakuje przycisku. Do U9 stało ono osobną kartą na górze ekranu, oderwane od
 * czterech sekcji, których dotyczy (audyt UX 6.1).
 */
function SaveRow({
  canWrite,
  pending,
  state,
  label,
  successText,
}: {
  canWrite: boolean;
  pending: boolean;
  state: FormState;
  label: string;
  successText: string;
}) {
  const t = useTranslations("orders.delivery.settings");
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      {canWrite ? (
        <Button type="submit" loading={pending} disabled={pending}>
          {label}
        </Button>
      ) : (
        <p data-delivery-access-rule="member-reads" className="text-muted-foreground text-[13px] leading-[18px]">
          {t("accessRuleMember")}
        </p>
      )}
      <FormMessages state={state} successText={successText} />
    </div>
  );
}

/**
 * Credentiale dostawcy. Zapisane hasło NIGDY nie wraca do formularza —
 * karta pokazuje wyłącznie STAN sekretu (oś `delivery-secret`); ponowny zapis
 * wymaga wpisania hasła od nowa (ADR-052, pole tylko do zapisu).
 */
export function CredentialsForm({
  action,
  configured,
  canWrite,
  defaults,
  status,
  onSuccess,
}: {
  action: SettingsAction;
  configured: boolean;
  canWrite: boolean;
  defaults: { email: string; environment: string } | null;
  status: SectionStatus;
  onSuccess?: () => void;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useSettingsForm(action, onSuccess);
  const field = fieldBinding("cred", state);

  const email = field("email", defaults?.email ?? "");
  const environmentError = state.fieldErrors?.environment;
  const environmentValue = state.values?.environment ?? defaults?.environment ?? "test";

  return (
    <ScreenSection
      data-settings-form="credentials"
      title={t("credentialsTitle")}
      status={
        <span className="flex flex-wrap items-center gap-2">
          <SecondaryStatusChip axis="delivery-section" value={status.state} />
          <SecondaryStatusChip
            axis="delivery-secret"
            value={configured ? "configured" : "missing"}
          />
        </span>
      }
      description={
        <>
          {t("secretWriteOnly")}{" "}
          <SectionMeta hint={t("requiredHint")} savedAt={status.savedAt} />
        </>
      }
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <FieldLabel htmlFor="cred-email">{t("emailLabel")}</FieldLabel>
        <Input {...email.input} type="email" required disabled={pending || !canWrite} />
        <FieldError id={email.errorId} message={email.message} />
        {canWrite ? (
          <>
            <FieldLabel htmlFor="cred-password">{t("passwordLabel")}</FieldLabel>
            {/*
              BEZ `defaultValue` i bez odczytu `state.values` — pole tylko do
              zapisu (ADR-052). Nawet gdyby stan akcji przyniósł tu wartość,
              formularz jej nie użyje.
            */}
            <Input
              id="cred-password"
              name="password"
              type="password"
              required
              disabled={pending}
              aria-invalid={state.fieldErrors?.password ? true : undefined}
              aria-describedby={state.fieldErrors?.password ? "cred-password-error" : undefined}
            />
            <FieldError id="cred-password-error" message={state.fieldErrors?.password} />
          </>
        ) : null}
        <FieldLabel htmlFor="cred-environment">{t("environmentLabel")}</FieldLabel>
        <PanelSelect
          id="cred-environment"
          name="environment"
          defaultValue={environmentValue}
          placeholder={t("environmentLabel")}
          disabled={pending || !canWrite}
          invalid={environmentError ? true : undefined}
          describedBy={environmentError ? "cred-environment-error" : undefined}
          options={[
            { value: "test", label: t("environmentTest") },
            { value: "production", label: t("environmentProduction") },
          ]}
        />
        <FieldError id="cred-environment-error" message={environmentError} />
        <SaveRow
          canWrite={canWrite}
          pending={pending}
          state={state}
          label={t("saveCredentialsCta")}
          successText={t("savedOk")}
        />
      </form>
    </ScreenSection>
  );
}

export interface SenderDefaults {
  name: string;
  street: string;
  houseNumber: string;
  apartmentNumber: string;
  postCode: string;
  city: string;
  phone: string;
  email: string;
}

export function SenderForm({
  action,
  canWrite,
  defaults,
  status,
  onSuccess,
}: {
  action: SettingsAction;
  canWrite: boolean;
  defaults: SenderDefaults | null;
  status: SectionStatus;
  onSuccess?: () => void;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useSettingsForm(action, onSuccess);
  const field = fieldBinding("sender", state);

  // Opcjonalność idzie ZA SCHEMATEM (`delivery-settings-validation.ts`):
  // jedynym polem nadawcy, którego Zod nie wymaga, jest numer lokalu.
  const fields = [
    ["name", "senderName", false],
    ["street", "senderStreet", false],
    ["houseNumber", "senderHouseNumber", false],
    ["apartmentNumber", "senderApartmentNumber", true],
    ["postCode", "senderPostCode", false],
    ["city", "senderCity", false],
    ["phone", "senderPhone", false],
    ["email", "senderEmail", false],
  ] as const;

  return (
    <ScreenSection
      data-settings-form="sender"
      title={t("senderTitle")}
      status={<SecondaryStatusChip axis="delivery-section" value={status.state} />}
      description={<SectionMeta hint={t("requiredHint")} savedAt={status.savedAt} />}
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([name, label, optional]) => {
            const bound = field(name, defaults?.[name] ?? "");
            return (
              <div key={name} className="flex min-w-0 flex-col gap-1">
                <FieldLabel htmlFor={bound.input.id} optional={optional}>
                  {t(label)}
                </FieldLabel>
                <Input {...bound.input} required={!optional} disabled={pending || !canWrite} />
                <FieldError id={bound.errorId} message={bound.message} />
              </div>
            );
          })}
        </div>
        <SaveRow
          canWrite={canWrite}
          pending={pending}
          state={state}
          label={t("saveSenderCta")}
          successText={t("savedOk")}
        />
      </form>
    </ScreenSection>
  );
}

export function ParcelForm({
  action,
  canWrite,
  defaults,
  status,
  onSuccess,
}: {
  action: SettingsAction;
  canWrite: boolean;
  defaults: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number } | null;
  status: SectionStatus;
  onSuccess?: () => void;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useSettingsForm(action, onSuccess);
  const field = fieldBinding("parcel", state);

  const fields = [
    ["lengthCm", "parcelLength", defaults?.lengthCm],
    ["widthCm", "parcelWidth", defaults?.widthCm],
    ["heightCm", "parcelHeight", defaults?.heightCm],
    ["weightKg", "parcelWeight", defaults?.weightKg],
  ] as const;

  return (
    <ScreenSection
      data-settings-form="parcel"
      title={t("parcelTitle")}
      status={<SecondaryStatusChip axis="delivery-section" value={status.state} />}
      description={<SectionMeta hint={t("requiredHint")} savedAt={status.savedAt} />}
    >
      <form action={formAction} className="flex flex-col gap-2 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(([name, label, valueFromDb]) => {
            const bound = field(name, valueFromDb === undefined ? "" : String(valueFromDb));
            return (
              <div key={name} className="flex min-w-0 flex-col gap-1">
                <FieldLabel htmlFor={bound.input.id}>{t(label)}</FieldLabel>
                <Input
                  {...bound.input}
                  type="number"
                  step="0.1"
                  min="0"
                  required
                  className="tabular-nums"
                  disabled={pending || !canWrite}
                />
                <FieldError id={bound.errorId} message={bound.message} />
              </div>
            );
          })}
        </div>
        <SaveRow
          canWrite={canWrite}
          pending={pending}
          state={state}
          label={t("saveParcelCta")}
          successText={t("savedOk")}
        />
      </form>
    </ScreenSection>
  );
}

export interface PricingDefaults {
  courier?: { priceGrosze: number; freeAboveGrosze?: number };
  parcel_locker?: { priceGrosze: number; freeAboveGrosze?: number };
  own_delivery?: { priceGrosze: number; freeAboveGrosze?: number };
}

/**
 * Metody cennika i nazwy ich pól w FormData. Kolejność = kolejność w cenniku
 * i na liście „dodaj metodę". `own_delivery` to metoda WŁASNA operatora
 * (własny kurier/umowa, nadanie ręczne poza integracją) — stąd osobna
 * podpowiedź przy jej wierszu.
 */
const PRICING_METHOD_DEFS = [
  {
    method: "courier",
    label: "methodCourier",
    priceName: "courierPrice",
    freeAboveName: "courierFreeAbove",
  },
  {
    method: "parcel_locker",
    label: "methodParcelLocker",
    priceName: "parcelLockerPrice",
    freeAboveName: "parcelLockerFreeAbove",
  },
  {
    method: "own_delivery",
    label: "methodOwnDelivery",
    priceName: "ownDeliveryPrice",
    freeAboveName: "ownDeliveryFreeAbove",
  },
] as const;

type PricingMethod = (typeof PRICING_METHOD_DEFS)[number]["method"];

export function PricingForm({
  action,
  canWrite,
  defaults,
  status,
  onSuccess,
}: {
  action: SettingsAction;
  canWrite: boolean;
  defaults: PricingDefaults | null;
  status: SectionStatus;
  onSuccess?: () => void;
}) {
  const t = useTranslations("orders.delivery.settings");
  const [state, formAction, pending] = useSettingsForm(action, onSuccess);
  const field = fieldBinding("pricing", state);

  /*
    Które metody mają WIERSZ cennika. Punkt wyjścia to suma: metody zapisane
    (`defaults`) oraz te, które wróciły echem po nieudanym zapisie (U9). Dzięki
    temu PIERWSZY render — także bez hydracji — niesie dokładnie te pola, które
    operator widział, więc kontrakt renderu echa zostaje spełniony. Metodę
    spoza tego zbioru operator DODAJE przyciskiem, a każdą z listy USUWA:
    usunięty wiersz znika z formularza, jego cena nie trafia do FormData i akcja
    pomija metodę w jsonb (kontrakt „pusta cena = metoda bez cennika", 0013).
  */
  const initiallyActive = PRICING_METHOD_DEFS.filter(
    (m) =>
      Boolean(defaults?.[m.method]) ||
      state.values?.[m.priceName] !== undefined ||
      state.values?.[m.freeAboveName] !== undefined,
  ).map((m) => m.method);
  const [active, setActive] = useState<PricingMethod[]>(initiallyActive);

  const activeDefs = PRICING_METHOD_DEFS.filter((m) => active.includes(m.method));
  const inactiveDefs = PRICING_METHOD_DEFS.filter((m) => !active.includes(m.method));

  const addMethod = (method: PricingMethod) =>
    setActive((prev) =>
      PRICING_METHOD_DEFS.filter((m) => prev.includes(m.method) || m.method === method).map(
        (m) => m.method,
      ),
    );
  const removeMethod = (method: PricingMethod) =>
    setActive((prev) => prev.filter((m) => m !== method));

  return (
    <ScreenSection
      data-settings-form="pricing"
      title={t("pricingTitle")}
      status={<SecondaryStatusChip axis="delivery-section" value={status.state} />}
      description={
        <>
          {t("pricingIntro")}{" "}
          <SectionMeta hint={t("pricingOptionalHint")} savedAt={status.savedAt} />
        </>
      }
    >
      <form action={formAction} className="flex flex-col gap-4 text-sm">
        {activeDefs.length === 0 ? (
          <p data-pricing-empty className="text-muted-foreground">
            {t("pricingEmpty")}
          </p>
        ) : (
          activeDefs.map(({ method, label, priceName, freeAboveName }) => {
            const entry = defaults?.[method];
            const price = field(priceName, entry ? groszeToInputValue(entry.priceGrosze) : "");
            const freeAbove = field(
              freeAboveName,
              entry?.freeAboveGrosze !== undefined ? groszeToInputValue(entry.freeAboveGrosze) : "",
            );
            return (
              <div
                key={method}
                data-pricing-method={method}
                className="border-border flex flex-col gap-2 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{t(label)}</p>
                  {canWrite ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeMethod(method)}
                      disabled={pending}
                      data-pricing-remove-method={method}
                    >
                      {t("pricingRemoveMethod")}
                    </Button>
                  ) : null}
                </div>
                {method === "own_delivery" ? (
                  <p className="text-muted-foreground text-[13px] leading-[18px]">
                    {t("pricingOwnDeliveryHint")}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <FieldLabel htmlFor={price.input.id} optional>
                      {t("priceLabel")}
                    </FieldLabel>
                    <Input
                      {...price.input}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="tabular-nums"
                      disabled={pending || !canWrite}
                    />
                    <FieldError id={price.errorId} message={price.message} />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <FieldLabel htmlFor={freeAbove.input.id} optional>
                      {t("freeAboveLabel")}
                    </FieldLabel>
                    <Input
                      {...freeAbove.input}
                      inputMode="decimal"
                      className="tabular-nums"
                      disabled={pending || !canWrite}
                    />
                    <FieldError id={freeAbove.errorId} message={freeAbove.message} />
                  </div>
                </div>
              </div>
            );
          })
        )}

        {canWrite && inactiveDefs.length > 0 ? (
          <div data-pricing-add className="flex flex-col gap-2">
            <p className="text-muted-foreground text-[13px] leading-[18px]">{t("pricingAddHint")}</p>
            <div className="flex flex-wrap gap-2">
              {inactiveDefs.map(({ method, label }) => (
                <Button
                  key={method}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => addMethod(method)}
                  disabled={pending}
                  data-pricing-add-method={method}
                >
                  {t("pricingAddMethod", { method: t(label) })}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <SaveRow
          canWrite={canWrite}
          pending={pending}
          state={state}
          label={t("savePricingCta")}
          successText={t("savedOk")}
        />
      </form>
    </ScreenSection>
  );
}
