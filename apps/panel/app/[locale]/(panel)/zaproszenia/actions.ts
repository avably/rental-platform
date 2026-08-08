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

import { revalidatePath } from "next/cache";

import { AuthError } from "@/lib/auth";
import { invitationLocale, sendInvitationEmail } from "@/lib/email";
import { panelEmailLogRecorder } from "@/lib/email-log";
import { invitationIsOpen, invitationStatus } from "@/lib/invitations";
import { requireMember } from "@/lib/supabase-server";
import { inviteSchema, invitationIdSchema } from "@/lib/validation";

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

// ---------------------------------------------------------------------------
// L4 (ADR-105): wygaszanie zaproszeń — odwołanie i ponowienie.
//
// Obie akcje są ownera (requireMember("owner")) i obie celują wierszem TYLKO
// w obrębie własnego tenanta (`.eq("tenant_id", ctx.tenantId)` obok `.eq("id")`)
// — polityki RLS 0001_core.sql robią to samo, ale zapytanie, które i tak nie
// dosięga cudzego wiersza, nie zależy od tego, czy ktoś kiedyś polityki ruszy.
// ---------------------------------------------------------------------------

/** Wiersz cyklu życia zaproszenia — tyle, ile trzeba do decyzji o operacji. */
interface InvitationLifecycle {
  id: string;
  email: string;
  role: "owner" | "staff";
  accepted_at: string | null;
  revoked_at: string | null;
  expires_at: string;
}

const LIFECYCLE_COLUMNS = "id, email, role, accepted_at, revoked_at, expires_at";

/**
 * Zaproszenie własnego tenanta w stanie pozwalającym na wygaszenie/ponowienie
 * — albo POWÓD, dla którego operacja nie ma sensu. Komunikaty rozróżniają
 * „już wykorzystane" od „już odwołane": to dwa różne fakty i operator ma
 * z nich wyciągnąć dwa różne wnioski (usuń członka vs. nic nie rób).
 */
async function loadOpenInvitation(
  ctx: Awaited<ReturnType<typeof requireMember>>,
  invitationId: string,
): Promise<{ invitation: InvitationLifecycle } | { error: string }> {
  const { data } = await ctx.supabase
    .from("invitations")
    .select(LIFECYCLE_COLUMNS)
    .eq("tenant_id", ctx.tenantId)
    .eq("id", invitationId)
    .maybeSingle();
  const invitation = data as unknown as InvitationLifecycle | null;
  if (!invitation) return { error: "Zaproszenie nie istnieje albo zostało usunięte." };

  const status = invitationStatus(invitation);
  if (status === "accepted") {
    return {
      error:
        "To zaproszenie zostało już wykorzystane — żeby odebrać dostęp, usuń osobę z sekcji „Zespół”.",
    };
  }
  if (!invitationIsOpen(status)) {
    return { error: "To zaproszenie zostało już odwołane." };
  }
  return { invitation };
}

/**
 * Odwołanie zaproszenia.
 *
 * Zapis `revoked_at` jest tylko połową roboty — drugą, ważniejszą, robi
 * `app.accept_invitation`, które odrzuca odwołany token (migracja 0051).
 * Bez tamtej zmiany przycisk meldowałby sukces, a link dalej wpuszczałby
 * obcego do organizacji.
 */
export async function revokeInvitationAction(
  _prevState: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const parsed = invitationIdSchema.safeParse({ invitationId: formData.get("invitationId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  let ctx;
  try {
    ctx = await requireMember("owner");
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }

  const loaded = await loadOpenInvitation(ctx, parsed.data.invitationId);
  if ("error" in loaded) return { error: loaded.error };

  // `.select("id")` po mutacji: RLS nie zgłasza odmowy, tylko nie dosięga
  // wiersza — pusty wynik musi być błędem, nie cichym sukcesem.
  const { data: updated, error } = await ctx.supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", parsed.data.invitationId)
    .is("accepted_at", null)
    .select("id");
  if (error) return { error: `Nie udało się odwołać zaproszenia: ${error.message}` };
  if (!updated || updated.length === 0) {
    return { error: "Nie udało się odwołać zaproszenia — odśwież stronę i spróbuj ponownie." };
  }

  revalidatePath("/", "layout");
  return { success: `Zaproszenie dla ${loaded.invitation.email} zostało odwołane.` };
}

/**
 * Ponowienie zaproszenia — z ROTACJĄ tokenu.
 *
 * Nowy link oznacza nowy `token_hash`, a że kolumna jest jedna, poprzedni
 * token przestaje istnieć w bazie i `app.accept_invitation` go nie znajdzie
 * (P0003). To jest wymóg, nie efekt uboczny: gdyby stary link działał dalej,
 * „ponowienie" mnożyłoby żywe wejścia do organizacji zamiast je zastępować.
 *
 * Kolejność: NAJPIERW rotacja w bazie, potem wysyłka. Odwrotna kolejność
 * wysyłałaby link, który nie zdążył się utrwalić.
 */
export async function resendInvitationAction(
  _prevState: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const parsed = invitationIdSchema.safeParse({ invitationId: formData.get("invitationId") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane." };
  }

  let ctx;
  try {
    ctx = await requireMember("owner");
  } catch (err) {
    if (err instanceof AuthError) return { error: err.message };
    throw err;
  }

  // Ten sam limit co przy zapraszaniu i celowo ten sam KLUCZ: ponowienie jest
  // tą samą wyrzutnią wiadomości co zaproszenie, więc nie może mieć własnej,
  // osobnej puli do wyczerpania.
  const rateLimit = await checkRateLimit(`invite:${ctx.tenantId}`, {
    limit: 10,
    windowSeconds: 60,
    prefix: PANEL_AUTH_RATE_LIMIT_PREFIX,
  });
  if (!rateLimit.success) {
    return { error: "Zbyt wiele zaproszeń w krótkim czasie. Spróbuj ponownie za chwilę." };
  }

  const loaded = await loadOpenInvitation(ctx, parsed.data.invitationId);
  if ("error" in loaded) return { error: loaded.error };
  const invitation = loaded.invitation;

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const { data: rotated, error: rotateError } = await ctx.supabase
    .from("invitations")
    .update({
      token_hash: tokenHash,
      expires_at: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", invitation.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");
  if (rotateError) {
    return { error: `Nie udało się ponowić zaproszenia: ${rotateError.message}` };
  }
  if (!rotated || rotated.length === 0) {
    return { error: "Nie udało się ponowić zaproszenia — odśwież stronę i spróbuj ponownie." };
  }

  const acceptUrl = `${siteUrl()}/zaproszenie/${rawToken}`;
  const [tenantResult, settingsResult] = await Promise.all([
    ctx.supabase.from("tenants").select("name, locale").eq("id", ctx.tenantId).maybeSingle(),
    ctx.supabase
      .from("tenant_settings")
      .select("key, value")
      .eq("tenant_id", ctx.tenantId)
      .eq("key", EMAIL_SENDER_KEY),
  ]);
  const tenant = tenantResult.data as { name: string; locale: string | null } | null;

  // Jak przy tworzeniu (ADR-036 D1): token JEST już zrotowany, poczta tego nie
  // cofa — przy niedostępnej wysyłce podajemy link do ręcznego przekazania.
  const emailProblem = !tenant
    ? "nie udało się odczytać danych organizacji"
    : await sendInvitationEmail({
        to: invitation.email,
        acceptUrl,
        locale: invitationLocale(tenant.locale),
        organizationName: tenant.name,
        role: invitation.role,
        settings: (settingsResult.data ?? []) as TenantSettingRow[],
        availability: emailAvailability(),
        transport: resendTransport(),
        recorder: panelEmailLogRecorder(ctx.supabase, ctx.tenantId!),
      });

  revalidatePath("/", "layout");
  if (emailProblem) {
    return {
      success:
        `Zaproszenie ponowione (poprzedni link przestał działać), ale e-mail nie wyszedł ` +
        `(${emailProblem}). Przekaż link ręcznie: ${acceptUrl}`,
    };
  }
  return {
    success: `Zaproszenie wysłane ponownie na ${invitation.email}. Poprzedni link przestał działać.`,
  };
}
