import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getAuthContext } from "@/lib/auth";
import { INVITATION_STATE_MESSAGE_KEY, readInvitationState } from "@/lib/invitation-state";
import { localePath } from "@/lib/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { acceptInvitationSchema } from "@/lib/validation";

import { AcceptInvitationForm } from "./form";

/**
 * Ekran akceptacji używa stanu zaproszenia PROAKTYWNIE (ADR-196): zamiast
 * kazać człowiekowi klikać „Dołącz" w martwy token, pyta o stan JEDNYM
 * odczytem (`app.invitation_state`, 0087) i przy stanie ≠ `open` pokazuje
 * komunikat per stan zamiast przycisku. Uszkodzony token (nie przejdzie
 * walidacji formatu) dostaje komunikat o uszkodzonym linku bez pytania bazy.
 *
 * FAIL-OPEN NA FORMULARZ, fail-closed na wejście: gdy odczyt stanu padnie,
 * ekran pokazuje formularz jak dotąd — bramką wejścia do organizacji jest
 * wyłącznie `app.accept_invitation` (to on waliduje token przy kliknięciu),
 * więc pokazanie przycisku niczego nie otwiera, a chowanie go na błędzie
 * odczytu odcinałoby żywe zaproszenia przy usterce przejściowej.
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createSupabaseServerClient();
  const ctx = await getAuthContext(supabase);
  if (!ctx) redirect(await localePath("/login", { next: `/zaproszenie/${token}` }));

  const t = await getTranslations("invitationAccept");

  const parsed = acceptInvitationSchema.safeParse({ token });
  let blockedMessage: string | null = null;
  let stateLabel: string;
  if (!parsed.success) {
    blockedMessage = t("invalidLink");
    stateLabel = "invalid";
  } else {
    const state = await readInvitationState(supabase, parsed.data.token);
    stateLabel = state ?? "unknown";
    if (state && state !== "open") {
      blockedMessage = t(INVITATION_STATE_MESSAGE_KEY[state]);
    }
  }

  return (
    <main
      data-invitation-state={stateLabel}
      className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6 text-center"
    >
      <h1 className="text-xl font-semibold">Zaproszenie do organizacji</h1>
      <p className="text-sm text-gray-600">Zalogowany jako {ctx.user.email}.</p>
      {blockedMessage ? (
        <p className="text-sm text-red-600">{blockedMessage}</p>
      ) : (
        <AcceptInvitationForm token={token} />
      )}
    </main>
  );
}
