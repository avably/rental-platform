"use server";

import { randomBytes, createHash } from "node:crypto";

import { siteUrl } from "@avably/core";
import { PANEL_AUTH_RATE_LIMIT_PREFIX, checkRateLimit } from "@avably/security/rate-limit";

import { AuthError } from "@/lib/auth";
import { sendInvitationEmail } from "@/lib/email";
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

  await sendInvitationEmail({
    to: parsed.data.email,
    acceptUrl: `${siteUrl()}/zaproszenie/${rawToken}`,
  });

  return { success: `Zaproszenie wysłane na ${parsed.data.email}.` };
}
