"use server";

import { randomBytes, createHash } from "node:crypto";

import {
  EMAIL_SENDER_KEY,
  emailAvailability,
  resendTransport,
  siteUrl,
  type TenantSettingRow,
} from "@avably/core";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { AuthError } from "@/lib/auth";
import { invitationLocale, sendInvitationEmail } from "@/lib/email";
import { panelEmailLogRecorder } from "@/lib/email-log";
import { requireMember } from "@/lib/supabase-server";
import { inviteSchema } from "@/lib/validation";

export interface InviteMemberState {
  error?: string;
  success?: string;
}

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function inviteMemberAction(
  _prevState: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  let ctx;
  try {
    // Tylko owner tenanta może zapraszać — polityka RLS na invitations
    // (tenant_insert, 0001_core.sql) i tak by to wymusiła, ale guard daje
    // czytelny komunikat zamiast surowego błędu PostgREST.
    ctx = await requireMember("owner");
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }

  // Limit per tenant — żeby owner nie spamował Resend ani nie enumerował
  // adresów przez masowe zaproszenia. Klucz po tenant_id (nie IP), bo to
  // akcja uwierzytelniona i to organizacja jest jednostką nadużycia.
  const rateLimit = await checkRateLimit(`invite:${ctx.tenantId}`, {
    limit: 10,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    return { error: "Zbyt wiele zaproszeń w krótkim czasie. Spróbuj ponownie za chwilę." };
  }

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const { error } = await ctx.supabase.from("invitations").insert({
    tenant_id: ctx.tenantId,
    email: parsed.data.email,
    role: parsed.data.role,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
  });
  if (error) {
    return { error: error.message };
  }

  const acceptUrl = `${siteUrl()}/zaproszenie/${rawToken}`;

  // Dane do wiadomości: nazwa+locale tenanta (From i treść) oraz nadawca
  // (reply_to). Jedna runda zapytań, bo są niezależne.
  const [tenantResult, settingsResult] = await Promise.all([
    ctx.supabase.from("tenants").select("name, locale").eq("id", ctx.tenantId).maybeSingle(),
    ctx.supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", ctx.tenantId)
      .eq("key", EMAIL_SENDER_KEY),
  ]);
  const tenant = tenantResult.data as { name: string; locale: string | null } | null;

  // Zaproszenie JEST już utrwalone — poczta go nie cofa (ADR-036 D1). Brak
  // danych tenanta albo niedostępny transport to nie porażka operacji, tylko
  // powód, przy którym podajemy link do ręcznego przekazania.
  const emailProblem = !tenant
    ? "nie udało się odczytać danych organizacji"
    : await sendInvitationEmail({
        to: parsed.data.email,
        acceptUrl,
        locale: invitationLocale(tenant.locale),
        organizationName: tenant.name,
        role: parsed.data.role,
        settings: (settingsResult.data ?? []) as TenantSettingRow[],
        availability: emailAvailability(),
        transport: resendTransport(),
        recorder: panelEmailLogRecorder(ctx.supabase, ctx.tenantId!),
      });

  if (emailProblem) {
    return {
      success: `Zaproszenie utworzone, ale e-mail nie wyszedł (${emailProblem}). Przekaż link ręcznie: ${acceptUrl}`,
    };
  }
  return { success: `Zaproszenie wysłane na ${parsed.data.email}.` };
}
