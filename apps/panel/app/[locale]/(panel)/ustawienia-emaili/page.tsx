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

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

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

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <Link className="text-sm underline" href="/">
          {t("backLink")} ↩
        </Link>
      </header>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <section className="flex flex-col gap-1 rounded border p-3 text-sm">
        <p className="font-medium">{t("statusHeading")}</p>
        <p className={availability.available ? "text-status-positive-fg" : "text-status-attention-fg"}>
          {availability.available
            ? t("transportAvailable")
            : `${t("transportUnavailable")} ${availability.reason ?? ""}`}
        </p>
        <p className={senderConfigured ? "text-status-positive-fg" : "text-status-attention-fg"}>
          {senderConfigured ? t("senderConfigured") : t("senderMissing")}
        </p>
      </section>

      <EmailSenderForm defaults={defaults} />
    </div>
  );
}
