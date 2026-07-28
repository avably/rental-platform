"use client";

import { cn } from "@avably/ui";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";

/**
 * Karta „Profil klienta” (uwaga przeglądu D1). Konsoliduje dane klienta, dziś
 * rozproszone po panelu bocznym (e-mail/telefon), w jedną kartę z pełnym
 * adresem i przyciskiem KOPIUJ przy każdym wierszu.
 *
 * Wszystkie pola pochodzą z modelu `customers` (email, full_name, phone oraz
 * address_street/zip/city, company_name, nip) — BEZ migracji. Wiersz bez
 * wartości nie znika po cichu: pokazuje „nie podano”, żeby brak był
 * odnotowany, a nie zgadywany.
 */
export interface CustomerCardData {
  /**
   * Identyfikator klienta — wejście do jego karty (R6a). Opcjonalny, bo karta
   * bywa renderowana także w kontrakcie parytetu szkieletu bez pełnego wiersza;
   * bez niego link „Karta klienta" po prostu się nie pojawia.
   */
  customerId?: string | null;
  fullName: string | null;
  email: string;
  phone: string | null;
  addressStreet: string | null;
  addressZip: string | null;
  addressCity: string | null;
  companyName: string | null;
  nip: string | null;
}

function initials(name: string | null, email: string): string {
  const source = name?.trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "");
    if (letters) return letters.toUpperCase();
  }
  return (email.trim()[0] ?? "?").toUpperCase();
}

function composeAddress(data: CustomerCardData): string | null {
  const cityLine = [data.addressZip, data.addressCity].filter(Boolean).join(" ").trim();
  const line = [data.addressStreet, cityLine].filter(Boolean).join(", ").trim();
  return line.length > 0 ? line : null;
}

function MailIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3 5.5l7 5 7-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M6.5 3.5l1.4 3-1.3 1.3a9 9 0 004.6 4.6l1.3-1.3 3 1.4v3a1 1 0 01-1.1 1A13 13 0 013.5 5.6 1 1 0 014.5 4.5z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <path d="M10 17s5.5-4.4 5.5-8.5a5.5 5.5 0 10-11 0C4.5 12.6 10 17 10 17z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="10" cy="8.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="12" height="14" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <path d="M7 6.5h2M11 6.5h2M7 9.5h2M11 9.5h2M7 12.5h2M11 12.5h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CopyButton({ value, fieldLabel }: { value: string; fieldLabel: string }) {
  const t = useTranslations("orders.customer");
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      data-copy-button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Schowek bywa niedostępny (brak uprawnień, http) — bez wyjątku do UI.
        }
      }}
      aria-label={t("copyField", { field: fieldLabel })}
      className={cn(
        "text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors hover:border-border focus-visible:ring-2 focus-visible:outline-none",
        copied && "text-primary",
      )}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.5 5.5V4a1 1 0 00-1-1H4a1 1 0 00-1 1v5.5a1 1 0 001 1h1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span aria-live="polite" className="sr-only">
        {copied ? t("copied", { field: fieldLabel }) : ""}
      </span>
    </button>
  );
}

function Row({
  fieldKey,
  icon,
  label,
  children,
  copyValue,
}: {
  fieldKey: string;
  icon: ReactNode;
  label: string;
  children: ReactNode;
  copyValue: string | null;
}) {
  return (
    <div data-customer-field={fieldKey} className="flex items-center gap-3">
      <span className="text-muted-foreground mt-0.5 shrink-0" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <dt className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
          {label}
        </dt>
        <dd className="text-foreground text-sm leading-[20px] break-words">{children}</dd>
      </div>
      {copyValue ? <CopyButton value={copyValue} fieldLabel={label} /> : null}
    </div>
  );
}

export function CustomerCard({ data }: { data: CustomerCardData }) {
  const t = useTranslations("orders.customer");
  const address = composeAddress(data);
  const displayName = data.fullName?.trim() || data.email;
  const notProvided = <span className="text-muted-foreground">{t("notProvided")}</span>;

  return (
    <section
      data-customer-card
      aria-labelledby="customer-card-heading"
      className="border-border bg-card flex flex-col gap-4 rounded-md border p-5"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="bg-muted text-foreground flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
        >
          {initials(data.fullName, data.email)}
        </span>
        <div className="min-w-0">
          <p id="customer-card-heading" className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.08em] uppercase">
            {t("title")}
          </p>
          <p className="text-foreground truncate text-base leading-tight font-semibold">
            {displayName}
          </p>
        </div>
      </div>

      <dl className="flex flex-col gap-3">
        <Row fieldKey="email" icon={<MailIcon />} label={t("email")} copyValue={data.email}>
          <a className="hover:underline" href={`mailto:${data.email}`}>
            {data.email}
          </a>
        </Row>
        <Row fieldKey="phone" icon={<PhoneIcon />} label={t("phone")} copyValue={data.phone}>
          {data.phone ? (
            <a className="hover:underline" href={`tel:${data.phone}`}>
              {data.phone}
            </a>
          ) : (
            notProvided
          )}
        </Row>
        <Row fieldKey="address" icon={<PinIcon />} label={t("address")} copyValue={address}>
          {address ?? notProvided}
        </Row>
        {data.companyName || data.nip ? (
          <Row
            fieldKey="company"
            icon={<BuildingIcon />}
            label={t("company")}
            copyValue={data.nip ?? data.companyName}
          >
            {data.companyName}
            {data.companyName && data.nip ? " · " : null}
            {data.nip ? <span className="tabular-nums">{t("nip", { nip: data.nip })}</span> : null}
          </Row>
        ) : null}
      </dl>

      {/* Wejście do pełnej karty klienta (R6a): edycja danych, faktura, adres i
          historia zamówień. Bez id (fixture kontraktu) link się nie pojawia. */}
      {data.customerId ? (
        <Link
          href={`/klienci/${data.customerId}`}
          data-customer-card-link
          className="border-border text-foreground hover:bg-muted focus-visible:ring-ring inline-flex h-9 w-fit items-center gap-1.5 rounded-md border px-3 text-sm font-medium no-underline transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {t("goToCard")}
          <ArrowIcon />
        </Link>
      ) : null}
    </section>
  );
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
