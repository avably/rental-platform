/**
 * Ustawienia domen sklepu (Zadanie 2.6, ADR-046).
 *
 * Ekran pokazuje OBIE osi hostów naraz, bo najemca myśli o nich jako o jednym
 * pytaniu „pod jakim adresem działa mój sklep":
 *   * SUBDOMENA platformy — nadana automatycznie przy zakładaniu organizacji,
 *     działa od razu, nie wymaga niczego od najemcy. Nieusuwalna.
 *   * WŁASNE DOMENY — dodawane tu, wymagają rekordu CNAME u REJESTRATORA
 *     najemcy. Tego kroku nie automatyzujemy: dostępu do cudzego DNS-u nie
 *     mamy i mieć nie chcemy.
 *
 * Ekran pokazuje też JAWNIE stan konfiguracji rejestracji (`availability`,
 * liczone na serwerze — token nie schodzi do klienta) oraz `last_error` z
 * ostatniej próby. Bez tego nieudana rejestracja byłaby ciszą: wiersz istnieje,
 * sklep nie odpowiada, a najemca nie ma jak się dowiedzieć dlaczego.
 *
 * Dostęp dla każdego członka, spójnie z RLS 0019 (jak ustawienia e-maili).
 */
import { CUSTOM_DOMAIN_CNAME_TARGET, vercelDomainsAvailability } from "@avably/core";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

import { DomainsPanel, type DomainRow } from "./domains-panel";
import { readableDomainError } from "./domains-validation";

export default async function DomainSettingsPage() {
  const ctx = await requireMemberPage("/ustawienia-domen");
  const t = await getTranslations("domainSettings");

  const { data: rows } = await ctx.supabase
    .from("domains")
    .select("id, domain, kind, verified, verified_at, last_error, provider_domain_id")
    .eq("tenant_id", ctx.tenantId)
    .order("kind", { ascending: true })
    .order("created_at", { ascending: true });

  const domains: DomainRow[] = (rows ?? []).map((row) => ({
    id: row.id as string,
    domain: row.domain as string,
    kind: row.kind === "custom" ? "custom" : "subdomain",
    verified: row.verified === true,
    verifiedAt: (row.verified_at as string | null) ?? null,
    // Powód skracany na SERWERZE — do klienta nie ma po co schodzić dump
    // strony serwisowej dostawcy (pełna treść zostaje w bazie dla operatora).
    lastError: readableDomainError((row.last_error as string | null) ?? null),
    // NULL = host nigdy nie doszedł do dostawcy (awaria albo wiersz z
    // backfillu 0022). To jest jedyny sygnał, po którym ekran wie, że sklep
    // pod tym adresem NIE odpowie — `verified` dla subdomeny jest zawsze true.
    registered: Boolean(row.provider_domain_id),
  }));

  // Dostępność rejestracji liczona na SERWERZE (token nie schodzi do klienta).
  const availability = vercelDomainsAvailability();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Link className="text-sm underline" href="/">
          {t("backLink")} ↩
        </Link>
      </header>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      {!availability.available && (
        <p role="status" className="rounded border p-3 text-sm text-status-attention-fg">
          {t("registrationUnavailable")} {availability.reason}
        </p>
      )}

      {/* Powód braku konfiguracji schodzi do klienta ŚWIADOMIE: to komunikat
          `VercelConfigError` (nazwy brakujących zmiennych), nigdy ich wartości
          — bez niego przycisk ponowienia byłby wyszarzony bez wyjaśnienia. */}
      <DomainsPanel
        domains={domains}
        cnameTarget={CUSTOM_DOMAIN_CNAME_TARGET}
        registrationAvailable={availability.available}
        registrationBlockedReason={availability.available ? null : (availability.reason ?? null)}
      />
    </div>
  );
}
