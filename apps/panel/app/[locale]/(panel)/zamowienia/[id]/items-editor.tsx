"use client";

/**
 * Powierzchnia EDYCJI POZYCJI zamówienia (uwagi przeglądu D6/N4).
 *
 * ================== CO JEST TU DECYZJĄ, A NIE STYLEM ==================
 *
 * 1. EDYCJA WYCHODZI Z TABELI, ZAMIAST SIĘ W NIĄ WCISKAĆ. Formularz nie może
 *    być dzieckiem `<tr>` (HTML na to nie pozwala i przeglądarki radzą sobie
 *    z tym różnie — a właściciel testuje w Safari, nie w Chromium). Zamiast
 *    obchodzić to atrybutem `form=` i wiarą w zgodność, edytowany wiersz
 *    otwiera PANEL pod tabelą. Przy okazji jest tam miejsce na zdanie
 *    o rejestrze kaucji, którego w komórce tabeli nigdy by nie było.
 *
 * 2. USUNIĘCIE SIEDZI W PANELU, NIE W WIERSZU. Kasowanie pozycji jednym
 *    kliknięciem w rzędzie przycisków, obok „Edytuj", to pomyłka czekająca na
 *    okazję. Ścieżka jest dwustopniowa i JAWNA (otwórz pozycję → „Usuń" →
 *    „Na pewno usunąć?"), bez `window.confirm` — dialog przeglądarki bywa
 *    blokowany, nie da się go przetestować i wygląda inaczej w każdej
 *    przeglądarce.
 *
 * 3. NIEDOSTĘPNOŚĆ POKAZUJEMY, ZAMIAST BLOKOWAĆ WYBÓR. Egzemplarze zajęte
 *    zostają na liście, opisane („zajęty w tym terminie"). Podgląd dostępności
 *    policzył serwer w chwili renderu i między renderem a kliknięciem stan
 *    mógł się zmienić — jedyną autorytatywną odpowiedzią jest bramka bazy
 *    (`assert_unit_available`, ADR-024). Ukrycie zajętych sztuk udawałoby
 *    wiedzę, której ten ekran nie ma; odmowa z bazy wraca do operatora
 *    z powodem i numerem kolidującego zamówienia.
 *
 * 4. KAUCJA POBRANA MÓWI O SOBIE W MIEJSCU ZMIANY. Gdy rejestr zna już
 *    pobranie, panel pisze wprost, że zmiana kwoty jest zmianą ZAMIARU, a nie
 *    zwrotem — bo to jest dokładnie ta chwila, w której operator mógłby
 *    pomyśleć, że oddaje klientowi pieniądze (ADR-069/070/072).
 */
import { formatMoney, type CurrencyCode, type OrderStatus } from "@avably/core";
import { Badge, Button, Input, Label, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";

import { PanelSelect, type PanelSelectOption } from "@/components/fields/panel-select";
import type { FormState } from "@/lib/form-state";
import { groszeToInputValue } from "@/lib/money-input";

import { sumOrderItemTotals } from "./items-validation";

const initialState: FormState = {};

type ItemsAction = (prevState: FormState, formData: FormData) => Promise<FormState>;

export interface EditorUnit {
  id: string;
  label: string;
  /** Wolny w terminie zamówienia — policzone silnikiem, z wykluczeniem tej pozycji. */
  free: boolean;
}

export interface EditorItem {
  id: string;
  productName: string;
  unitId: string | null;
  unitLabel: string | null;
  rentalGrosze: number;
  depositGrosze: number;
  /** Ile sztuk tego produktu jest wolnych w terminie (bez tej pozycji). */
  freeUnitCount: number;
  units: EditorUnit[];
}

export interface EditorProduct {
  id: string;
  name: string;
  freeUnits: number;
  totalUnits: number;
  /** Egzemplarze produktu z podglądem wolności w terminie zamówienia (R1). */
  units: EditorUnit[];
  /** Propozycja najmu z dat+cennika (silnik) — wartość wstępna pola „Najem". */
  proposedRentalGrosze: number;
  /** Propozycja kaucji (silnik) — wartość wstępna pola „Kaucja". */
  proposedDepositGrosze: number;
}

/** Komunikaty akcji — jedno miejsce, żeby każdy formularz mówił tak samo. */
function ActionMessages({ state }: { state: FormState }) {
  const fieldError = state.fieldErrors ? Object.values(state.fieldErrors)[0] : undefined;
  return (
    <>
      {state.formError ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {state.formError}
        </p>
      ) : null}
      {fieldError ? (
        <p role="alert" className="text-destructive w-full text-sm">
          {fieldError}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="w-full text-sm font-medium">
          {state.notice}
        </p>
      ) : null}
    </>
  );
}

/** Panel edycji jednej pozycji: egzemplarz + obie kwoty w JEDNYM zapisie. */
function ItemEditPanel({
  orderId,
  item,
  collectedGrosze,
  currency,
  locale,
  autoFocusUnit,
  onClose,
  actions,
}: {
  orderId: string;
  item: EditorItem;
  collectedGrosze: number;
  currency: CurrencyCode;
  locale: string;
  /** Wejście z plakietki „nieprzypisany": otwórz z fokusem na wyborze sztuki. */
  autoFocusUnit?: boolean;
  onClose: () => void;
  actions: { update: ItemsAction; remove: ItemsAction };
}) {
  const t = useTranslations("orders.items");
  const tDetail = useTranslations("orders.detail");
  const [updateState, updateAction, updatePending] = useActionState(actions.update, initialState);
  const [removeState, removeAction, removePending] = useActionState(actions.remove, initialState);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const unitFieldId = `item-unit-${item.id}`;

  // Wejście przez plakietkę „nieprzypisany" ma od razu postawić kursor na
  // wyborze egzemplarza — to jest dokładnie ta rzecz, po którą operator tu
  // przyszedł (R1, odkrywalność przypisania).
  useEffect(() => {
    if (!autoFocusUnit) return;
    document.getElementById(unitFieldId)?.focus();
  }, [autoFocusUnit, unitFieldId]);

  const unitOptions: PanelSelectOption[] = [
    { value: "", label: t("unitNone") },
    ...item.units.map((unit) => ({
      value: unit.id,
      label: `${unit.label} - ${unit.free ? t("unitFree") : t("unitBusy")}`,
    })),
  ];

  return (
    <div
      data-items-edit-panel
      className="border-border bg-card flex flex-col gap-3 rounded-lg border p-4"
    >
      <p className="text-sm font-semibold">{t("editTitle", { name: item.productName })}</p>

      <form action={updateAction} className="flex flex-col gap-3">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="itemId" value={item.id} />

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <Label htmlFor={unitFieldId}>{tDetail("colUnit")}</Label>
            <PanelSelect
              id={unitFieldId}
              name="unitId"
              defaultValue={item.unitId ?? ""}
              options={unitOptions}
            />
          </div>
          <div className="flex min-w-32 flex-col gap-1">
            <Label htmlFor={`item-rental-${item.id}`}>{t("fieldRental")}</Label>
            <Input
              id={`item-rental-${item.id}`}
              name="rental"
              inputMode="decimal"
              defaultValue={groszeToInputValue(item.rentalGrosze)}
            />
          </div>
          <div className="flex min-w-32 flex-col gap-1">
            <Label htmlFor={`item-deposit-${item.id}`}>{t("fieldDeposit")}</Label>
            <Input
              id={`item-deposit-${item.id}`}
              name="deposit"
              inputMode="decimal"
              defaultValue={groszeToInputValue(item.depositGrosze)}
            />
          </div>
        </div>

        {/* Zdanie stoi PRZY polu kaucji i tylko wtedy, gdy jest o czym mówić:
            rejestr zna pobranie, więc operator ma prawo pomyśleć, że obniżając
            kwotę oddaje klientowi pieniądze. Nie oddaje. */}
        {collectedGrosze > 0 ? (
          <p data-items-deposit-notice className="text-muted-foreground text-sm">
            {t("depositCollectedNotice", {
              amount: formatMoney(collectedGrosze, currency, locale),
            })}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={updatePending} disabled={updatePending}>
            {t("save")}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
        </div>
        <ActionMessages state={updateState} />
      </form>

      <form action={removeAction} className="border-border flex flex-wrap items-center gap-2 border-t pt-3">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="itemId" value={item.id} />
        {confirmRemove ? (
          <>
            <span className="text-sm">{t("removeConfirm")}</span>
            <Button type="submit" size="sm" variant="destructive" loading={removePending} disabled={removePending}>
              {t("removeConfirmCta")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
              {t("cancel")}
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRemove(true)}>
            {t("remove")}
          </Button>
        )}
        <ActionMessages state={removeState} />
      </form>
    </div>
  );
}

/** Pierwsza wolna sztuka produktu — domyślny wybór, żeby typowy dodaj był
    jednym kliknięciem; gdy wolnej nie ma, wybór pusty („bez przypisania"). */
function firstFreeUnitId(product: EditorProduct | null): string {
  return product?.units.find((unit) => unit.free)?.id ?? "";
}

/**
 * Dodanie pozycji JEDNYM krokiem (R1): produkt + egzemplarz + najem + kaucja.
 * Kwoty są wstępnie wypełnione propozycją silnika (z dat zamówienia i cennika);
 * zmiana produktu przelicza propozycję, a ręczna edycja kwoty ją nadpisuje
 * i od tej chwili trzyma się wartości operatora — dokładnie jak w panelu edycji.
 * Produkt bez wolnej sztuki nadal wchodzi (BEZ przypisania, jawnie oznaczony).
 */
function AddItemForm({
  orderId,
  products,
  action,
  onCancel,
}: {
  orderId: string;
  products: readonly EditorProduct[];
  action: ItemsAction;
  /** Zamknięcie rozwiniętego formularza (U3: formularz nie stoi na stałe). */
  onCancel: () => void;
}) {
  const t = useTranslations("orders.items");
  const tDetail = useTranslations("orders.detail");
  const [state, formAction, pending] = useActionState(action, initialState);

  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [unitId, setUnitId] = useState(() => firstFreeUnitId(products[0] ?? null));
  const [rental, setRental] = useState(() =>
    groszeToInputValue(products[0]?.proposedRentalGrosze ?? 0),
  );
  const [deposit, setDeposit] = useState(() =>
    groszeToInputValue(products[0]?.proposedDepositGrosze ?? 0),
  );
  // Po ręcznej korekcie propozycja PRZESTAJE nadpisywać kwoty — decyzja
  // operatora ma pierwszeństwo (lustro ItemEditPanel z jego defaultValue).
  const [amountsTouched, setAmountsTouched] = useState(false);

  if (products.length === 0) {
    return (
      <p data-items-add className="text-muted-foreground text-sm">
        {t("addNoProducts")}
      </p>
    );
  }

  const selected = products.find((product) => product.id === productId) ?? null;

  function changeProduct(nextId: string) {
    setProductId(nextId);
    const next = products.find((product) => product.id === nextId) ?? null;
    // Nowy produkt → domyślnie jego pierwsza wolna sztuka i JEGO propozycja
    // kwot (przeliczana z dat zamówienia). Ręcznie wpisanych kwot nie ruszamy.
    setUnitId(firstFreeUnitId(next));
    if (!amountsTouched && next) {
      setRental(groszeToInputValue(next.proposedRentalGrosze));
      setDeposit(groszeToInputValue(next.proposedDepositGrosze));
    }
  }

  const unitOptions: PanelSelectOption[] = [
    { value: "", label: t("unitNone") },
    ...(selected?.units ?? []).map((unit) => ({
      value: unit.id,
      label: `${unit.label} - ${unit.free ? t("unitFree") : t("unitBusy")}`,
    })),
  ];

  return (
    <form
      action={formAction}
      data-items-add
      className="border-border flex flex-col gap-3 rounded-md border p-3"
    >
      <input type="hidden" name="orderId" value={orderId} />
      <p className="text-sm font-semibold">{t("addTitle")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <Label htmlFor="add-item-product">{t("addProduct")}</Label>
          <PanelSelect
            id="add-item-product"
            name="productId"
            value={productId}
            onValueChange={changeProduct}
            options={products.map((product) => ({
              value: product.id,
              label:
                product.freeUnits > 0
                  ? t("productFree", { name: product.name, count: product.freeUnits })
                  : t("productNoFree", { name: product.name }),
            }))}
          />
        </div>
        <div className="flex min-w-52 flex-1 flex-col gap-1">
          <Label htmlFor="add-item-unit">{tDetail("colUnit")}</Label>
          <PanelSelect
            id="add-item-unit"
            name="unitId"
            value={unitId}
            onValueChange={setUnitId}
            options={unitOptions}
          />
        </div>
        <div className="flex min-w-32 flex-col gap-1">
          <Label htmlFor="add-item-rental">{t("fieldRental")}</Label>
          <Input
            id="add-item-rental"
            name="rental"
            inputMode="decimal"
            value={rental}
            onChange={(event) => {
              setAmountsTouched(true);
              setRental(event.target.value);
            }}
          />
        </div>
        <div className="flex min-w-32 flex-col gap-1">
          <Label htmlFor="add-item-deposit">{t("fieldDeposit")}</Label>
          <Input
            id="add-item-deposit"
            name="deposit"
            inputMode="decimal"
            value={deposit}
            onChange={(event) => {
              setAmountsTouched(true);
              setDeposit(event.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="outline" loading={pending} disabled={pending}>
          {t("addCta")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
      {/* Ostrzeżenie PRZED kliknięciem, nie po: operator ma wiedzieć, że kupuje
          pozycję bez przypisania, zanim ją doda (uwaga N4). */}
      {selected && selected.freeUnits === 0 ? (
        <p data-items-add-warning className="text-sm">
          {selected.totalUnits === 0 ? t("addNoUnitsAtAll") : t("addNoFreeWarning")}
        </p>
      ) : null}
      <ActionMessages state={state} />
    </form>
  );
}

export function ItemsEditor({
  orderId,
  orderStatus,
  editable,
  items,
  products,
  collectedGrosze,
  totalRentalGrosze,
  totalDepositGrosze,
  currency,
  locale,
  actions,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  editable: boolean;
  items: readonly EditorItem[];
  products: readonly EditorProduct[];
  collectedGrosze: number;
  totalRentalGrosze: number;
  totalDepositGrosze: number;
  currency: CurrencyCode;
  locale: string;
  actions: { add: ItemsAction; update: ItemsAction; remove: ItemsAction };
}) {
  const t = useTranslations("orders.items");
  const tDetail = useTranslations("orders.detail");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Czy edycję otwarto przez plakietkę „nieprzypisany" — wtedy fokus ma iść
  // od razu na wybór egzemplarza. Zwykłe „Edytuj" tego nie robi.
  const [focusUnit, setFocusUnit] = useState(false);
  // Formularz dodawania jest ZWINIĘTY do przycisku (U3, audyt 2.5): stale
  // rozwinięty blok z kwotami wyglądał jak niedokończona edycja na KAŻDYM
  // zamówieniu, także tam, gdzie nikt nic nie dodaje.
  const [adding, setAdding] = useState(false);

  const editing = editable ? (items.find((item) => item.id === editingId) ?? null) : null;

  function toggleEdit(itemId: string) {
    setFocusUnit(false);
    setEditingId((current) => (current === itemId ? null : itemId));
  }

  function openAssign(itemId: string) {
    setFocusUnit(true);
    setEditingId(itemId);
  }

  // Sumy POKAZUJEMY z kolumn zamówienia — to ich używa faktura, e-mail
  // i lista. Sumę pozycji liczymy obok WYŁĄCZNIE po to, żeby rozjazd (np. po
  // nieudanym kroku przeliczenia) był widoczny, zamiast cicho żyć w bazie.
  const fromItems = sumOrderItemTotals(items);
  const drifted =
    fromItems.totalRentalGrosze !== totalRentalGrosze ||
    fromItems.totalDepositGrosze !== totalDepositGrosze;

  const headClass =
    "text-muted-foreground px-3.5 text-[11px] font-semibold tracking-[0.06em] uppercase";
  const headRightClass = `${headClass} text-right`;

  // Pozycje bez egzemplarza (U3, audyt 2.5): na ŻYWYM zamówieniu to brakujący
  // krok przed wydaniem — ma własne ostrzeżenie z akcją, nie tylko plakietkę
  // w komórce. Na zamówieniu zamkniętym ostrzeżenie by obiecywało przyszłość,
  // której nie ma — stąd warunek `editable`.
  const unassigned = items.filter((item) => item.unitId === null);

  return (
    <div className="flex flex-col gap-3">
      {editable && unassigned.length > 0 ? (
        <div
          data-items-unassigned-warning
          role="status"
          className="border-status-attention-border bg-status-attention-bg flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
        >
          <p className="text-status-attention-fg text-sm font-medium">
            {t("unassignedWarning", { count: unassigned.length })}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-items-assign-first
            onClick={() => openAssign(unassigned[0]!.id)}
          >
            {t("assignUnit")}
          </Button>
        </div>
      ) : null}

      <div
        data-items-table
        className="border-border bg-card overflow-x-auto rounded-lg border"
      >
        <Table>
          <TableHeader>
            <TableRow className="hover:border-b-border">
              <TableHead className={headClass}>{tDetail("colProduct")}</TableHead>
              <TableHead className={headClass}>{tDetail("colUnit")}</TableHead>
              <TableHead className={headRightClass}>{tDetail("colRental")}</TableHead>
              <TableHead className={headRightClass}>{tDetail("colDeposit")}</TableHead>
              {editable ? (
                <TableHead className={headRightClass}>{t("colActions")}</TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} data-items-row>
                <TableCell className="px-3.5 py-3">{item.productName}</TableCell>
                <TableCell className="px-3.5 py-3">
                  {item.unitId ? (
                    item.unitLabel
                  ) : editable ? (
                    // Plakietka „nieprzypisany" JEST wejściem w przypisanie:
                    // klik otwiera panel edycji tej pozycji z fokusem na
                    // wyborze egzemplarza (R1, odkrywalność). `items-start`
                    // trzyma przycisk przy treści, a nie na całą szerokość.
                    <button
                      type="button"
                      data-items-assign-trigger
                      onClick={() => openAssign(item.id)}
                      aria-label={t("assignUnit")}
                      className="hover:bg-muted focus-visible:ring-ring flex flex-col items-start gap-1 rounded-md text-left focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <Badge variant="outline">{tDetail("unitUnassigned")}</Badge>
                      {/* Powód liczony NA ŻYWO (patrz items-section.tsx):
                          „niedostępne" zapisane w bazie zestarzałoby się
                          w godzinę. */}
                      <span className="text-muted-foreground text-xs">
                        {item.freeUnitCount === 0
                          ? t("unassignedNoFree")
                          : t("unassignedHasFree", { count: item.freeUnitCount })}
                      </span>
                    </button>
                  ) : (
                    // Zamówienie zamknięte: plakietka informuje, nie zaprasza do
                    // kliknięcia (powód blokady stoi pod tabelą — `data-items-locked`).
                    <span className="flex flex-col items-start gap-1">
                      <Badge variant="outline">{tDetail("unitUnassigned")}</Badge>
                      <span className="text-muted-foreground text-xs">
                        {item.freeUnitCount === 0
                          ? t("unassignedNoFree")
                          : t("unassignedHasFree", { count: item.freeUnitCount })}
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="px-3.5 py-3 text-right tabular-nums tracking-[0.01em]">
                  {formatMoney(item.rentalGrosze, currency, locale)}
                </TableCell>
                <TableCell className="px-3.5 py-3 text-right tabular-nums tracking-[0.01em]">
                  {formatMoney(item.depositGrosze, currency, locale)}
                </TableCell>
                {editable ? (
                  <TableCell className="px-3.5 py-3 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-items-edit-trigger
                      aria-expanded={editingId === item.id}
                      onClick={() => toggleEdit(item.id)}
                    >
                      {t("edit")}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
            {items.length === 0 ? (
              <TableRow>
                <TableCell className="text-muted-foreground px-3.5 py-3" colSpan={editable ? 5 : 4}>
                  {t("empty")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm font-medium">
        {tDetail("totalRental")}:{" "}
        <span className="tabular-nums tracking-[0.01em]">
          {formatMoney(totalRentalGrosze, currency, locale)}
        </span>
        {totalDepositGrosze > 0 ? (
          <>
            {" · "}
            {tDetail("totalDeposit")}:{" "}
            <span className="tabular-nums tracking-[0.01em]">
              {formatMoney(totalDepositGrosze, currency, locale)}
            </span>
          </>
        ) : null}
      </p>

      {drifted ? (
        <p role="alert" data-items-drift className="text-destructive text-sm">
          {t("totalsDrift", {
            rental: formatMoney(fromItems.totalRentalGrosze, currency, locale),
            deposit: formatMoney(fromItems.totalDepositGrosze, currency, locale),
          })}
        </p>
      ) : null}

      {editing ? (
        <ItemEditPanel
          key={editing.id}
          orderId={orderId}
          item={editing}
          collectedGrosze={collectedGrosze}
          currency={currency}
          locale={locale}
          autoFocusUnit={focusUnit}
          onClose={() => setEditingId(null)}
          actions={{ update: actions.update, remove: actions.remove }}
        />
      ) : null}

      {editable ? (
        adding ? (
          <AddItemForm
            orderId={orderId}
            products={products}
            action={actions.add}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            data-items-add-trigger
            aria-expanded={false}
            onClick={() => setAdding(true)}
            className="self-start"
          >
            {t("addTitle")}
          </Button>
        )
      ) : (
        <p data-items-locked className="text-muted-foreground text-sm">
          {orderStatus === "picked_up" ? t("lockedPickedUp") : t("lockedClosed")}
        </p>
      )}
    </div>
  );
}
