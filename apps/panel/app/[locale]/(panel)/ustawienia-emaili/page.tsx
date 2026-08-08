/**
 * Ustawienia e-maili (ADR-036): nadawca wiadomości tenanta (klucz email_sender,
 * CHECK 0014) + STAN dostępności wysyłki. To JEDYNE miejsce, gdzie operator widzi
 * KOMPLETNOŚĆ konfiguracji poczty: czy transport jest dostępny (RESEND_API_KEY,
 * liczone na serwerze) i czy nadawca jest ustawiony.
 *
 * Dostęp dla każdego członka, spójnie z RLS 0007 (jak ustawienia dostaw).
 * Dojście: link ze strony głównej panelu.
 */
import { EMAIL_SENDER_KEY, emailAvailability } from "@avably/core";
import { getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink, ScreenSection } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import { EmailSenderForm, type EmailSenderDefaults } from "./email-settings-form";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const s = (value: unknown): string => (typeof value === "string" ? value : "");

export default async function EmailSettingsPage() {
  const ctx = await requireMemberPage("/ustawienia-emaili");
  const t = await getTranslations("emailSettings");

  const { data: rows } = await ctx.supabase
    .from("tenant_settings")
    .select("key, value")
    .eq("tenant_id", ctx.tenantId)
    .eq("key", EMAIL_SENDER_KEY);

  const sender = asRecord(rows?.[0]?.value);
  const defaults: EmailSenderDefaults | null = sender
    ? { name: s(sender.name), replyTo: s(sender.reply_to) }
    : null;

  // Dostępność transportu liczona na SERWERZE (klucz nie schodzi do klienta).
  const availability = emailAvailability();
  const senderConfigured = defaults !== null && defaults.name.length > 0;

  // Układ P8 (artefakt, `secondary-email-settings`): stan transportu NAD
  // formularzem nadawcy. Wysyłka niedostępna zmienia znaczenie tego, co
  // operator za chwilę zapisze — więc musi być przeczytana wcześniej, ale nie
  // ma prawa zasłonić danych. Stąd karta stanu, a nie baner nad ekranem.
  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={`← ${t("backLink")}`} />
      <p className="text-muted-foreground text-sm">{t("intro")}</p>

      <ScreenSection
        data-email-health
        title={t("statusHeading")}
        status={
          <SecondaryStatusChip
            axis="email-transport"
            value={availability.available ? "available" : "unavailable"}
          />
        }
        description={
          // Powód z serwera ŚWIADOMIE nie schodzi na ekran (U1, audyt W3):
          // brak transportu to sprawa platformy — najemca dostaje neutralne
          // zdanie ze słownika, bez nazw zmiennych i bez fałszywego zadania.
          availability.available ? t("transportAvailable") : t("transportUnavailable")
        }
      />

      <EmailSenderForm defaults={defaults} configured={senderConfigured} />
    </FormMeasure>
  );
}
