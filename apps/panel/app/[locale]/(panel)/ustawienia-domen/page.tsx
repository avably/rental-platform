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

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink } from "@/components/screens/screen-header";
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

  // Miara formularza (P8): karty adresów, instrukcja DNS i formularz dodania
  // czytają się jak jeden wiersz treści, więc idą pod wspólną szerokość.
  // Tabel na tym ekranie nie ma — nic nie zostaje poza miarą.
  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={`← ${t("backLink")}`} />
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      {/* Powód braku konfiguracji (nazwy zmiennych z `VercelConfigError`)
          NIE schodzi do klienta (U1, audyt W3): to sprawa platformy, a ekran
          tłumaczy stan na neutralne zdania ze słownika. Wyjaśnienie przy
          wyszarzonym przycisku ponowienia daje `retryUnavailable`. */}
      <DomainsPanel
        domains={domains}
        cnameTarget={CUSTOM_DOMAIN_CNAME_TARGET}
        registrationAvailable={availability.available}
      />
    </FormMeasure>
  );
}
