"use client";

/**
 * Wybór klienta zamówienia (R3, pinezka bed18451: „input do wyszukiwania
 * klientów i dodania jeśli nie znajdzie starego").
 *
 * STAN PRZED: lista rozwijana ze WSZYSTKIMI klientami tenanta plus para
 * przycisków radiowych „istniejący / nowy". Przy kilkunastu klientach to
 * działa; przy kilkuset lista rozwijana przestaje być wyborem, a staje się
 * przewijaniem.
 *
 * Dopasowanie liczy `customerMatchesSearch` — DOKŁADNIE ta sama funkcja, na
 * której stoi wyszukiwarka listy klientów (R6a). Jedna definicja tego, co
 * znaczy „pasuje do frazy": imię i nazwisko, e-mail, telefon. Gdyby kreator
 * miał własną, dwa ekrany odpowiadałyby różnie na to samo pytanie.
 *
 * Filtrowanie dzieje się NAD WCZYTANĄ STRONĄ wyników, spójnie z listą
 * klientów — a strona jest ucięta limitem. Ucięcie NIE JEST przemilczane:
 * gdy tenant ma więcej klientów niż mieści strona, pod wynikami stoi zdanie
 * mówiące to wprost. Cicha wyszukiwarka po niepełnym zbiorze potrafi
 * powiedzieć „nie znaleziono" o kliencie, który istnieje.
 */
import { Button, Input, Label } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { customerMatchesSearch } from "@/lib/customers/customer-search";

import type { WizardCustomer } from "./wizard-data";

/** Ile podpowiedzi pokazujemy naraz — lista ma podpowiadać, nie przewijać się. */
const SUGGESTION_LIMIT = 8;

export interface CustomerPickerState {
  /** Wybrany klient z kartoteki albo `null` (brak wyboru lub tryb „nowy"). */
  selected: WizardCustomer | null;
  /** Czy operator zakłada nowego klienta w locie. */
  creating: boolean;
}

export function CustomerPicker({
  customers,
  truncated,
  state,
  onChange,
  fieldErrors,
  errorSlot,
}: {
  customers: WizardCustomer[];
  /** Czy odczyt kartoteki został ucięty limitem strony. */
  truncated: boolean;
  state: CustomerPickerState;
  onChange: (next: CustomerPickerState) => void;
  fieldErrors: Record<string, string> | undefined;
  errorSlot: (field: string) => React.ReactNode;
}) {
  const t = useTranslations("orders.form");
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const needle = query.trim();
    if (needle === "") return [];
    return customers.filter((customer) =>
      customerMatchesSearch(
        { id: customer.id, fullName: customer.full_name, email: customer.email, phone: customer.phone },
        needle,
      ),
    );
  }, [customers, query]);

  const shown = matches.slice(0, SUGGESTION_LIMIT);
  const searching = query.trim() !== "";

  // Klient wybrany z kartoteki — karta z tym, co o nim wiemy, i drogą powrotną.
  if (state.selected) {
    const customer = state.selected;
    return (
      <div className="border-border bg-card flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="flex flex-col gap-0.5 text-sm">
          <span className="font-semibold">{customer.full_name ?? customer.email}</span>
          {customer.full_name ? <span className="text-muted-foreground">{customer.email}</span> : null}
          {customer.phone ? <span className="text-muted-foreground">{customer.phone}</span> : null}
          <span className="text-muted-foreground">{customerAddressLine(customer) ?? t("customerNoAddress")}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setQuery("");
            onChange({ selected: null, creating: false });
          }}
        >
          {t("changeCustomer")}
        </Button>
        <input type="hidden" name="customerId" value={customer.id} />
      </div>
    );
  }

  // Zakładanie klienta w locie — te same nazwy pól co przed R3, więc akcja
  // serwerowa i jej schemat nie widzą różnicy.
  if (state.creating) {
    return (
      <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-new-email">{t("newCustomerEmail")}</Label>
            <Input
              id="order-new-email"
              name="newCustomerEmail"
              type="email"
              required
              autoFocus
              aria-invalid={fieldErrors?.newCustomerEmail ? true : undefined}
              aria-describedby={fieldErrors?.newCustomerEmail ? "order-newCustomerEmail-error" : undefined}
            />
            {errorSlot("newCustomerEmail")}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-new-name">{t("newCustomerName")}</Label>
            <Input id="order-new-name" name="newCustomerName" maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-new-phone">{t("newCustomerPhone")}</Label>
            <Input id="order-new-phone" name="newCustomerPhone" maxLength={32} />
          </div>
        </div>
        <div>
          <Button type="button" variant="outline" onClick={() => onChange({ selected: null, creating: false })}>
            {t("cancelNewCustomer")}
          </Button>
        </div>
        {/* Tryb „nowy" nie wskazuje istniejącego klienta — puste pole domyka
            regułę „dokładnie jeden" ze schematu, tak jak przed R3. */}
        <input type="hidden" name="customerId" value="" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="order-customer-search">{t("customerSearchLabel")}</Label>
        <Input
          id="order-customer-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("customerSearchPlaceholder")}
          autoComplete="off"
          aria-invalid={fieldErrors?.customerId ? true : undefined}
          aria-describedby={fieldErrors?.customerId ? "order-customerId-error" : undefined}
          data-customer-search
        />
      </div>

      {searching ? (
        <div className="flex flex-col gap-2">
          {shown.length === 0 ? (
            <p className="text-muted-foreground text-sm" role="status">
              {t("customerNoMatch", { query: query.trim() })}
            </p>
          ) : (
            <ul className="border-border divide-border divide-y rounded-lg border" data-customer-results>
              {shown.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => onChange({ selected: customer, creating: false })}
                    className="hover:bg-secondary focus-visible:outline-accent dark:focus-visible:outline-ring flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:-outline-offset-2"
                  >
                    <span className="font-medium">{customer.full_name ?? customer.email}</span>
                    <span className="text-muted-foreground text-xs">
                      {[customer.full_name ? customer.email : null, customer.phone]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {matches.length > shown.length ? (
            <p className="text-muted-foreground text-xs">
              {t("customerMoreMatches", { count: matches.length - shown.length })}
            </p>
          ) : null}
          {truncated ? <p className="text-muted-foreground text-xs">{t("customerListTruncated")}</p> : null}
        </div>
      ) : null}

      <div>
        <Button type="button" variant="outline" onClick={() => onChange({ selected: null, creating: true })}>
          {t("quickAddCustomer")}
        </Button>
      </div>

      {/* Bez wyboru i bez trybu „nowy" pole jedzie puste — schemat odmówi
          z powodem „wybierz klienta ALBO podaj e-mail nowego". */}
      <input type="hidden" name="customerId" value="" />
      {errorSlot("customerId")}
    </div>
  );
}

/** Adres z kartoteki jako jedna linia; `null`, gdy kartoteka go nie ma. */
export function customerAddressLine(customer: WizardCustomer): string | null {
  const street = customer.address_street?.trim() ?? "";
  const zip = customer.address_zip?.trim() ?? "";
  const city = customer.address_city?.trim() ?? "";
  if (street === "" && zip === "" && city === "") return null;
  const locality = [zip, city].filter((part) => part !== "").join(" ");
  return [street, locality].filter((part) => part !== "").join(", ");
}
